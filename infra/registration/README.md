# Private registration preview

Open [Choose your setup](http://localhost:5194/api/registration) on the machine running the preview. The hosted workspace costs US$20 per month in simulated checkout. It uses the customer's model account. Confirming a test subscription activates one workspace. Ending it in billing removes workspace access. The preview uses its own PostgreSQL and local payment simulator. It accepts no payment credentials.

The free installer includes the Linux x86-64 app, computer, database and utility images. Extract the archive and run `bash install-local.sh` on a machine with Docker Engine, Docker Compose, Bash and OpenSSL. The installer prints the local signup URL. Each installation keeps its own database and encryption settings.

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

The journeys create new test accounts and exercise signup, returning sign-in, checkout, cancellation and cross-workspace access. Screenshots are under `apps/web/test-results/registration`.
