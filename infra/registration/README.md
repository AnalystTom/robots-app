# Register for RoBots

Open **Choose your setup** on the machine running the private preview. **Run locally** is free and stores your workspace on your computer. **Hosted workspace** uses a simulated US$20 monthly subscription per workspace. Both options use your own model account. [Open the registration preview](http://localhost:5194/api/registration)

[View the setup screen](screenshots/choose-setup.png)

## Create a free local account

1. Choose **Set up locally**, then **Download the local installer**. The download is about 1.3 GB. Use a Linux x86-64 machine with Docker Engine running, Docker Compose, Bash and OpenSSL.
2. Open a terminal in the download directory and run the commands below. Keep the extracted folder for subsequent starts. It contains the configuration for this installation.

   ```sh
   tar -xzf robots-local-linux-amd64.tar.gz
   cd robots-local
   bash install-local.sh
   ```

3. When the installer prints **Create your local account at …**, open that address on the same computer. With the default ports it is [local signup](http://127.0.0.1:5193/sign-up).
4. Enter your name, email and password, then choose **Create account**. RoBots opens your local workspace or its onboarding screen. Local registration requires no subscription.
5. To return, open the same local installation, choose **Sign in**, and enter the same email and password. With the default ports, use [local sign-in](http://127.0.0.1:5193/sign-in).

## Create a hosted test account

1. On **Choose your setup**, choose **Create a hosted account**.
2. Enter your name, email and password. Choose **Create account**. Your account now exists and RoBots displays **Subscribe**. Workspace access starts after confirmation.
3. Choose **Subscribe**. The **Test checkout** page shows **Hosted workspace** at **US$20 / month**. It has no card form and makes no charge.
4. Choose **Confirm test subscription**. RoBots returns you to your own workspace. To return later, choose **Sign in** on the setup page and use your hosted credentials.

[View the test checkout screen](screenshots/test-checkout.png)

### Leave checkout or end a test subscription

- **Before confirming**, choose **Back to RoBots**. The workspace stays unpaid. You can sign in later with the same account and choose **Subscribe** to open a new checkout.
- **After confirming**, open the account menu in the workspace sidebar. Choose **Settings → Billing → Manage**, then **End test subscription**. RoBots displays **Subscribe** again and blocks workspace access. The account remains available for sign-in.

The hosted preview uses its own database and payment simulator. Hosted bot computers are disabled in this preview. Registration testing covers access to the workspace. Connecting a model and running a bot require separate setup.

## Run the preview

Build the app and computer images from the checkout if they are not already available.

```sh
docker build -f infra/compose/Dockerfile -t robots-registration/app:local .
docker build -f infra/sandboxes/computer/Dockerfile -t robots/computer:local infra/sandboxes/computer
docker pull postgres:16@sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5
docker pull busybox:1
pnpm install --frozen-lockfile
bash infra/registration/start-preview.sh
```

The launcher binds the web port to loopback, keeps the preview database on a dedicated Docker network, and stores preview settings and the local download under `$XDG_DATA_HOME/robots-registration` (default `~/.local/share/robots-registration`). Hosted registration is exercised with sandbox computers disabled. The local package includes the Docker computer provider.

## Browser verification

Start both installs and run the registration journeys.

```sh
pnpm --filter @robots/web exec playwright test -c playwright.registration.config.ts
```

Each run creates fresh test accounts. The browser downloads the full installer, so allow about 1.3 GB of temporary disk space. Screenshots are under `apps/web/test-results/registration`.

### Results from 23 November 2026

Both Chromium journeys passed in 32.6 seconds against the private preview and the local Linux installation. The API typecheck and all 37 billing provider and webhook checks also passed.

| Action tested | Observed result |
| --- | --- |
| Download and install locally | The 1,287,929,894-byte download matched the packaged archive byte for byte. Rerunning its installer in the existing test installation printed the local signup URL on port 5193. |
| Create a local account and sign back in | The browser accepted the credentials. Billing was disabled and the workspace API returned HTTP 200. |
| Leave hosted checkout, sign back in and retry | The first checkout closed. The unpaid account returned to **Subscribe** and could open a new checkout. Opening the billing return URL alone kept the workspace locked. |
| Confirm checkout and sign back in | Billing reported one active workspace at US$20 per month. The workspace API returned HTTP 200. |
| Open another customer's checkout or workspace | Two independently registered users had different workspaces. Each could use their own. Requests for the other user's checkout or workspace were denied. |
| End the test subscription in Settings | Billing showed **Active** before cancellation. Ending the subscription brought back **Subscribe**, and the workspace API returned HTTP 402. |

Verification covered Chromium on Linux and a repeat install on the existing Docker test stack. Live charges, monthly renewals, model execution and installation on a clean operating system were outside this run.

## Test a Stripe-hosted checkout

The `stripe-test` profile runs a separate database and Docker project on localhost port 5195. The public website continues to offer the hosted waitlist. The sandbox uses the application's Checkout, billing portal, signed webhook and account access checks.

1. In your Stripe sandbox, create a recurring **US$20 per month** price for one hosted workspace. Enable the customer portal for that sandbox and allow cancellations.
2. Forward sandbox events with Stripe CLI using `stripe listen --forward-to http://localhost:5195/api/v1/billing/webhook`. Use that listener's signing secret for this run.
3. Inject the sandbox key, signing secret and price ID as `ROBOTS_STRIPE_TEST_SECRET_KEY`, `ROBOTS_STRIPE_TEST_WEBHOOK_SECRET` and `ROBOTS_STRIPE_TEST_PRICE_ID`. Run `bash infra/registration/start-preview.sh stripe-test`. The API checks the price and currency with Stripe before accepting traffic.
4. Open [private test registration](http://localhost:5195/api/registration), create a test account, choose Subscribe, and complete Stripe Checkout with a sandbox card. Check workspace access, cancellation in the sandbox customer portal, and loss of access when the paid period ends.
