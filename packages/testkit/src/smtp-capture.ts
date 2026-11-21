import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";

export interface CapturedMail {
  login: { user: string; password: string };
  envelope: { from: string; to: string[] };
  headers: ReadonlyMap<string, string>;
  text: string;
  html: string;
}

export interface SmtpCapture {
  readonly messages: readonly CapturedMail[];
  smtpsUrl(user: string, password: string): string;
  close(): Promise<void>;
}

type Part = { type: string; content: string };

export async function startSmtpCapture(): Promise<SmtpCapture> {
  const { key, cert } = selfSignedLoopbackCertificate();
  const trustedBefore = tls.getCACertificates("default");
  tls.setDefaultCACertificates([...trustedBefore, cert]);
  const messages: CapturedMail[] = [];
  const server = tls.createServer({ key, cert }, (socket) => {
    socket.setEncoding("utf8");
    let buffered = "";
    let login = { user: "", password: "" };
    let envelope: CapturedMail["envelope"] = { from: "", to: [] };
    let data: string | undefined;
    const reply = (line: string) => socket.write(`${line}\r\n`);
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk: string) => {
      buffered += chunk;
      for (;;) {
        if (data !== undefined) {
          const end = buffered.indexOf("\r\n.\r\n");
          if (end < 0) return;
          data += buffered.slice(0, end);
          buffered = buffered.slice(end + 5);
          messages.push({ login, envelope, ...parseMessage(unstuffDots(data)) });
          envelope = { from: "", to: [] };
          data = undefined;
          reply("250 2.0.0 captured");
          continue;
        }
        const lineEnd = buffered.indexOf("\r\n");
        if (lineEnd < 0) return;
        const line = buffered.slice(0, lineEnd);
        buffered = buffered.slice(lineEnd + 2);
        const verb = line.split(" ", 1)[0]!.toUpperCase();
        if (verb === "EHLO" || verb === "HELO") {
          reply("250-capture.test");
          reply("250-AUTH PLAIN");
          reply("250 8BITMIME");
        } else if (verb === "AUTH") {
          const [, user = "", password = ""] = Buffer.from(line.split(" ")[2] ?? "", "base64")
            .toString("utf8")
            .split("\0");
          login = { user, password };
          reply("235 2.7.0 accepted");
        } else if (verb === "MAIL") {
          envelope.from = addressIn(line);
          reply("250 2.1.0 ok");
        } else if (verb === "RCPT") {
          envelope.to.push(addressIn(line));
          reply("250 2.1.5 ok");
        } else if (verb === "DATA") {
          data = "";
          reply("354 end with <CRLF>.<CRLF>");
        } else if (verb === "QUIT") {
          reply("221 2.0.0 bye");
          socket.end();
          return;
        } else reply("250 2.0.0 ok");
      }
    });
    reply("220 capture.test ESMTP");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    messages,
    smtpsUrl: (user, password) =>
      `smtps://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      tls.setDefaultCACertificates(trustedBefore);
    },
  };
}

function selfSignedLoopbackCertificate() {
  const dir = mkdtempSync(join(tmpdir(), "robots-smtp-capture-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
    return {
      key: readFileSync(join(dir, "key.pem"), "utf8"),
      cert: readFileSync(join(dir, "cert.pem"), "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function addressIn(line: string): string {
  return /<([^>]*)>/.exec(line)?.[1] ?? "";
}

function unstuffDots(data: string): string {
  return data.replace(/^\.\./gm, ".");
}

function parseMessage(raw: string): Pick<CapturedMail, "headers" | "text" | "html"> {
  const { headers, body } = splitHead(raw);
  const parts = leafParts(headers, body);
  return {
    headers,
    text: parts.find((part) => part.type === "text/plain")?.content ?? "",
    html: parts.find((part) => part.type === "text/html")?.content ?? "",
  };
}

function splitHead(raw: string): { headers: Map<string, string>; body: string } {
  const split = raw.indexOf("\r\n\r\n");
  const head = split < 0 ? raw : raw.slice(0, split);
  const headers = new Map<string, string>();
  for (const field of head.replace(/\r\n[ \t]+/g, " ").split("\r\n")) {
    const colon = field.indexOf(":");
    if (colon > 0)
      headers.set(field.slice(0, colon).trim().toLowerCase(), field.slice(colon + 1).trim());
  }
  return { headers, body: split < 0 ? "" : raw.slice(split + 4) };
}

function leafParts(headers: ReadonlyMap<string, string>, body: string): Part[] {
  const contentType = headers.get("content-type") ?? "text/plain";
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (contentType.toLowerCase().startsWith("multipart/") && boundary) {
    return body
      .split(`--${boundary}`)
      .slice(1)
      .filter((part) => !part.startsWith("--"))
      .flatMap((part) => {
        const nested = splitHead(part.replace(/^\r\n/, ""));
        return leafParts(nested.headers, nested.body.replace(/\r\n$/, ""));
      });
  }
  return [
    {
      type: contentType.split(";")[0]!.trim().toLowerCase(),
      content: decodeBody(body, headers.get("content-transfer-encoding")),
    },
  ];
}

function decodeBody(body: string, encoding = "7bit"): string {
  switch (encoding.toLowerCase()) {
    case "quoted-printable":
      return Buffer.from(
        body
          .replace(/=\r\n/g, "")
          .replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
        "latin1",
      ).toString("utf8");
    case "base64":
      return Buffer.from(body, "base64").toString("utf8");
    default:
      return body;
  }
}
