# Private hosted workspace on Cloudflare

This deployment runs registration, the workspace API and the job worker in one Cloudflare Container. A separate PostgreSQL database stores accounts and subscriptions. A private R2 bucket stores workspace homes and artifacts. The Cloudflare Access application controls who can enter the staging site. The public landing page continues to collect waitlist registrations.

## Prepare the staging account

1. Create a Cloudflare Access self-hosted application for `hosted-test.tryrobots.app`. Allow the owner's email or an explicitly selected test group. Record its team issuer, including `https://`, and application audience. Create a more specific Access application with a Bypass policy for the exact path `hosted-test.tryrobots.app/api/v1/billing/webhook`. The Worker checks the method and the API verifies Stripe's signature.
2. Create a dedicated TLS PostgreSQL database named `robots_hosted_test`. Use a direct connection that supports LISTEN/NOTIFY for the application. Run the repository's migration with `DATABASE_MIGRATION_URL` set to this database's owner connection and `DATABASE_URL` set to its separate runtime login. Both must name the staging database. The runtime connection requires `sslmode=require`, `verify-ca` or `verify-full`. Keep the migration credential outside the Worker.
3. Create the private R2 bucket and an S3-compatible credential scoped to that bucket. Generate separate authentication, encryption and screen proxy secrets for this deployment. Preserve the encryption key for future restores. Use the approved secret store.
4. In Stripe's sandbox, create one recurring US$20 monthly price for a workspace. Enable customer portal cancellations. Create a sandbox webhook endpoint at `https://hosted-test.tryrobots.app/api/v1/billing/webhook`. Subscribe to checkout completion, subscription creation, updates and deletions, invoice payment success and failure, and customer deletion.
5. Supply the Worker settings below through an approved deployment secret injection. The app checks the sandbox key and the exact price with Stripe at startup.

| Setting | Value |
| --- | --- |
| ACCESS_ISSUER, ACCESS_AUD | The Cloudflare Access team URL and staging application audience |
| DATABASE_URL | Dedicated runtime login for the migrated staging database |
| ENCRYPTION_KEY, BETTER_AUTH_SECRET, SCREEN_PROXY_SECRET | Separate persistent high-entropy secrets for this staging app |
| OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_ENDPOINT | Private R2 bucket name and account S3 endpoint |
| OBJECT_STORAGE_ACCESS_KEY_ID, OBJECT_STORAGE_SECRET_ACCESS_KEY | R2 credential for that bucket |
| STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID | Stripe sandbox API key, endpoint signing secret and US$20 monthly price ID |

## Build and deploy

Build the private Linux AMD64 application image from a clean checkout of the release revision. From the repository root:

```sh
git archive HEAD | docker build --platform linux/amd64 -f infra/compose/Dockerfile -t localhost/robots-hosted-stripe-test-base:local -
cd infra/registration/cloudflare
npm ci
npm test
npm run deploy
```

The Worker uses only the staging hostname. It denies access while Access settings are missing. Configure the settings on `robots-hosted-stripe-test` and redeploy with them preserved. Cloudflare Containers require billing-enabled infrastructure. A single instance sleeps after 15 minutes without requests. Jobs that must run while the instance sleeps and hosted bot computers are outside this registration test.

## Verify a hosted signup

1. Open the staging domain in a fresh browser. Confirm Cloudflare requests an Access login and a user outside the allowlist cannot open signup.
2. As an approved tester, open `/sign-up`, create a new account and select Subscribe. Confirm Stripe Checkout shows one US$20 monthly workspace. Complete it with a Stripe sandbox card.
3. In Stripe, confirm the signed webhook received a successful response. Return to RoBots and open the workspace. A second test account should see only its own workspace.
4. Open Settings → Billing → Manage, cancel in the Stripe sandbox portal, and confirm the workspace closes when the subscription entitlement ends. Check that a request with an invalid webhook signature returns HTTP 400.
