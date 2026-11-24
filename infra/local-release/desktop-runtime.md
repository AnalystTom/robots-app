# Desktop local workspace

The packaged desktop app pulls the compiled application and computer images from `downloads.tryrobots.app`. Docker Desktop runs Linux containers on Windows and Mac. The current images are Linux x86-64. Apple silicon needs Docker Desktop's x86-64 emulation. The Mac build and its emulation path still need a macOS launch test.

The registry serves the two runtime manifests and their content-addressed layers from the public downloads bucket. The published images match the compiled images inside the November 23 Linux installer. Each packaged app pins both manifest digests in `desktop-images.json`. The packaging check verifies those pins against the resources inside the installer.

Run the integration journey from the repository root on an x86-64 Docker host with dependencies installed.

```sh
python infra/local-release/desktop-runtime.integration.py
```

The journey uses an empty Docker credential directory, starts an isolated Compose project, verifies the desktop startup handshake, creates a local user, lists their bots and removes the test volumes. Docker may reuse previously downloaded layers.

## Publish the approved images

Extract the verified public installer's `robots-local/images.tar` to an empty directory. That directory must contain `blobs/sha256`. Set the release version and the approved per-platform manifest digests in `desktop-images.json`. With bucket access injected into the release process, run the publisher against the R2 S3 endpoint.

```sh
uv run --with boto3 infra/local-release/publish-desktop-runtime.py /path/to/layout --endpoint "https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
```

The publisher verifies the manifest, configuration and every layer before upload. It writes release tags after the layers and refuses to replace an existing tag with a different digest. Run the desktop integration journey against the published registry before packaging installers.
