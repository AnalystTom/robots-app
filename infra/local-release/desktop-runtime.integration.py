import json
import os
import secrets
import subprocess
import tempfile
import urllib.request
import uuid
from http.cookiejar import CookieJar
from pathlib import Path

root = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix="robots-desktop-runtime-") as tmp:
    stage = Path(tmp)
    config = stage / "docker-compose.images.yml"
    subprocess.run(
        ["node", root / "apps/desktop/scripts/package-local-stack.mjs", stage],
        check=True,
    )
    command = [
        "docker",
        "compose",
        "-p",
        "robots-test-" + uuid.uuid4().hex[:12],
        "-f",
        config,
    ]
    env = {
        **os.environ,
        "DOCKER_CONFIG": tmp,
        "ROBOTS_IMAGE_TAG": "v0.11.0",
        "ROBOTS_WEB_PORT": "0",
        "ROBOTS_API_PORT": "0",
        "ROBOTS_WEB_BIND": "127.0.0.1",
    }
    for key in (
        "POSTGRES_PASSWORD",
        "POSTGRES_APP_PASSWORD",
        "SCREEN_PROXY_SECRET",
        "BETTER_AUTH_SECRET",
        "ENCRYPTION_KEY",
        "SANDBOX_SUPERVISOR_TOKEN",
        "ROBOTS_DESKTOP_STACK_TOKEN",
    ):
        env[key] = secrets.token_hex(32)

    def compose(*args, **options):
        return subprocess.run(
            [*command, *args], env=env, check=True, text=True, **options
        )

    images = set(compose("config", "--images", capture_output=True).stdout.splitlines())
    released = [
        image
        for image in images
        if image.startswith("downloads.tryrobots.app/robots/") and "@sha256:" in image
    ]
    assert len(released) == 2 and not any("ghcr.io" in image for image in images), (
        images
    )
    browser = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(CookieJar())
    )
    try:
        compose("pull")
        compose("up", "-d", "--pull", "never", "--wait", "--wait-timeout", "240")
        address = compose("port", "web", "5173", capture_output=True).stdout.strip()
        assert address.startswith("127.0.0.1:")
        origin = "http://" + address
        env.update(
            WEB_ORIGIN=origin,
            BETTER_AUTH_URL=origin,
            API_URL=origin,
            ROBOTS_WEB_PORT=address.rsplit(":", 1)[1],
        )
        compose("up", "-d", "--pull", "never", "--wait", "--wait-timeout", "240")
        probe = urllib.request.Request(
            origin + "/.well-known/robots-desktop-stack",
            headers={"x-robots-desktop-stack-token": env["ROBOTS_DESKTOP_STACK_TOKEN"]},
        )
        assert json.load(browser.open(probe, timeout=15)) == {
            "ok": True,
            "imageTag": env["ROBOTS_IMAGE_TAG"],
        }
        account = {
            "email": "desktop-" + uuid.uuid4().hex + "@example.test",
            "name": "Desktop test",
            "password": secrets.token_hex(20),
        }
        for route, data in [
            ("/api/auth/sign-up/email", account),
            ("/rpc/bots/list", {"json": {}}),
        ]:
            request = urllib.request.Request(
                origin + route,
                data=json.dumps(data).encode(),
                headers={"Origin": origin, "Content-Type": "application/json"},
            )
            with browser.open(request, timeout=25) as response:
                assert response.status == 200 and json.load(response) is not None
        print(
            "Anonymous image pull, desktop startup probe, local signup and authenticated bot list passed."
        )
    finally:
        compose("down", "--volumes", "--remove-orphans")
