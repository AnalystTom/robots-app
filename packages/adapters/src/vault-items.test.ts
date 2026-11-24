import { SecretNotFoundError, SecretStoreUnavailableError } from "@robots/adapter-kit";
import type { BotSecretDestination, VaultPolicy } from "@robots/contracts";
import {
  BLOCKED_ITEM_ANSWER,
  encodeCardSecret,
  encodeContactSecret,
  encodeLoginSecret,
  UNCHOSEN_ITEM_ANSWER,
} from "@robots/contracts";
import { runAsTenant } from "@robots/db";
import { describe, expect, it, vi } from "vitest";
import type { BotSecretScope, VaultItemBots } from "./bot-secrets.js";
import {
  defaultVaultItemTitle,
  findCommandVariableConflict,
  findSiteLogin,
  forgetBotSecret,
  HIDDEN_ITEM,
  listBotSecrets,
  listVaultItems,
  loadCommandVariables,
  loadLoginPasswordRedactions,
  newVaultItemName,
  prepareBotSecret,
  relabelVaultItem,
  requestWithBotSecret,
  resolveLoginFill,
  resolveVaultCardFill,
  revealBotSecret,
  storeBotSecret,
} from "./bot-secrets.js";
import { fakeDatabase } from "./bot-secrets.test-support.js";
import { LOGIN_CODE_FIELD } from "./login-code-field.js";
import { gateToolCall } from "./run-tool-gate.js";
import type { ToolRequest } from "./run-tool-request.js";
import { prepareToolRequest } from "./run-tool-request.js";
import { secretTools } from "./run-tools-secrets.js";
import { EncryptedSecretStore } from "./secrets.js";
import { listVaultItemUses } from "./vault-activity.js";
import type { VaultLoginUse } from "./vault-card-use.js";
import {
  cardUseSummary,
  loginUseSummary,
  requestedCardUse,
  requestedLoginFills,
  vaultCardUseOf,
  vaultLoginUseOf,
} from "./vault-card-use.js";

const TEST_KEY = ("GEZDGNBV" + "GY3TQOJQ").repeat(2);
const OTHER_TEST_KEY = "MFRGGZDF" + "MZTWQ2LK" + "NNWG23TP" + "OBYXE43U";

vi.mock("@robots/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  recordAuditEvent: vi.fn(async () => {}),
}));

const scope = { userId: "user-1", spaceId: "space-1" };
const secretStore = new EncryptedSecretStore("test-only-encryption-key");
const card = { type: "card" } as const;
const contact = { type: "contact" } as const;
const fakeCard = {
  number: "4242 4242 4242 4242",
  expMonth: 8,
  expYear: 2030,
  cvc: "123",
  name: "Alex Rivera",
  billing: "home",
};
const fakeHome = {
  name: "Alex Rivera",
  line1: "12 Elm St",
  city: "Springfield",
  postalCode: "12345",
  phone: "+1 555 0100",
};

function save(
  db: ReturnType<typeof fakeDatabase>,
  name: string,
  plaintext: string,
  auth: BotSecretDestination["auth"],
  labels: { title?: string; note?: string } = {},
) {
  return storeBotSecret({
    prisma: db.prisma,
    secretStore,
    scope,
    destination: { name, origin: "", auth },
    plaintext,
    ...labels,
  });
}

async function vaultWithCard() {
  const db = fakeDatabase();
  await save(db, "home", JSON.stringify(fakeHome), contact, { title: "Home" });
  await save(db, "visa", JSON.stringify(fakeCard), card, { note: "For travel" });
  return db;
}

describe("saving cards and contacts", () => {
  it("refuses a metadata save when the Space vault changes before its lock", async () => {
    const db = fakeDatabase();
    db.useOwnVault(scope.spaceId);
    await save(db, "visa", JSON.stringify(fakeCard), card);
    vi.spyOn(db.prisma.spaceSettingOverride, "findUnique")
      .mockResolvedValueOnce({ setting: "credentials" } as never)
      .mockResolvedValue(null);
    await expect(
      relabelVaultItem(db.prisma, { ...scope, vault: "space" }, "visa", {
        title: "Changed",
        policy: "off",
        bots: { allBots: false, botIds: [] },
      }),
    ).rejects.toThrow("This Space uses the account vault");
    expect(db.rows()[0]).toMatchObject({ policy: "allow" });
    expect(db.rows()[0]?.title).not.toBe("Changed");
    expect(db.limits()).toEqual([]);
  });

  it("encrypts the whole value and saves it in its canonical shape", async () => {
    const db = await vaultWithCard();
    const row = db.rows().find((stored) => stored.name === "visa")!;
    expect(row.ciphertext).not.toContain("4242424242424242");
    expect(row.ciphertext).not.toContain(fakeCard.number);
    expect(JSON.parse(await secretStore.load(row.ciphertext, row.id))).toMatchObject({
      number: "4242424242424242",
    });
    const home = db.rows().find((stored) => stored.name === "home")!;
    expect(home.ciphertext).not.toContain("12 Elm St");
  });

  it("refuses a value that is not a card or contact without quoting it", async () => {
    const db = fakeDatabase();
    await expect(
      save(db, "visa", JSON.stringify({ ...fakeCard, number: "4242424242424241" }), card),
    ).rejects.toThrow(/^Invalid card$/);
    await expect(save(db, "home", "12 Elm St", contact)).rejects.toThrow(/^Invalid contact$/);
  });
});

describe("the owner's list", () => {
  it("shows titles and previews, never a card's number or security code", async () => {
    const db = await vaultWithCard();
    const items = await listVaultItems(db.prisma, secretStore, scope);
    expect(items.map(({ name, title, note, preview }) => ({ name, title, note, preview }))).toEqual(
      [
        { name: "home", title: "Home", note: undefined, preview: { contact: fakeHome } },
        {
          name: "visa",
          title: "Visa ·· 4242",
          note: "For travel",
          preview: {
            card: {
              brand: "Visa",
              last4: "4242",
              expMonth: 8,
              expYear: 2030,
              name: "Alex Rivera",
              billing: "home",
            },
          },
        },
      ],
    );
    expect(JSON.stringify(items)).not.toContain("4242424242424242");
    expect(JSON.stringify(items)).not.toContain('"123"');
  });

  it("shows a login's first visible field under its site", async () => {
    const db = fakeDatabase();
    await storeBotSecret({
      prisma: db.prisma,
      secretStore,
      scope,
      destination: { name: "github", origin: "https://www.github.com", auth: { type: "login" } },
      plaintext: JSON.stringify({
        fields: [
          { label: "Email", value: "octo@example.com", hidden: false },
          { label: "Password", value: "fake-password-1", hidden: true },
        ],
      }),
    });
    const [item] = await listVaultItems(db.prisma, secretStore, scope);
    expect(item).toMatchObject({ title: "github.com", preview: { username: "octo@example.com" } });
    expect(JSON.stringify(item)).not.toContain("fake-password-1");
  });

  it("reveals a card to its owner in full", async () => {
    const db = await vaultWithCard();
    expect(await revealBotSecret({ prisma: db.prisma, secretStore, scope, name: "visa" })).toEqual({
      card: { ...fakeCard, number: "4242424242424242" },
    });
  });

  it("names a new item after its title or value, and changes only its labels", async () => {
    const db = await vaultWithCard();
    expect(await newVaultItemName(db.prisma, scope, "Home", "contact")).toBe("home-2");
    expect(await newVaultItemName(db.prisma, scope, "Café de Flore", "contact")).toBe(
      "cafe-de-flore",
    );
    expect(await newVaultItemName(db.prisma, scope, "בית", "contact")).toBe("contact");
    expect(defaultVaultItemTitle({ origin: "", auth: card }, encodeCardSecret(fakeCard))).toBe(
      "Visa ·· 4242",
    );
    expect(
      defaultVaultItemTitle({ origin: "", auth: contact }, encodeContactSecret({ city: "Paris" })),
    ).toBe("");
    expect(await relabelVaultItem(db.prisma, scope, "visa", { title: "Work card" })).toBe(true);
    const [, visa] = await listVaultItems(db.prisma, secretStore, scope);
    expect(visa).toMatchObject({ title: "Work card", note: "For travel" });
  });
});

describe("what the bot sees", () => {
  it("lists a contact in full and a card only by its summary", async () => {
    const db = await vaultWithCard();
    const listed = await listBotSecrets(db.prisma, secretStore, scope);
    expect(listed).toEqual([
      { name: "home", origin: "", auth: contact, title: "Home", contact: fakeHome },
      {
        name: "visa",
        origin: "",
        auth: card,
        note: "For travel",
        card: expect.objectContaining({ brand: "Visa", last4: "4242", expiry: "08/30" }),
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain("4242424242424242");
    expect(JSON.stringify(listed)).not.toContain('"123"');
  });

  it("hides every saved card number in every run", async () => {
    const db = await vaultWithCard();
    const forms = await loadLoginPasswordRedactions(db.prisma, secretStore, scope);
    expect(forms).toEqual(
      expect.arrayContaining(["4242424242424242", "4242 4242 4242 4242", "4242-4242-4242-4242"]),
    );
  });

  it("never fills a card or contact as a login", async () => {
    const db = await vaultWithCard();
    const fill = (name: string) =>
      resolveLoginFill({ prisma: db.prisma, secretStore, scope, runId: "run-1", name, field: "x" });
    expect(await fill("visa")).toEqual({ error: expect.stringContaining("fill_card") });
    expect(await fill("home")).toEqual({ error: expect.stringContaining("list_secrets") });
  });
});

describe("filling a saved card", () => {
  const savedAt = (db: ReturnType<typeof fakeDatabase>, name = "visa") =>
    db
      .rows()
      .find((row) => row.name === name)!
      .updatedAt!.toISOString();
  const fill = (
    db: ReturnType<typeof fakeDatabase>,
    field: string,
    site = "https://shop.example.test",
  ) =>
    resolveVaultCardFill({
      prisma: db.prisma,
      secretStore,
      scope,
      name: "visa",
      field: field as "number",
      site,
      savedAt: savedAt(db),
    });

  it("types each field only on the approved checkout's origin", async () => {
    const db = await vaultWithCard();
    expect(await fill(db, "number")).toEqual({
      text: "4242424242424242",
      origin: "https://shop.example.test",
      redactions: expect.arrayContaining(["4242424242424242"]),
      used: expect.objectContaining({ name: "visa", kind: "card" }),
    });
    expect(await fill(db, "expiry")).toMatchObject({ text: "08/30" });
    const cvc = await fill(db, "cvc");
    expect(cvc).toMatchObject({ text: "123" });
    expect("redactions" in cvc && cvc.redactions).not.toContain("123");
    expect(await fill(db, "postal_code")).toMatchObject({ text: "12345" });
  });

  it("refuses a site that is not an HTTPS origin, or a name that is not a card", async () => {
    const db = await vaultWithCard();
    expect(await fill(db, "number", "http://shop.example.test")).toEqual({
      error: expect.stringContaining("HTTPS"),
    });
    expect(
      await resolveVaultCardFill({
        prisma: db.prisma,
        secretStore,
        scope,
        name: "home",
        field: "number",
        site: "https://shop.example.test",
        savedAt: savedAt(db, "home"),
      }),
    ).toEqual({ error: expect.stringContaining("No card") });
  });

  it("refuses a card replaced after the user approved it", async () => {
    const db = await vaultWithCard();
    const approved = savedAt(db);
    await save(db, "visa", JSON.stringify({ ...fakeCard, number: "5555555555554444" }), card);
    expect(
      await resolveVaultCardFill({
        prisma: db.prisma,
        secretStore,
        scope,
        name: "visa",
        field: "number",
        site: "https://shop.example.test",
        savedAt: approved,
      }),
    ).toEqual({ error: expect.stringContaining("changed after the user approved") });
  });
});

describe("approving a saved card", () => {
  it("reads one card on one site from a browser_act call", () => {
    const step = { kind: "fill_card", card: "visa", site: "https://shop.example.test/checkout" };
    expect(
      requestedCardUse([
        { ...step, field: "number" },
        { ...step, field: "cvc" },
        { kind: "click", ref: "e1" },
      ]),
    ).toEqual({ card: "visa", site: "https://shop.example.test" });
    expect(requestedCardUse([{ kind: "fill_card", purchase: "p1" }])).toBeUndefined();
    expect(requestedCardUse([{ kind: "fill_card", purchase: "p1", card: "" }])).toBeUndefined();
    expect(requestedCardUse([{ kind: "fill_card", purchase: "p1", card: null }])).toBeUndefined();
    expect(
      requestedCardUse([
        { ...step, field: "number" },
        { ...step, site: "https://other.example.test", field: "cvc" },
      ]),
    ).toEqual({ error: expect.stringContaining("one site") });
    expect(requestedCardUse([{ kind: "fill_card", card: "visa", site: "" }])).toEqual({
      error: expect.stringContaining("HTTPS origin"),
    });
  });

  it("asks once, naming the card and the site, and keeps only a well-formed approval", () => {
    const use = {
      card: "visa",
      site: "https://shop.example.test",
      title: "Visa ·· 4242",
      savedAt: "2026-09-01T00:00:01.000Z",
    };
    expect(cardUseSummary(use)).toEqual({
      onceOnly: true,
      title: "Pay with Visa ·· 4242 on shop.example.test?",
      lines: [],
    });
    const purchase = {
      steps: [0],
      site: "shop.example.test",
      label: "Place order",
      amount: "$9.00",
      amountSource: "page" as const,
      items: [{ name: "Bananas × 6", amount: "$3.00" }],
    };
    expect(cardUseSummary(use, purchase).lines).toEqual([
      'Button: "Place order"',
      "Bananas × 6: $3.00",
      "Total on the page: $9.00",
      "The button label, items and total are read from the page. The bot has not checked them.",
    ]);
    expect(vaultCardUseOf(use)).toEqual(use);
    expect(vaultCardUseOf({ ...use, site: "http://shop.example.test" })).toBeUndefined();
    expect(vaultCardUseOf({ ...use, card: "Visa Card" })).toBeUndefined();
  });
});

describe("approving a saved login", () => {
  it("reads every field one call fills, asks once naming the login's title, and keeps only a well-formed approval", () => {
    const step = { kind: "fill_secret", ref: "e1", secret: "site" };
    expect(
      requestedLoginFills([
        { ...step, field: "Email" },
        { ...step, field: " Password " },
        { ...step, field: "Email" },
        { kind: "fill_secret", ref: "e2", secret: "other", field: "PIN" },
        { kind: "click", ref: "e3" },
        { kind: "fill_code", ref: "e4", secret: "site" },
        { kind: "fill_code", ref: "e5" },
      ]),
    ).toEqual(
      new Map([
        ["site", ["Email", "Password", LOGIN_CODE_FIELD]],
        ["other", ["PIN"]],
      ]),
    );
    const use = {
      kind: "login" as const,
      login: "site",
      site: "https://login.example.test",
      title: "Work login",
      fields: ["Email", "Password"],
      savedAt: "2026-09-01T00:00:01.000Z",
    };
    expect(loginUseSummary(use)).toEqual({
      onceOnly: true,
      title: "Sign in to login.example.test with Work login?",
      lines: [],
    });
    expect(loginUseSummary({ ...use, fields: [...use.fields, LOGIN_CODE_FIELD] }).lines).toEqual([
      "This types the login's authenticator code.",
    ]);
    expect(vaultLoginUseOf(use)).toEqual(use);
    expect(vaultLoginUseOf({ ...use, account: "alice" })).toEqual(use);
    expect(vaultLoginUseOf({ ...use, site: "http://login.example.test" })).toBeUndefined();
    expect(vaultLoginUseOf({ ...use, fields: "Password" })).toBeUndefined();
    const card = { card: "visa", site: "https://shop.example.test", title: "Visa", savedAt: "x" };
    expect(vaultLoginUseOf(card)).toBeUndefined();
    expect(vaultCardUseOf(use)).toBeUndefined();
    expect(vaultCardUseOf(card)).toEqual(card);
  });
});

describe("an item's uses, for its owner", () => {
  const unnamed = {
    targetLabel: null,
    metadata: { kind: "login", scope: "account", tool: "browser_act" },
  };
  const on = (site: string) => ({
    targetLabel: "visa",
    metadata: { name: "visa", site: `https://${site}.example.test` },
  });
  const shell = { targetLabel: "visa", metadata: { name: "visa", kind: "command", tool: "shell" } };
  it.each([
    ["two uses on two sites", [on("a"), on("b")], ["a", "b"]],
    ["a guest's use of an account item, written twice", [unnamed, on("a")], ["a"]],
    ["a guest's use and another on another site", [unnamed, on("a"), on("b")], ["a", "b"]],
    ["a guest's use of a Space vault item, its one unnamed row", [unnamed], [null]],
    ["a use in a shell, which has no site", [shell], [null]],
    ["a guest's use in a shell, written twice with no site", [unnamed, shell], [null]],
    ["two uses in a shell", [shell, shell], [null, null]],
    ["two guest uses in a shell", [unnamed, shell, shell, unnamed], [null, null]],
  ])("lists %s", async (_, written, sites) => {
    const db = await vaultWithCard();
    const at = new Date("2026-11-05T10:00:00.000Z");
    const rows = written.map((row) => ({
      createdAt: at,
      actorId: "bot-1",
      actorLabel: "Shopper",
      runId: "run-1",
      threadId: "thread-1",
      ...row,
    }));
    Object.assign(db.prisma, {
      auditEvent: { findMany: async () => rows },
      thread: { findMany: async () => [] },
    });
    const uses = await listVaultItemUses(db.prisma, scope, "visa");
    expect(uses?.map(({ site }) => site && new URL(site).hostname.split(".")[0])).toEqual(sites);
  });

  it("reads its latest uses by id, naming only the owner's chats, and nothing for another member", async () => {
    const db = await vaultWithCard();
    const visa = db.rows().find((row) => row.name === "visa")!;
    const use = { actorLabel: "Shopper" };
    const twice = { ...use, createdAt: new Date("2026-11-05T10:00:00.000Z"), threadId: "thread-1" };
    const named = { targetLabel: "visa", metadata: { site: "https://shop.example.test" } };
    const events = vi.fn(async () => [
      {
        ...twice,
        targetLabel: null,
        metadata: { kind: "card", scope: "account", tool: "browser_act" },
      },
      { ...twice, ...named },
      { ...use, createdAt: new Date("2026-11-04T10:00:00.000Z"), threadId: "thread-1", ...named },
      {
        ...use,
        createdAt: new Date("2026-11-03T10:00:00.000Z"),
        threadId: "other",
        targetLabel: null,
        metadata: {},
      },
    ]);
    const threads = vi.fn(async () => [{ id: "thread-1", bot: { name: "Shopper" } }]);
    Object.assign(db.prisma, { auditEvent: { findMany: events }, thread: { findMany: threads } });
    expect(await listVaultItemUses(db.prisma, scope, "visa")).toEqual([
      {
        at: "2026-11-05T10:00:00.000Z",
        botName: "Shopper",
        site: "https://shop.example.test",
        chat: { title: "Shopper" },
      },
      {
        at: "2026-11-04T10:00:00.000Z",
        botName: "Shopper",
        site: "https://shop.example.test",
        chat: { title: "Shopper" },
      },
      { at: "2026-11-03T10:00:00.000Z", botName: "Shopper", site: null, chat: null },
    ]);
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { targetType: "vault_credential", targetId: visa.id, action: "credential.used" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 40,
      }),
    );
    expect(threads).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["thread-1", "other"] }, userId: "user-1" } }),
    );
    events.mockClear();
    expect(
      await listVaultItemUses(db.prisma, { ...scope, userId: "user-2" }, "visa"),
    ).toBeUndefined();
    expect(events).not.toHaveBeenCalled();
  });
});

describe("an item bots may not use", () => {
  const bot = { ...scope, botId: "bot-1" };
  const site = "https://login.example.test";
  const login = JSON.stringify({
    fields: [
      { label: "Email", value: "fake-user@example.test", hidden: false },
      { label: "Password", value: "fake-password-1", hidden: true },
    ],
  });
  const api = { type: "bearer" } as const;
  const remote = {
    fetch: vi.fn<typeof globalThis.fetch>(async () => Response.json({ ok: true })),
    resolveHostname: async () => [{ address: "203.0.113.10", family: 4 as const }],
  };
  async function vault() {
    const db = await vaultWithCard();
    const row = (name: string) => db.rows().find((entry) => entry.name === name)!;
    Object.assign(db.prisma.secret, { deleteMany: async () => ({ count: 0 }) });
    const store = (
      name: string,
      origin: string,
      auth: BotSecretDestination["auth"],
      value: string,
      policy?: VaultPolicy,
      bots?: string[] | VaultItemBots,
    ) =>
      storeBotSecret({
        prisma: db.prisma,
        secretStore,
        scope,
        destination: { name, origin, auth },
        plaintext: value,
        policy,
        ...(bots ? { bots: Array.isArray(bots) ? { allBots: false, botIds: bots } : bots } : {}),
      });
    await store("site", site, { type: "login" }, login);
    await store("stripe", "https://api.example.test", api, "fake-key-1");
    await store("deploy", "", { type: "command" }, "fake-command-1");
    const uses = {
      list: async () =>
        (await listBotSecrets(db.prisma, secretStore, bot)).map((item) => item.name),
      fill: () =>
        resolveLoginFill({
          prisma: db.prisma,
          secretStore,
          scope: bot,
          runId: "run-1",
          name: "site",
          field: "Password",
        }),
      card: () =>
        resolveVaultCardFill({
          prisma: db.prisma,
          secretStore,
          scope: bot,
          name: "visa",
          field: "number",
          site: "https://shop.example.test",
          savedAt: row("visa").updatedAt!.toISOString(),
        }),
      send: () =>
        requestWithBotSecret({
          prisma: db.prisma,
          secretStore,
          scope: bot,
          request: { name: "stripe", url: "https://api.example.test/v1" },
          signal: new AbortController().signal,
          remote,
        }),
      env: async () => (await loadCommandVariables(db.prisma, secretStore, bot)).env,
    };
    const ctx = {
      deps: { prisma: db.prisma, secretStore },
      run: { ...bot, id: "run-1", trigger: "user" },
      runId: "run-1",
      bot: { id: "bot-1" },
      thread: { id: "thread-1" },
      state: { walletHosts: new Set(), reply: { pendingProgress: "" } },
      context: { signal: new AbortController().signal },
      secrets: [],
    };
    const tool = (name: keyof typeof secretTools, args: Record<string, unknown>) =>
      secretTools[name]!(ctx as never, { name, args, finish: async (r: unknown) => r } as never);
    return { db, row, uses, store, ctx, tool };
  }

  it("hides an item turned off, or not for this bot, from it everywhere, and still redacts it", async () => {
    const { db, row, uses, store, tool } = await vault();
    await store("ci-token", "", { type: "command" }, "fake-command-2");
    expect(await uses.list()).toEqual(["ci-token", "deploy", "home", "site", "stripe", "visa"]);
    for (const name of ["site", "visa", "deploy", "ci-token"]) row(name).policy = "off";
    row("stripe").policy = "off";
    expect(await uses.list()).toEqual(["home"]);
    expect(await uses.fill()).toEqual({ error: expect.stringContaining("unavailable") });
    expect(await uses.card()).toEqual({ error: expect.stringContaining("No card") });
    expect(await uses.send()).toEqual({ error: expect.stringContaining("unavailable") });
    expect(await uses.env()).toEqual({});
    expect(remote.fetch).not.toHaveBeenCalled();
    const hidden = { error: HIDDEN_ITEM };
    const credential = { name: "stripe", origin: "https://api.example.test", auth: api };
    expect(await tool("request_secret", { label: "Key", purpose: "api_key", credential })).toEqual(
      hidden,
    );
    expect(
      await tool("generate_secret", { name: "site", type: "login", origin: site, username: "x" }),
    ).toEqual(hidden);
    expect(await tool("forget_secret", { name: "stripe" })).toEqual({ removed: false });
    expect(row("stripe")).toBeDefined();
    expect(
      await findCommandVariableConflict(db.prisma, bot, {
        name: "ci_token",
        origin: "",
        auth: { type: "command" },
      }),
    ).toBe("another saved item");
    expect(await loadLoginPasswordRedactions(db.prisma, secretStore, bot)).toContain(
      "fake-password-1",
    );
    expect((await loadCommandVariables(db.prisma, secretStore, bot)).redactions).toContain(
      "fake-command-1",
    );
    expect(
      (await listVaultItems(db.prisma, secretStore, scope)).map((item) => [item.name, item.policy]),
    ).toContainEqual(["site", "off"]);
    await forgetBotSecret(db.prisma, scope, "stripe");
    expect(db.rows().some((entry) => entry.name === "stripe")).toBe(false);
  });

  it("treats an item chosen for other bots exactly as a missing one, and still redacts it", async () => {
    const { db, row, uses, store, tool } = await vault();
    await store("new-password", "", { type: "command" }, "fake-command-3");
    const limited = ["site", "visa", "stripe", "deploy", "home", "new-password"];
    const limit = (name: string, botIds: string[]) =>
      relabelVaultItem(db.prisma, scope, name, { bots: { allBots: false, botIds } });
    for (const name of limited) await limit(name, ["bot-2"]);
    const credential = { name: "stripe", origin: "https://api.example.test", auth: api };
    const savedAt = row("visa").updatedAt!.toISOString();
    const seen = async () => ({
      list: await uses.list(),
      fill: await uses.fill(),
      card: await resolveVaultCardFill({
        prisma: db.prisma,
        secretStore,
        scope: bot,
        name: "visa",
        field: "number",
        site: "https://shop.example.test",
        savedAt,
      }),
      send: await uses.send(),
      env: await uses.env(),
      siteLogin: await findSiteLogin(db.prisma, bot, site),
      forget: await tool("forget_secret", { name: "stripe" }),
    });
    const scoped = await seen();
    expect(scoped.list).toEqual([]);
    expect(scoped.forget).toEqual({ removed: false });
    expect(remote.fetch).not.toHaveBeenCalled();
    expect(row("stripe")).toBeDefined();
    expect(
      (await listBotSecrets(db.prisma, secretStore, { ...bot, botId: "bot-2" })).map(
        (item) => item.name,
      ),
    ).toEqual(["deploy", "home", "new-password", "site", "stripe", "visa"]);
    expect(await loadLoginPasswordRedactions(db.prisma, secretStore, bot)).toContain(
      "fake-password-1",
    );
    expect((await loadCommandVariables(db.prisma, secretStore, bot)).redactions).toContain(
      "fake-command-1",
    );
    for (const answer of [
      await tool("request_secret", { label: "Key", purpose: "api_key", credential }),
      await tool("generate_secret", { name: "site", type: "login", origin: site, username: "x" }),
      await tool("generate_secret", {
        name: "new",
        type: "login",
        origin: site,
        username: "x",
        command: true,
      }),
    ])
      expect(answer).toEqual({ error: HIDDEN_ITEM });
    expect(HIDDEN_ITEM).not.toMatch(/item|login|key|site|user/i);
    for (const name of limited) await forgetBotSecret(db.prisma, scope, name);
    expect(await seen()).toEqual(scoped);
  });

  it("limits an item to chosen bots in one Space, through older saves and other Spaces' choices", async () => {
    const { db, row, store } = await vault();
    const there = { userId: scope.userId, spaceId: "space-2" };
    const names = async (botId: string, spaceId = "space-1") =>
      (await listBotSecrets(db.prisma, secretStore, { ...scope, spaceId, botId })).map(
        (item) => item.name,
      );
    const bots = (where: BotSecretScope, name: string, choice: VaultItemBots) =>
      relabelVaultItem(db.prisma, where, name, { bots: choice });
    await store("new-key", "https://api.example.test", api, "fake-key-2", undefined, ["bot-1"]);
    await bots(scope, "home", { allBots: false, botIds: [] });
    expect(await names("bot-1")).toEqual(["deploy", "new-key", "site", "stripe", "visa"]);
    expect(await names("bot-2")).toEqual(["deploy", "site", "stripe", "visa"]);
    await relabelVaultItem(db.prisma, scope, "new-key", { title: "Renamed" });
    await store("new-key", "https://api.example.test", api, "fake-key-3");
    expect(await names("bot-2")).not.toContain("new-key");
    expect((await listVaultItems(db.prisma, secretStore, scope, "new-key"))[0]).toMatchObject({
      allBots: false,
      botIds: ["bot-1"],
    });
    expect((await listVaultItems(db.prisma, secretStore, there, "new-key"))[0]).toMatchObject({
      allBots: true,
      botIds: [],
    });
    await bots(there, "new-key", { allBots: false, botIds: ["bot-other-space"] });
    await bots(there, "new-key", { allBots: true });
    expect(await names("bot-other-space", "space-2")).toContain("new-key");
    expect(await names("bot-2")).not.toContain("new-key");
    const postal = await resolveVaultCardFill({
      prisma: db.prisma,
      secretStore,
      scope: bot,
      name: "visa",
      field: "postal_code",
      site: "https://shop.example.test",
      savedAt: row("visa").updatedAt!.toISOString(),
    });
    expect(postal).toEqual({ error: "This card has no billing address this bot can use." });
    for (const botIds of [["bot-other-space"], ["missing-bot"]]) {
      await expect(bots(scope, "new-key", { allBots: false, botIds })).rejects.toThrow(
        "Choose from your bots in this Space",
      );
      await expect(
        store("refused", "https://api.example.test", api, "fake-key-4", undefined, botIds),
      ).rejects.toThrow("Choose from your bots in this Space");
    }
    db.useOwnVault("space-2");
    await expect(
      bots({ ...there, vault: "account" }, "new-key", { botIds: ["bot-other-space"] }),
    ).rejects.toThrow("Choose from your bots in this Space");
    expect(db.rows().some((entry) => entry.name === "refused")).toBe(false);
    const visible = (spaceId: string) =>
      runAsTenant({ userId: scope.userId, spaceId }, () => names("bot-2"));
    expect(await visible("space-1")).toEqual(["deploy", "site", "stripe", "visa"]);
    expect(await visible("space-2")).toEqual([]);
    expect(
      await runAsTenant({ userId: "user-2", spaceId: "space-1" }, () => names("bot-2")),
    ).toEqual([]);
    await bots(scope, "new-key", { allBots: true });
    expect(await names("bot-2")).toContain("new-key");
    for (const name of ["new-key", "home"]) await forgetBotSecret(db.prisma, scope, name);
    expect(db.assignments()).toEqual([]);
    expect(db.limits()).toEqual([]);
  });

  type BotsState = "every" | "leftover" | string[];
  const transitions: [BotsState, VaultItemBots | undefined, BotsState][] = [
    ["every", undefined, "every"],
    ["every", { allBots: true }, "every"],
    ["every", { allBots: true, botIds: ["bot-1"] }, "every"],
    ["every", { allBots: false }, []],
    ["every", { allBots: false, botIds: ["bot-2"] }, ["bot-2"]],
    ["every", { botIds: ["bot-2"] }, ["bot-2"]],
    ["every", { botIds: [] }, []],
    ["leftover", undefined, "leftover"],
    ["leftover", { allBots: true }, "every"],
    ["leftover", { allBots: false }, []],
    ["leftover", { allBots: false, botIds: ["bot-2"] }, ["bot-2"]],
    ["leftover", { botIds: ["bot-2"] }, ["bot-2"]],
    ["leftover", { botIds: [] }, []],
    [["bot-1"], undefined, ["bot-1"]],
    [["bot-1"], { allBots: true }, "every"],
    [["bot-1"], { allBots: false }, ["bot-1"]],
    [["bot-1"], { allBots: false, botIds: ["bot-2"] }, ["bot-2"]],
    [["bot-1"], { botIds: ["bot-2"] }, ["bot-2"]],
    [["bot-1"], { botIds: [] }, []],
  ];
  it.each(transitions)(
    "moves an item's bots from %j with a save of %j to %j",
    async (from, save, to) => {
      const { db, store } = await vault();
      const names = async (botId: string) =>
        (await listBotSecrets(db.prisma, secretStore, { ...scope, botId })).map(
          (item) => item.name,
        );
      const item = async () => (await listVaultItems(db.prisma, secretStore, scope, "new-key"))[0];
      await store("new-key", "https://api.example.test", api, "fake-key-2");
      const credentialId = db.rows().find((entry) => entry.name === "new-key")!.id;
      const own = { userId: scope.userId, spaceId: scope.spaceId, credentialId };
      if (Array.isArray(from))
        await relabelVaultItem(db.prisma, scope, "new-key", {
          bots: { allBots: false, botIds: from },
        });
      else if (from === "leftover")
        await db.prisma.vaultCredentialBot.createMany({ data: [{ ...own, botId: "bot-1" }] });
      for (const write of [
        () => relabelVaultItem(db.prisma, scope, "new-key", { bots: save }),
        () => store("new-key", "https://api.example.test", api, "fake-key-3", undefined, save),
      ]) {
        await write();
        const chosen = Array.isArray(to) ? to : [];
        expect(await item()).toMatchObject({ allBots: !Array.isArray(to), botIds: chosen });
        for (const botId of ["bot-1", "bot-2"])
          expect((await names(botId)).includes("new-key")).toBe(
            !Array.isArray(to) || chosen.includes(botId),
          );
        expect(db.assignments().map((entry) => entry.botId)).toEqual(
          to === "leftover" ? ["bot-1"] : chosen,
        );
      }
    },
  );

  it("lets each member of a shared Space limit their own item to any of its bots, for their runs only", async () => {
    const { db } = await vault();
    const member = { userId: "user-2", spaceId: "space-1" };
    const names = async (userId: string, botId: string) =>
      (await listBotSecrets(db.prisma, secretStore, { userId, spaceId: "space-1", botId })).map(
        (item) => item.name,
      );
    await storeBotSecret({
      prisma: db.prisma,
      secretStore,
      scope: member,
      destination: { name: "member-key", origin: "https://api.example.test", auth: api },
      plaintext: "fake-key-5",
      bots: { allBots: false, botIds: ["bot-1"] },
    });
    expect(await names("user-2", "bot-1")).toEqual(["member-key"]);
    expect(await names("user-2", "bot-2")).toEqual([]);
    expect(await names("user-2", "bot-of-another-member")).toEqual([]);
    expect(await names("user-1", "bot-1")).not.toContain("member-key");
    await relabelVaultItem(db.prisma, scope, "stripe", {
      bots: { allBots: false, botIds: ["bot-of-another-member"] },
    });
    expect(await names("user-1", "bot-of-another-member")).toContain("stripe");
    expect(await names("user-1", "bot-1")).not.toContain("stripe");
    expect(await names("user-2", "bot-of-another-member")).toEqual([]);
    expect(await names("user-2", "bot-1")).toEqual(["member-key"]);
  });

  it("saves Block or Ask first with the item in one write, and keeps it through an older app's save", async () => {
    const { db, row, store } = await vault();
    await expect(
      store("new-home", "", { type: "contact" }, JSON.stringify(fakeHome), "off"),
    ).rejects.toThrow("can't be used that way");
    expect(db.rows().some((entry) => entry.name === "new-home")).toBe(false);
    await store("new-key", "https://api.example.test", api, "fake-key-2", "off");
    expect(db.rows().filter((entry) => entry.name === "new-key")).toEqual([
      expect.objectContaining({ policy: "off" }),
    ]);
    const relabel = (name: string, policy?: VaultPolicy) =>
      relabelVaultItem(db.prisma, scope, name, { title: "Renamed", ...(policy ? { policy } : {}) });
    expect(await relabel("new-key")).toBe(true);
    expect(row("new-key")).toMatchObject({ title: "Renamed", policy: "off" });
    expect(await relabel("new-key", "allow")).toBe(true);
    expect(row("new-key")).toMatchObject({ policy: "allow" });
    await expect(relabel("home", "off")).rejects.toThrow("can't be used that way");
    expect(await relabel("missing", "off")).toBe(false);
    expect(await relabel("site", "ask")).toBe(true);
    for (const name of ["new-key", "deploy", "visa", "home"])
      await expect(relabel(name, "ask")).rejects.toThrow("can't be used that way");
    expect((await listBotSecrets(db.prisma, secretStore, bot)).map((item) => item.name)).toContain(
      "site",
    );
  });

  it("never lets an answer a bot asked for replace an item blocked while it waited", async () => {
    const { db, row } = await vault();
    const before = row("stripe").ciphertext;
    const destination = { name: "stripe", origin: "https://api.example.test", auth: api };
    const pending = await prepareBotSecret({
      prisma: db.prisma,
      secretStore,
      scope: bot,
      destination,
      plaintext: "fake-key-replacement",
    });
    await relabelVaultItem(db.prisma, scope, "stripe", { policy: "off" });
    await expect(db.prisma.$transaction(async (tx) => pending.store(tx as never))).rejects.toThrow(
      BLOCKED_ITEM_ANSWER,
    );
    expect(row("stripe").ciphertext).toBe(before);
    const fresh = { ...destination, name: "fresh" };
    const waiting = await prepareBotSecret({
      prisma: db.prisma,
      secretStore,
      scope: bot,
      destination: fresh,
      plaintext: "fake-key-fresh",
    });
    await storeBotSecret({
      prisma: db.prisma,
      secretStore,
      scope,
      destination: { ...fresh, origin: "https://other.example.test" },
      plaintext: "fake-key-owner",
      policy: "off",
    });
    await expect(db.prisma.$transaction(async (tx) => waiting.store(tx as never))).rejects.toThrow(
      BLOCKED_ITEM_ANSWER,
    );
    await expect(
      prepareBotSecret({
        prisma: db.prisma,
        secretStore,
        scope: bot,
        destination: fresh,
        plaintext: "fake-key-late",
      }),
    ).rejects.toThrow(BLOCKED_ITEM_ANSWER);
    const waitingKey = await prepareBotSecret({
      prisma: db.prisma,
      secretStore,
      scope: bot,
      destination: { name: "deploy", origin: "", auth: { type: "command" } },
      plaintext: "fake-command-late",
    });
    await relabelVaultItem(db.prisma, scope, "deploy", { bots: { allBots: false, botIds: [] } });
    await expect(
      db.prisma.$transaction(async (tx) => waitingKey.store(tx as never)),
    ).rejects.toThrow(UNCHOSEN_ITEM_ANSWER);
    await relabelVaultItem(db.prisma, scope, "site", { bots: { allBots: false, botIds: [] } });
    await expect(
      prepareBotSecret({
        prisma: db.prisma,
        secretStore,
        scope: bot,
        destination: {
          name: "site",
          origin: "https://other.example.test",
          auth: { type: "login" },
        },
        plaintext: login,
      }),
    ).rejects.toThrow(UNCHOSEN_ITEM_ANSWER);
    await storeBotSecret({ prisma: db.prisma, secretStore, scope, destination, plaintext: "k2" });
    expect(row("stripe").ciphertext).not.toBe(before);
  });
});

describe("a save that leaves out the authenticator key", () => {
  it("saves over a login whose value can no longer be decrypted, which keeps no key", async () => {
    const secretStore = new EncryptedSecretStore("test-only-encryption-key");
    const scope = { userId: "user-1", spaceId: "space-1" };
    const destination = {
      name: "shop",
      origin: "https://shop.example.test",
      auth: { type: "login" },
    } as const;
    const db = fakeDatabase();
    const fields = [{ label: "Password", value: "fake-pass", hidden: true }];
    const save = (store: typeof secretStore, botId?: string) =>
      storeBotSecret({
        prisma: db.prisma,
        secretStore: store,
        scope: { ...scope, ...(botId ? { botId } : {}) },
        destination,
        plaintext: JSON.stringify({ fields }),
      });
    await save(secretStore);
    const rotated = new EncryptedSecretStore("another-test-only-key");
    await save(rotated, "bot-1");
    expect(
      await revealBotSecret({ prisma: db.prisma, secretStore: rotated, scope, name: "shop" }),
    ).toEqual({ fields });
    const load = vi.spyOn(rotated, "load").mockRejectedValueOnce(new SecretNotFoundError());
    await save(rotated, "bot-1");
    expect(load).toHaveBeenCalled();
    load.mockRestore();
    const unreadable = vi.spyOn(rotated, "load").mockResolvedValueOnce("not a login");
    await save(rotated, "bot-1");
    expect(unreadable).toHaveBeenCalled();
    unreadable.mockRestore();
    const badKey = JSON.stringify({ fields, otp: `${TEST_KEY}G` });
    const mistyped = vi.spyOn(rotated, "load").mockResolvedValueOnce(badKey);
    await save(rotated, "bot-1");
    expect(mistyped).toHaveBeenCalled();
    mistyped.mockRestore();
    expect(
      await revealBotSecret({ prisma: db.prisma, secretStore: rotated, scope, name: "shop" }),
    ).toEqual({ fields });
  });

  it("fails, changing nothing, for any other error reading the saved login", async () => {
    const secretStore = new EncryptedSecretStore("test-only-encryption-key");
    const scope = { userId: "user-1", spaceId: "space-1" };
    const destination = {
      name: "shop",
      origin: "https://shop.example.test",
      auth: { type: "login" },
    } as const;
    const fields = [{ label: "Password", value: "fake-pass", hidden: true }];
    const otp = TEST_KEY;
    const db = fakeDatabase();
    const save = (value: Record<string, unknown>) =>
      storeBotSecret({
        prisma: db.prisma,
        secretStore,
        scope,
        destination,
        plaintext: JSON.stringify(value),
      });
    await save({ fields, otp });
    const before = db.rows()[0]!.ciphertext;
    class NewStoreError extends Error {}
    for (const error of [
      new DOMException("The operation was aborted.", "AbortError"),
      new DOMException("The operation timed out.", "TimeoutError"),
      new NewStoreError("store said no"),
    ]) {
      const load = vi.spyOn(secretStore, "load").mockRejectedValueOnce(error);
      await expect(save({ fields: [{ ...fields[0]!, value: "fake-pass-2" }] })).rejects.toThrow(
        "The saved login could not be read. Try again.",
      );
      load.mockRestore();
      expect(db.rows()[0]!.ciphertext).toBe(before);
    }
  });

  it("fails, changing nothing, when the saved key can't be read, and keeps it on a retry", async () => {
    const secretStore = new EncryptedSecretStore("test-only-encryption-key");
    const scope = { userId: "user-1", spaceId: "space-1" };
    const destination = {
      name: "shop",
      origin: "https://shop.example.test",
      auth: { type: "login" },
    } as const;
    const fields = [{ label: "Password", value: "fake-pass", hidden: true }];
    const otp = TEST_KEY;
    const db = fakeDatabase();
    const save = (value: Record<string, unknown>) =>
      storeBotSecret({
        prisma: db.prisma,
        secretStore,
        scope,
        destination,
        plaintext: JSON.stringify(value),
      });
    await save({ fields, otp });
    const before = db.rows()[0]!.ciphertext;
    const load = vi
      .spyOn(secretStore, "load")
      .mockRejectedValueOnce(new SecretStoreUnavailableError());
    const failed = save({ fields: [{ ...fields[0]!, value: "fake-pass-2" }] });
    await expect(failed).rejects.toThrow("The saved login could not be read. Try again.");
    await failed.catch((error: Error) => expect(error.message).not.toContain(otp));
    load.mockRestore();
    expect(db.rows()[0]!.ciphertext).toBe(before);
    await save({ fields: [{ ...fields[0]!, value: "fake-pass-2" }] });
    expect(await revealBotSecret({ prisma: db.prisma, secretStore, scope, name: "shop" })).toEqual({
      fields: [{ ...fields[0]!, value: "fake-pass-2" }],
      otp,
    });
  });

  it("keeps the key as saved when it commits, not as it was before the lock", async () => {
    const secretStore = new EncryptedSecretStore("test-only-encryption-key");
    const scope = { userId: "user-1", spaceId: "space-1" };
    const destination = {
      name: "shop",
      origin: "https://shop.example.test",
      auth: { type: "login" },
    } as const;
    const fields = [{ label: "Password", value: "fake-pass", hidden: true }];
    const save = (prisma: Parameters<typeof storeBotSecret>[0]["prisma"], otp?: string) =>
      storeBotSecret({
        prisma,
        secretStore,
        scope,
        destination,
        plaintext: JSON.stringify(otp === undefined ? { fields } : { fields, otp }),
      });
    const first = TEST_KEY;
    const second = OTHER_TEST_KEY;
    for (const [change, kept] of [
      ["", undefined],
      [second, second],
    ] as const) {
      const db = fakeDatabase();
      await save(db.prisma, first);
      const put = secretStore.put.bind(secretStore);
      const spy = vi.spyOn(secretStore, "put").mockImplementationOnce(async (...args) => {
        await save(db.prisma, change);
        return put(...args);
      });
      await save(db.prisma);
      spy.mockRestore();
      const revealed = await revealBotSecret({
        prisma: db.prisma,
        secretStore,
        scope,
        name: "shop",
      });
      expect(revealed).toEqual(kept ? { fields, otp: kept } : { fields });
    }
  });
});

describe("what a save leaves of a login's key, its stop, its other sites and its bots", () => {
  const site = "https://shop.example.test";
  const www = "https://www.shop.example.test";
  const shop = { name: "shop", origin: site, auth: { type: "login" as const } };
  const fields = [{ label: "Password", value: "fake-pass", hidden: true }];
  const typed = JSON.stringify({ fields: [{ ...fields[0]!, value: "fake-pass-2" }] });
  const withKey = (otp: string) => JSON.stringify({ ...JSON.parse(typed), otp });
  const first = TEST_KEY;
  const second = OTHER_TEST_KEY;
  const bot = { ...scope, botId: "bot-1" };
  const states = ["no key", "a key", "a key its owner removed", "a key that was stopped"] as const;

  async function login(state: (typeof states)[number], ownVault: boolean) {
    const db = fakeDatabase();
    if (ownVault) db.useOwnVault("space-1");
    const save = (plaintext: string, scoped: BotSecretScope = scope, more: object = {}) =>
      storeBotSecret({
        prisma: db.prisma,
        secretStore,
        scope: scoped,
        destination: shop,
        plaintext,
        ...more,
      });
    await save(JSON.stringify(state === "no key" ? { fields } : { fields, otp: first }), scope, {
      alsoOn: [www, "https://app.shop.example.test"],
      policy: "ask",
      bots: { botIds: ["bot-1", "bot-2"] },
    });
    await relabelVaultItem(db.prisma, scope, "shop", {
      alsoOn: [www],
      bots: { botIds: ["bot-1"] },
    });
    if (state === "a key its owner removed") await save(withKey(""));
    if (state === "a key that was stopped") db.rows()[0]!.codesStoppedAt = new Date(0);
    return { db, save };
  }
  type Made = Awaited<ReturnType<typeof login>>;

  it.each<[string, (made: Made) => Promise<unknown>, (string | undefined)[], boolean]>([
    [
      "the owner's, leaving the key out",
      ({ save }) => save(typed),
      [undefined, first, undefined, first],
      false,
    ],
    [
      "an older app's, as a username and password",
      ({ save }) => save(JSON.stringify({ username: "fake-user", password: "fake-pass-2" })),
      [undefined, first, undefined, first],
      false,
    ],
    [
      "the owner's, with the key it had",
      ({ save }) => save(withKey(first)),
      [first, first, first, first],
      false,
    ],
    [
      "the owner's, with another key",
      ({ save }) => save(withKey(second)),
      [second, second, second, second],
      false,
    ],
    [
      "the owner's, with the key emptied",
      ({ save }) => save(withKey("")),
      [undefined, undefined, undefined, undefined],
      false,
    ],
    [
      "a login card a bot asked for, answered",
      ({ save }) => save(typed, bot),
      [undefined, first, undefined, first],
      true,
    ],
    [
      "a login card a bot asked for another site, answered",
      ({ db }) =>
        storeBotSecret({
          prisma: db.prisma,
          secretStore,
          scope: bot,
          destination: { ...shop, origin: "https://new.shop.example.test" },
          plaintext: typed,
          replaces: db.rows()[0]!.id,
        }),
      [undefined, undefined, undefined, undefined],
      true,
    ],
    [
      "an import of the same login, which is refused",
      ({ db }) =>
        storeBotSecret({
          prisma: db.prisma,
          secretStore,
          scope,
          destination: { ...shop, name: "shop-2" },
          plaintext: typed,
          createOnly: true,
          newLoginOnly: new Map(),
        }).catch((error: Error) => error.message),
      [undefined, first, undefined, first],
      true,
    ],
    [
      "generate_secret under its name, which is refused",
      ({ db }) =>
        secretTools.generate_secret!(
          {
            deps: { prisma: db.prisma, secretStore },
            run: { ...bot, id: "run-1" },
            secrets: [],
            state: { reply: { pendingProgress: "" } },
          } as never,
          {
            args: { name: "shop", type: "login", origin: site, username: "fake-user" },
            finish: async (result: unknown) => result,
          } as never,
        ),
      [undefined, first, undefined, first],
      true,
    ],
  ])("%s", async (name, saved, keys, stopped) => {
    for (const [index, ownVault] of [...states.map(() => false), true].entries()) {
      const state = states[index] ?? "a key that was stopped";
      const made = await login(state, ownVault);
      await saved(made);
      const [row] = made.db.rows();
      const revealed = await revealBotSecret({
        prisma: made.db.prisma,
        secretStore,
        scope,
        name: "shop",
      });
      const where = `${state}${ownVault ? ", in the Space's own vault" : ""}`;
      expect(made.db.rows(), where).toHaveLength(1);
      expect(revealed && "otp" in revealed ? revealed.otp : undefined, where).toBe(
        keys[states.indexOf(state)],
      );
      expect(Boolean(row!.codesStoppedAt), where).toBe(
        state === "a key that was stopped" && stopped,
      );
      expect(row, where).toMatchObject({
        alsoOn: name.includes("another site") ? [] : [www],
        policy: "ask",
      });
      expect(made.db.assignments().map((entry) => entry.botId)).toEqual(["bot-1"]);
      expect(made.db.limits()).toHaveLength(1);
    }
  });
});

describe("what a bot sees of a login with a key and other sites", () => {
  it("says it can type its code and where else it fills, never the key", async () => {
    const secretStore = new EncryptedSecretStore("test-only-encryption-key");
    const scope = { userId: "user-1", spaceId: "space-1" };
    const db = fakeDatabase();
    const otp = TEST_KEY;
    await storeBotSecret({
      prisma: db.prisma,
      secretStore,
      scope,
      destination: { name: "bank", origin: "https://bank.example.test", auth: { type: "login" } },
      plaintext: encodeLoginSecret({
        fields: [{ label: "Password", value: "fake-bank-pass", hidden: true }],
        otp,
      }),
      alsoOn: ["https://www.bank.example.test"],
    });
    const listed = await listBotSecrets(db.prisma, secretStore, { ...scope, botId: "bot-1" });
    expect(listed).toEqual([
      {
        name: "bank",
        origin: "https://bank.example.test",
        auth: { type: "login" },
        alsoOn: ["https://www.bank.example.test"],
        authenticatorCode: true,
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain(otp);
  });
});

describe("a login moved to one of its other sites", () => {
  it("no longer lists its new site among its others", async () => {
    const db = fakeDatabase();
    const login = (origin: string) => ({ name: "bank", origin, auth: { type: "login" as const } });
    const value = encodeLoginSecret({
      fields: [{ label: "Password", value: "fake-bank-pass", hidden: true }],
    });
    await storeBotSecret({
      prisma: db.prisma,
      secretStore,
      scope,
      destination: login("https://bank.example.test"),
      plaintext: value,
      alsoOn: ["https://www.bank.example.test", "https://app.bank.example.test"],
    });
    await storeBotSecret({
      prisma: db.prisma,
      secretStore,
      scope,
      destination: login("https://www.bank.example.test"),
      plaintext: value,
      replaces: db.rows()[0]!.id,
    });
    expect(db.rows()[0]).toMatchObject({
      origin: "https://www.bank.example.test",
      alsoOn: ["https://app.bank.example.test"],
    });
  });
});

describe("a login that asks first, on its other sites and with its code", () => {
  it("fills only on the site and with the code the user approved", async () => {
    const db = fakeDatabase();
    const site = "https://bank.example.test";
    const other = "https://www.bank.example.test";
    await storeBotSecret({
      prisma: db.prisma,
      secretStore,
      scope,
      destination: { name: "bank", origin: site, auth: { type: "login" } },
      plaintext: encodeLoginSecret({
        fields: [{ label: "Password", value: "fake-bank-pass", hidden: true }],
        otp: TEST_KEY,
      }),
      alsoOn: [other],
      policy: "ask",
    });
    Object.assign(db.prisma.secret, { findFirst: async () => null });
    const approval = (change: Partial<VaultLoginUse> = {}): VaultLoginUse => ({
      kind: "login",
      login: "bank",
      site: other,
      title: "bank.example.test",
      fields: ["Password"],
      savedAt: db.rows()[0]!.updatedAt!.toISOString(),
      ...change,
    });
    const fill = (field: string, given?: VaultLoginUse, code?: true) =>
      resolveLoginFill({
        prisma: db.prisma,
        secretStore,
        scope: { ...scope, botId: "bot-1" },
        runId: "run-1",
        name: "bank",
        field,
        pageUrl: `${other}/login`,
        approval: given,
        ...(code && { code }),
      });
    const refused = { error: "The user has not approved signing in with this login here." };
    expect(await fill("Password", approval({ site }))).toMatchObject({ origin: site });
    expect(await fill("Password", approval({ site: "https://old.bank.example.test" }))).toEqual(
      refused,
    );
    expect(await fill("Password", approval())).toMatchObject({
      text: "fake-bank-pass",
      origin: other,
    });
    expect(await fill(LOGIN_CODE_FIELD, undefined, true)).toEqual(refused);
    expect(await fill(LOGIN_CODE_FIELD, approval(), true)).toEqual(refused);
    expect(
      await fill(LOGIN_CODE_FIELD, approval({ fields: ["Password", LOGIN_CODE_FIELD] }), true),
    ).toMatchObject({ text: expect.stringMatching(/^\d{6}$/), hidden: true, origin: other });
  });

  it("never takes a field labelled as the code for the code, either way round", async () => {
    const db = fakeDatabase();
    const site = "https://bank.example.test";
    const label = "Authenticator code";
    await storeBotSecret({
      prisma: db.prisma,
      secretStore,
      scope,
      destination: { name: "bank", origin: site, auth: { type: "login" } },
      plaintext: encodeLoginSecret({
        fields: [{ label, value: "fake-backup-code", hidden: true }],
        otp: TEST_KEY,
      }),
      policy: "ask",
    });
    Object.assign(db.prisma.secret, { findFirst: async () => null });
    expect(LOGIN_CODE_FIELD.trim()).toBe(label);
    const approvedFor = (kind: string) => ({
      kind: "login" as const,
      login: "bank",
      site,
      title: "bank.example.test",
      fields: requestedLoginFills([{ kind, secret: "bank", field: label }]).get("bank")!,
      savedAt: db.rows()[0]!.updatedAt!.toISOString(),
    });
    const fill = (approval: VaultLoginUse, code: boolean) =>
      resolveLoginFill({
        prisma: db.prisma,
        secretStore,
        scope: { ...scope, botId: "bot-1" },
        runId: "run-1",
        name: "bank",
        field: code ? LOGIN_CODE_FIELD : label,
        pageUrl: `${site}/login`,
        approval,
        ...(code && { code: true as const }),
      });
    const refused = { error: "The user has not approved signing in with this login here." };
    expect(await fill(approvedFor("fill_secret"), false)).toMatchObject({
      text: "fake-backup-code",
    });
    expect.soft(await fill(approvedFor("fill_secret"), true)).toEqual(refused);
    expect(await fill(approvedFor("fill_code"), true)).toMatchObject({
      text: expect.stringMatching(/^\d{6}$/),
    });
    expect.soft(await fill(approvedFor("fill_code"), false)).toEqual(refused);
  });
});

describe("a login's authenticator code, wherever its password is refused", () => {
  const otp = TEST_KEY;
  const site = "https://bank.example.test";
  const password = { kind: "fill_secret", ref: "e1", secret: "bank", field: "Password" };
  const code = { kind: "fill_code", ref: "e2", secret: "bank" };
  async function saved(change: { policy?: VaultPolicy; bots?: VaultItemBots } = {}) {
    const db = fakeDatabase();
    await storeBotSecret({
      prisma: db.prisma,
      secretStore,
      scope,
      destination: { name: "bank", origin: site, auth: { type: "login" } },
      plaintext: encodeLoginSecret({
        fields: [{ label: "Password", value: "fake-bank-pass", hidden: true }],
        otp,
      }),
      ...change,
    });
    Object.assign(db.prisma.secret, { findFirst: async () => null });
    return db;
  }
  const filled =
    (db: ReturnType<typeof fakeDatabase>, as: BotSecretScope) =>
    async (step: typeof password | typeof code) => {
      const result = await resolveLoginFill({
        prisma: db.prisma,
        secretStore,
        scope: as,
        runId: "run-1",
        name: "bank",
        field: step.kind === "fill_code" ? LOGIN_CODE_FIELD : "Password",
        pageUrl: `${site}/login`,
        ...(step.kind === "fill_code" && { code: true as const }),
      });
      return "error" in result ? result.error : `typed ${result.hidden ? "hidden" : "visible"}`;
    };
  const gated =
    (db: ReturnType<typeof fakeDatabase>) => async (step: typeof password | typeof code) => {
      const args = { actions: [step] };
      const executionId = JSON.stringify(["pi-tool", "main", "call-1"]);
      const request: ToolRequest = {
        name: "browser_act",
        args,
        executionId,
        connectorCall: { tool: "browser_act", args, executionId, route: undefined },
        effectRequest: undefined,
        resolvedTool: undefined,
        catalogRemapped: false,
        nextApprovedTool: undefined,
        approvedEffectKey: undefined,
        replayEffectToolName: "browser_act",
        fleetSummary: undefined,
        heldForApproval: false,
        purchase: undefined,
        cardUse: undefined,
        loginUse: undefined,
      };
      const ctx = {
        deps: { prisma: db.prisma, secretStore },
        run: { ...scope, id: "run-1", botId: "bot-1", trigger: "webhook", threadId: "thread-1" },
        runId: "run-1",
        bot: { id: "bot-1", name: "Helper" },
        thread: { id: "thread-1" },
        source: { ownerStartedRun: false },
        providers: { browser: {} },
        computer: { pageBrowserAllowed: false, heldForTakeover: false },
        context: { signal: new AbortController().signal },
        secrets: [],
        tools: { connector: new Map(), connectedPlugins: [] },
        state: {
          walletHosts: new Set<string>(),
          tainted: false,
          effects: { consumedIds: new Set(), counts: new Map(), occurrences: [] },
        },
        trust: {
          initiator: "webhook",
          loadActionRules: async () => [],
          loadApprovalRules: async () => [],
          loadAutoReviewPreference: async () => ({ enabled: false, skipApprovals: false }),
          receivedOutsideMessage: async () => true,
        },
      };
      const prepared = await prepareToolRequest(ctx as never, request);
      if (prepared) return "error" in prepared ? prepared.error : "stopped";
      const outcome = await gateToolCall(ctx as never, request, undefined);
      const result = (outcome as { result?: { error?: string } }).result;
      return result?.error ?? "typed";
    };
  const bot = { ...scope, botId: "bot-1" };
  it.each([
    [
      "Blocked",
      () => saved({ policy: "off" }),
      (db: ReturnType<typeof fakeDatabase>) => filled(db, bot),
    ],
    [
      "not a chosen bot",
      () => saved({ bots: { allBots: false, botIds: ["bot-2"] } }),
      (db: ReturnType<typeof fakeDatabase>) => filled(db, bot),
    ],
    [
      "Ask first, unapproved",
      () => saved({ policy: "ask" }),
      (db: ReturnType<typeof fakeDatabase>) => filled(db, bot),
    ],
    ["a webhook run", () => saved({ policy: "ask" }), gated],
    [
      "another member's run",
      () => saved(),
      (db: ReturnType<typeof fakeDatabase>) =>
        filled(db, { userId: "user-2", spaceId: "space-1", botId: "bot-of-another-member" }),
    ],
  ])("refuses the code as the password: %s", async (_case, setup, attempt) => {
    const fill = attempt(await setup());
    const refused = await fill(password);
    expect(refused).not.toMatch(/^typed/);
    expect(await fill(code)).toBe(refused);
  });

  it("types both when nothing refuses them", async () => {
    const fill = filled(await saved(), bot);
    expect([await fill(password), await fill(code)]).toEqual(["typed hidden", "typed hidden"]);
  });
});

describe("an import's duplicate check", () => {
  it("reads each saved login of the site once, and knows the logins it just saved", async () => {
    const secretStore = new EncryptedSecretStore("test-only-encryption-key");
    const scope = { userId: "user-1", spaceId: "space-1" };
    const db = fakeDatabase();
    const login = (username: string) =>
      encodeLoginSecret({
        fields: [
          { label: "Username", value: username, hidden: false },
          { label: "Password", value: "fake-pass", hidden: true },
        ],
      });
    const save = (name: string, username: string, usernames?: Map<string, string>) =>
      storeBotSecret({
        prisma: db.prisma,
        secretStore,
        scope,
        destination: { name, origin: "https://shop.example.test", auth: { type: "login" } },
        plaintext: login(username),
        createOnly: true,
        newLoginOnly: usernames,
      });
    await save("saved", "alice");
    const usernames = new Map<string, string>();
    const load = vi.spyOn(secretStore, "load");
    for (const [index, username] of ["bob", "carol", "dave"].entries())
      await save(`new-${index}`, username, usernames);
    await expect(save("again", "carol", usernames)).rejects.toThrow("already saved");
    expect(load).toHaveBeenCalledTimes(1);
    load.mockRestore();
  });
});
