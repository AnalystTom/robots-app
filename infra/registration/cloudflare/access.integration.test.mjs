import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { origin, privateStagingRequest } from "./access.mjs";

const env = {
  ACCESS_ISSUER: "https://robots-test.cloudflareaccess.com",
  ACCESS_AUD: "private-application",
};
const { publicKey, privateKey } = await generateKeyPair("RS256");
const signed = (audience) =>
  new SignJWT({ email: "tester@example.test" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(env.ACCESS_ISSUER)
    .setAudience(audience)
    .setSubject("tester")
    .setExpirationTime("5m")
    .sign(privateKey);
const guard = (request) => privateStagingRequest(request, env, () => publicKey);

test("only an Access login for this private application reaches signup", async () => {
  const url = `${origin}/sign-up`;
  assert.equal((await guard(new Request(url))).status, 403);
  for (const token of ["untrusted", await signed("another-application")]) {
    assert.equal(
      (await guard(new Request(url, { headers: { "cf-access-jwt-assertion": token } }))).status,
      403,
    );
  }
  const request = new Request(url, {
    headers: {
      "cf-access-jwt-assertion": await signed(env.ACCESS_AUD),
      cookie: "CF_Authorization=test-only; session=workspace",
    },
  });
  const forwarded = await guard(request);
  assert.ok(forwarded instanceof Request);
  assert.equal(forwarded.headers.get("cookie"), "session=workspace");
  assert.equal(forwarded.headers.get("cf-access-jwt-assertion"), null);
  assert.equal(
    (await guard(new Request("https://app.tryrobots.app/sign-up", request))).status,
    404,
  );
});

test("only the Stripe webhook POST can reach the signature verifier without Access", async () => {
  const url = `${origin}/api/v1/billing/webhook`;
  assert.equal((await guard(new Request(url))).status, 403);
  const webhook = {
    method: "POST",
    headers: { "stripe-signature": "t=example,v1=example" },
    body: "original payload",
  };
  const forwarded = await guard(new Request(url, webhook));
  assert.ok(forwarded instanceof Request);
  assert.equal(await forwarded.text(), "original payload");
  assert.equal(forwarded.headers.get("stripe-signature"), webhook.headers["stripe-signature"]);
  assert.equal((await guard(new Request(`${origin}/rpc/billing/checkout`, webhook))).status, 403);
  assert.equal((await privateStagingRequest(new Request(url, webhook), {})).status, 503);
});
