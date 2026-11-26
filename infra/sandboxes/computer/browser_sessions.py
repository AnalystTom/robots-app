from __future__ import annotations

import json
import os
import secrets
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.request
from typing import Any, Callable

if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))

import page_secrets  # noqa: E402

COMMIT_SECONDS = 45.0
COMMIT_POLL_SECONDS = 1.0
MARKER_URL = "https://commit.robots.invalid/"
MARKER_PREFIX = "robots_commit_"
PAST = 1
STORE_MARK = ".robots-password-store"
RESEAL_PENDING = ".robots-reseal-pending"
ENCRYPTED_STORE = "gnome-libsecret"


def belongs_to_site(domain: str, site: str) -> bool:
    host = domain.lstrip(".").lower()
    return host == site or host.endswith("." + site)


def cdp_cookie(cookie: dict[str, Any]) -> dict[str, Any]:
    domain = str(cookie["domain"]).lstrip(".")
    path = str(cookie.get("path") or "/")
    out: dict[str, Any] = {
        "name": cookie["name"],
        "value": cookie["value"],
        "path": path,
        "secure": bool(cookie.get("secure")),
        "httpOnly": bool(cookie.get("httpOnly")),
    }
    if cookie.get("hostOnly"):
        out["url"] = "https://" + domain + path
    else:
        out["domain"] = "." + domain
    if cookie.get("sameSite") in ("Strict", "Lax", "None"):
        out["sameSite"] = cookie["sameSite"]
    if isinstance(cookie.get("expires"), (int, float)) and cookie["expires"] > 0:
        out["expires"] = cookie["expires"]
    return out


def expired_copy(cookie: dict[str, Any]) -> dict[str, Any]:
    domain = str(cookie.get("domain") or "")
    out: dict[str, Any] = {
        "name": cookie["name"],
        "value": "",
        "path": cookie.get("path") or "/",
        "secure": bool(cookie.get("secure")),
        "httpOnly": bool(cookie.get("httpOnly")),
        "expires": PAST,
    }
    if domain.startswith("."):
        out["domain"] = domain
    else:
        out["url"] = "https://" + domain + out["path"]
    if cookie.get("partitionKey"):
        out["partitionKey"] = cookie["partitionKey"]
    return out


def browser_cookies(client: page_secrets.CdpClient) -> list[dict[str, Any]]:
    found = client.call("Storage.getCookies", timeout_s=20.0).get("cookies")
    return [cookie for cookie in found or [] if isinstance(cookie, dict)]


def browser_process(port: int, proc: str = "/proc") -> tuple[int, str | None] | None:
    flag = f" --remote-debugging-port={port} "
    for entry in os.listdir(proc):
        if not entry.isdigit():
            continue
        try:
            with open(os.path.join(proc, entry, "cmdline"), "rb") as handle:
                raw = handle.read()
        except OSError:
            continue
        text = " " + raw.replace(b"\0", b" ").decode("utf-8", "replace").strip() + " "
        if flag not in text or " --type=" in text:
            continue
        marker = " --user-data-dir="
        start = text.find(marker)
        if start < 0:
            return int(entry), None
        return int(entry), existing_dir_prefix(text[start + len(marker):])
    return None


def existing_dir_prefix(rest: str) -> str | None:
    cuts = [index for index, char in enumerate(rest) if char == " "] + [len(rest)]
    for cut in cuts:
        candidate = rest[:cut]
        if candidate and os.path.isdir(candidate):
            return candidate
    return None


def profile_dir_for_port(port: int, proc: str = "/proc") -> str | None:
    found = browser_process(port, proc)
    return found[1] if found else None


def cookies_db(profile: str) -> str | None:
    for relative in (("Default", "Network", "Cookies"), ("Default", "Cookies")):
        path = os.path.join(profile, *relative)
        if os.path.exists(path):
            return path
    return None


def stored_names(profile: str) -> set[str]:
    path = cookies_db(profile)
    if not path:
        return set()
    with tempfile.TemporaryDirectory(prefix="robots-cookies-") as tmp:
        copy = os.path.join(tmp, "Cookies")
        shutil.copyfile(path, copy)
        for suffix in ("-journal", "-wal"):
            if os.path.exists(path + suffix):
                shutil.copyfile(path + suffix, copy + suffix)
        connection = sqlite3.connect(copy)
        try:
            return {row[0] for row in connection.execute("SELECT name FROM cookies")}
        finally:
            connection.close()


def wait_for_commit(profile: str, marker: str, deadline: float,
                    names: Callable[[str], set[str]] = stored_names) -> bool:
    while time.monotonic() < deadline:
        try:
            if marker in names(profile):
                return True
        except (OSError, sqlite3.Error):
            pass
        time.sleep(COMMIT_POLL_SECONDS)
    return False


def keyed_profile(profile: str) -> bool:
    try:
        with open(os.path.join(profile, STORE_MARK), encoding="utf-8") as mark:
            return mark.read().strip() == ENCRYPTED_STORE
    except OSError:
        return False


def import_sessions(port: int, request: dict[str, Any]) -> dict[str, Any]:
    profile = profile_dir_for_port(port)
    if not profile:
        raise RuntimeError("The browser's profile could not be found.")
    if not keyed_profile(profile):
        return {"ok": False, "error": "The browser's key is not ready, so the sign-ins were not saved."}
    return apply_sessions(port, request)


def apply_sessions(port: int, request: dict[str, Any],
                   commit_seconds: float = COMMIT_SECONDS) -> dict[str, Any]:
    sites = request.get("sites") or []
    replaced = [str(entry["site"]).lower() for entry in sites]
    cleared = [str(site).lower() for site in request.get("clear") or []]
    reseal = bool(request.get("reseal"))
    profile = profile_dir_for_port(port)
    if not profile:
        raise RuntimeError("The browser's profile could not be found.")
    client = page_secrets.connect(port)
    try:
        current = browser_cookies(client)
        stale = [cookie for cookie in current
                 if any(belongs_to_site(str(cookie.get("domain") or ""), site) for site in replaced + cleared)
                 or str(cookie.get("name") or "").startswith(MARKER_PREFIX)]
        if stale:
            client.call("Storage.setCookies", {"cookies": [expired_copy(cookie) for cookie in stale]},
                        timeout_s=20.0)
        fresh = [cdp_cookie(cookie) for entry in sites for cookie in entry.get("cookies") or []]
        if reseal:
            fresh += [resealed(cookie) for cookie in current if cookie not in stale]
        if fresh:
            client.call("Storage.setCookies", {"cookies": fresh}, timeout_s=20.0)
        marker = MARKER_PREFIX + secrets.token_hex(8)
        client.call("Storage.setCookies", {"cookies": [{
            "name": marker, "value": "1", "url": MARKER_URL, "secure": True,
            "expires": int(time.time()) + 600,
        }]}, timeout_s=10.0)
    finally:
        client.close()
    committed = wait_for_commit(profile, marker, time.monotonic() + commit_seconds)
    if not committed:
        return {"ok": False, "error": "The browser did not save the sign-ins in time."}
    return {"ok": True, "set": len(fresh), "cleared": len(stale), "sites": replaced, "removed": cleared}


def resealed(cookie: dict[str, Any]) -> dict[str, Any]:
    out = {key: cookie[key] for key in ("name", "value", "path", "secure", "httpOnly") if key in cookie}
    domain = str(cookie.get("domain") or "")
    if domain.startswith("."):
        out["domain"] = domain
    else:
        out["url"] = "https://" + domain + str(cookie.get("path") or "/")
    if cookie.get("sameSite") in ("Strict", "Lax", "None"):
        out["sameSite"] = cookie["sameSite"]
    if not cookie.get("session") and isinstance(cookie.get("expires"), (int, float)) and cookie["expires"] > 0:
        out["expires"] = cookie["expires"]
    if cookie.get("partitionKey"):
        out["partitionKey"] = cookie["partitionKey"]
    return out


def public_key_rows(profile: str) -> int:
    path = cookies_db(profile)
    if not path:
        return 0
    with tempfile.TemporaryDirectory(prefix="robots-cookies-") as tmp:
        copy = os.path.join(tmp, "Cookies")
        shutil.copyfile(path, copy)
        for suffix in ("-journal", "-wal"):
            if os.path.exists(path + suffix):
                shutil.copyfile(path + suffix, copy + suffix)
        connection = sqlite3.connect(copy)
        try:
            row = connection.execute(
                "SELECT count(*) FROM cookies WHERE substr(encrypted_value, 1, 3) = CAST('v10' AS BLOB)").fetchone()
            return int(row[0]) if row else 0
        finally:
            connection.close()


def wait_for_browser(port: int, deadline: float) -> bool:
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1.0) as response:
                json.loads(response.read(65536).decode("utf-8"))
                return True
        except (OSError, ValueError):
            time.sleep(0.5)
    return False


def mark_keyed(profile: str) -> None:
    with open(os.path.join(profile, STORE_MARK), "w", encoding="utf-8") as mark:
        mark.write(ENCRYPTED_STORE + "\n")
    if os.path.exists(os.path.join(profile, RESEAL_PENDING)):
        os.remove(os.path.join(profile, RESEAL_PENDING))


def reseal(profile: str, port: int) -> dict[str, Any]:
    if public_key_rows(profile) > 0:
        if not wait_for_browser(port, time.monotonic() + 60.0):
            return {"ok": False, "error": "The browser did not start."}
        result = apply_sessions(port, {"sites": [], "clear": [], "reseal": True})
        if not result["ok"]:
            return result
        if public_key_rows(profile) > 0:
            open(os.path.join(profile, RESEAL_PENDING), "w", encoding="utf-8").close()
            return {"ok": False, "error": "Some sign-ins still use the public key, so the profile stays closed."}
    mark_keyed(profile)
    return {"ok": True}


def finish_closed_migration(profile: str) -> dict[str, Any]:
    if not os.path.exists(os.path.join(profile, RESEAL_PENDING)):
        return {"ok": True, "purged": 0}
    path = cookies_db(profile)
    purged = 0
    if path:
        connection = sqlite3.connect(path)
        try:
            with connection:
                cursor = connection.execute(
                    "DELETE FROM cookies WHERE substr(encrypted_value, 1, 3) = CAST('v10' AS BLOB)")
                purged = cursor.rowcount
        finally:
            connection.close()
    mark_keyed(profile)
    return {"ok": True, "purged": purged}


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "reseal":
        print(json.dumps(reseal(sys.argv[2], int(sys.argv[3]))))
    elif len(sys.argv) == 3 and sys.argv[1] == "finish-migration":
        print(json.dumps(finish_closed_migration(sys.argv[2])))
