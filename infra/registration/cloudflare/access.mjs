import { createRemoteJWKSet, jwtVerify } from "jose";

export const origin = "https://hosted-test.tryrobots.app";
const keysForIssuer = new Map();

export async function privateStagingRequest(request, env, resolveKeys = remoteKeys) {
  const url = new URL(request.url);
  if (url.origin !== origin) return new Response(null, { status: 404 });
  if (!env.ACCESS_AUD || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER))
    return new Response(null, { status: 503 });
  const webhook = request.method === "POST" && url.pathname === "/api/v1/billing/webhook";
  if (webhook && !request.headers.has("stripe-signature"))
    return new Response(null, { status: 400 });
  if (!webhook) {
    try {
      const token = request.headers.get("cf-access-jwt-assertion");
      if (!token) return new Response(null, { status: 403 });
      const { payload } = await jwtVerify(token, resolveKeys(env.ACCESS_ISSUER), {
        issuer: env.ACCESS_ISSUER,
        audience: env.ACCESS_AUD,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "email", "exp"],
      });
      if (typeof payload.email !== "string" || !payload.email)
        return new Response(null, { status: 403 });
    } catch {
      return new Response(null, { status: 403 });
    }
  }
  const forwarded = new Request(request);
  forwarded.headers.delete("cf-access-jwt-assertion");
  const cookies = (forwarded.headers.get("cookie") ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value && !/^CF_Authorization=/i.test(value));
  if (cookies.length) forwarded.headers.set("cookie", cookies.join("; "));
  else forwarded.headers.delete("cookie");
  return forwarded;
}

function remoteKeys(issuer) {
  if (!keysForIssuer.has(issuer))
    keysForIssuer.set(issuer, createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer)));
  return keysForIssuer.get(issuer);
}
