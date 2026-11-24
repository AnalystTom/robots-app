# Free private workspace staging on bigmachine1

This Compose project runs the web app, API, job worker and PostgreSQL on bigmachine1. A private Docker volume holds workspace files. The database and workspace have separate volumes from the personal installation. The web server and database have no published ports. Docker restarts the services when the daemon starts.

## Start and check

Set `STAGING_OWNER_EMAIL` to the same individual email used for the personal workspace owner. Set `STAGING_IMAGE` to the private application image built by `infra/compose/Dockerfile`. The installed revision uses `robots-hosted-test/app:staging-2b09978`.

```sh
bash infra/registration/bigmachine/start.sh
bash infra/registration/bigmachine/verify.integration.sh
```

The start script reads five staging-only secrets from the RoBots Infisical project. The runtime and migration roles use separate passwords. The script starts with registration closed. The verification checks that the sign-in page loads, anonymous workspace access fails, an unlisted email cannot register, PostgreSQL serves the staging database and the containers have no host port mappings.

## Connect the owner through Cloudflare

1. In the tryrobots.app account, create a self-hosted Access application for `hosted-test.tryrobots.app`. Add a single Allow policy whose only include rule is the owner's exact email. Enable a login method that verifies the mailbox. Record the Access team name and application audience.
2. Create a dedicated remotely managed Cloudflare Tunnel named `robots-owner-staging`. Run its connector on the Compose network `robots-hosted-test_frontend`, using its tunnel token from the approved credential provider.
3. Route only the staging hostname to `http://web:5173`. Set the HTTP Host header to `hosted-test.tryrobots.app`. Enable Access JWT validation at the connector with the recorded team name and audience. Set the fallback ingress to HTTP 404. Point the staging DNS record to the new tunnel once the policy is verified.
4. Verify an anonymous browser is redirected to Cloudflare Access and an unlisted identity cannot enter. After the owner authenticates, run the start script with `STAGING_SIGNUPS_ENABLED=true`, register the owner, then run it again with the default closed setting. Verify the owner can sign back in.
5. The local staging profile uses local persistent storage and has billing disconnected. Keep the public landing page on the waitlist. Real sandbox checkout requires the Stripe test integration and a separately verified, signature-checked webhook route.
