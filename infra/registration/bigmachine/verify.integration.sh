#!/usr/bin/env bash
set -euo pipefail
project=robots-hosted-test
for service in postgres api worker web; do
  id=$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service")
  [[ -n "$id" && -z "$(docker port "$id")" ]]
done
database=$(docker exec "$project-postgres-1" psql -XAt -v ON_ERROR_STOP=1 -U robots_hosted_migrator -d robots_hosted_test -c 'select current_database()')
[[ "$database" == robots_hosted_test ]]
docker exec -i "$project-web-1" node --input-type=module - <<'JS'
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const url = "http://127.0.0.1:5173";
const headers = { host: "hosted-test.tryrobots.app", origin: "https://hosted-test.tryrobots.app", "content-type": "application/json" };
const post = (path, body) => fetch(url + path, { method: "POST", headers, body: JSON.stringify(body) });
const page = await fetch(url + "/sign-in", { headers });
assert.equal(page.status, 200);
assert.match(await page.text(), /<html/i);
assert.equal((await post("/rpc/me", { json: {} })).status, 401);
const signup = await post("/api/auth/sign-up/email", { name: "Staging check", email: "unlisted-" + randomUUID() + "@example.invalid", password: randomUUID() });
assert.ok([400, 403].includes(signup.status));
const body = await signup.json();
assert.match(body.code, /^(EMAIL_NOT_ALLOWED|REGISTRATION_CLOSED)$/);
console.log("Sign-in page returned 200, anonymous workspace returned 401, unlisted signup returned", signup.status, body.code);
JS
echo "Workspace and database have no published ports. Dedicated database: $database."
