import hashlib
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time

sys.path[:0] = ["/usr/local/lib/robots"]

import browser_sessions  # noqa: E402
import page_secrets  # noqa: E402

PORT = 9222
PROFILE = "/home/robots/.browser-profiles/chromium"
KEY_FILE = "/tmp/robots/browser-store-key"
HELD_KEY = "/tmp/robots/browser-store-key.held"
PUBLIC_PASSWORD = b"peanuts"
LEGACY = {"name": "legacy_sign_in", "value": "legacy-fake-value", "domain": "example.com",
          "hostOnly": False, "path": "/", "secure": True, "httpOnly": True,
          "expires": int(time.time()) + 30 * 86400}
IMPORTED = {"name": "imported_sign_in", "value": "imported-fake-value", "domain": "example.org",
            "hostOnly": False, "path": "/", "secure": True, "httpOnly": True, "sameSite": "Lax",
            "expires": int(time.time()) + 30 * 86400}


def launch():
    env = dict(os.environ, DISPLAY=":1", HOME="/home/robots")
    with open("/tmp/robots/test-browser.log", "ab") as log:
        subprocess.Popen(["/usr/local/bin/robots-browser", "about:blank"], env=env,
                         stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    assert browser_sessions.wait_for_browser(PORT, time.monotonic() + 30), "browser did not start"


def launch_basic_store():
    env = dict(os.environ, DISPLAY=":1", HOME="/home/robots")
    binary = shutil.which("chromium") or shutil.which("chromium-browser")
    with open("/tmp/robots/test-browser.log", "ab") as log:
        subprocess.Popen([binary, "--no-sandbox", "--password-store=basic", f"--user-data-dir={PROFILE}",
                          f"--remote-debugging-port={PORT}", "--remote-debugging-address=127.0.0.1",
                          "about:blank"], env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                         start_new_session=True)
    assert browser_sessions.wait_for_browser(PORT, time.monotonic() + 30), "browser did not start"


def browser_pid():
    found = browser_sessions.browser_process(PORT)
    return found[0] if found else None


def kill_browser():
    pid = browser_pid()
    if pid:
        os.kill(pid, signal.SIGKILL)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline and (browser_pid() or not page_secrets_closed()):
        time.sleep(0.2)
    assert not browser_pid(), "browser survived SIGKILL"


def page_secrets_closed():
    import socket
    try:
        socket.create_connection(("127.0.0.1", PORT), timeout=0.3).close()
        return False
    except OSError:
        return True


def rows():
    path = browser_sessions.cookies_db(PROFILE)
    assert path, "no cookie database"
    with tempfile.TemporaryDirectory() as tmp:
        copy = os.path.join(tmp, "Cookies")
        shutil.copyfile(path, copy)
        for suffix in ("-journal", "-wal"):
            if os.path.exists(path + suffix):
                shutil.copyfile(path + suffix, copy + suffix)
        connection = sqlite3.connect(copy)
        try:
            return {name: (host, bytes(value)) for host, name, value in
                    connection.execute("SELECT host_key, name, encrypted_value FROM cookies")}
        finally:
            connection.close()


def opened_with(password, host, encrypted):
    key = hashlib.pbkdf2_hmac("sha1", password, b"saltysalt", 1, 16)
    result = subprocess.run(["openssl", "enc", "-d", "-aes-128-cbc", "-K", key.hex(), "-iv", "20" * 16],
                            input=encrypted[3:], capture_output=True)
    if result.returncode != 0 or len(result.stdout) < 32:
        return None
    if result.stdout[:32] != hashlib.sha256(host.encode()).digest():
        return None
    return result.stdout[32:].decode("utf-8", "replace")


def add_unreachable_row(encrypted):
    path = browser_sessions.cookies_db(PROFILE)
    connection = sqlite3.connect(path)
    try:
        listed = ", ".join(row[1] for row in connection.execute("PRAGMA table_info(cookies)")
                           if row[1] not in ("host_key", "name", "value", "encrypted_value"))
        connection.execute(
            f"INSERT INTO cookies (host_key, name, value, encrypted_value, {listed}) "
            f"SELECT ?, ?, '', ?, {listed} FROM cookies WHERE name = 'legacy_sign_in' LIMIT 1",
            ("unreachable.example", "unreachable_sign_in", encrypted))
        connection.commit()
    finally:
        connection.close()


def live_cookie(name):
    client = page_secrets.connect(PORT)
    try:
        for cookie in browser_sessions.browser_cookies(client):
            if cookie.get("name") == name:
                return cookie
    finally:
        client.close()
    return None


def seed_basic_store_sign_in():
    client = page_secrets.connect(PORT)
    try:
        client.call("Storage.setCookies", {"cookies": [browser_sessions.cdp_cookie(LEGACY)]}, timeout_s=20.0)
        marker = browser_sessions.MARKER_PREFIX + "seed"
        client.call("Storage.setCookies", {"cookies": [{
            "name": marker, "value": "1", "url": browser_sessions.MARKER_URL, "secure": True,
            "expires": int(time.time()) + 600,
        }]}, timeout_s=10.0)
    finally:
        client.close()
    assert browser_sessions.wait_for_commit(PROFILE, marker, time.monotonic() + 60), "the seeded sign-in was not saved"


def wait_until(check, seconds, message):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(1)
    raise AssertionError(message)


def store_key():
    with open(KEY_FILE) as handle:
        return handle.read().encode()


def main():
    key = store_key()
    os.replace(KEY_FILE, HELD_KEY)

    launch_basic_store()
    seed_basic_store_sign_in()
    refused = browser_sessions.import_sessions(PORT, {"sites": [{"site": "example.net", "cookies": [IMPORTED]}], "clear": []})
    assert not refused["ok"], "an import was saved under the public key"
    assert "imported_sign_in" not in rows(), "a refused import reached the disk"
    kill_browser()
    host, value = rows()["legacy_sign_in"]
    assert value[:3] == b"v10", value[:3]
    assert opened_with(PUBLIC_PASSWORD, host, value) == LEGACY["value"], "basic store did not use the public key"
    print("before: the basic store keeps the sign-in under the public key, and imports are refused")

    os.replace(HELD_KEY, KEY_FILE)
    launch()
    wait_until(lambda: all(v[:3] == b"v11" for _, v in rows().values()), 120,
               "existing sign-ins were not resealed with the computer's key")
    wait_until(lambda: browser_sessions.keyed_profile(PROFILE), 120,
               "the profile was not marked keyed after its sign-ins were migrated")
    cookie = live_cookie("legacy_sign_in")
    assert cookie and cookie["value"] == LEGACY["value"], "the migration lost an existing sign-in"
    host, value = rows()["legacy_sign_in"]
    assert opened_with(PUBLIC_PASSWORD, host, value) is None, "the public key still opens a migrated sign-in"
    assert opened_with(key, host, value) == LEGACY["value"], "the computer's key does not open the migrated sign-in"
    print("migrated: existing sign-in kept and resealed with the computer's key")

    result = browser_sessions.import_sessions(PORT, {"sites": [{"site": "example.org", "cookies": [IMPORTED]}], "clear": []})
    assert result["ok"], result
    kill_browser()
    launch()
    cookie = live_cookie("imported_sign_in")
    assert cookie and cookie["value"] == IMPORTED["value"], "the imported sign-in did not survive a browser kill"
    host, value = rows()["imported_sign_in"]
    assert value[:3] == b"v11", value[:3]
    assert opened_with(PUBLIC_PASSWORD, host, value) is None, "the public key opens an imported sign-in"
    assert opened_with(key, host, value) == IMPORTED["value"], "the computer's key does not open the imported sign-in"
    print("imported: committed, survives SIGKILL, unreadable with the public key")

    result = browser_sessions.import_sessions(PORT, {"sites": [], "clear": ["example.org"]})
    assert result["ok"], result
    assert live_cookie("imported_sign_in") is None, "removing the sign-in left it in the browser"
    assert "imported_sign_in" not in rows(), "removing the sign-in left it on disk"
    print("removed: the bot's browser is signed out of the site")

    kill_browser()
    add_unreachable_row(b"v10" + bytes(range(64)))
    launch()
    wait_until(lambda: os.path.exists(os.path.join(PROFILE, browser_sessions.RESEAL_PENDING)), 120,
               "a profile with a row Chromium cannot re-seal was not left pending")
    assert live_cookie("unreachable_sign_in") is None, "Chromium re-set the row this check needs unreadable"
    assert "unreachable_sign_in" in rows(), "the unreadable row left the profile before its closed start"
    subprocess.run(["/usr/local/bin/robots-browser", "about:blank"],
                   env=dict(os.environ, DISPLAY=":1", HOME="/home/robots"),
                   stdin=subprocess.DEVNULL, capture_output=True, timeout=60)
    assert "unreachable_sign_in" in rows(), "a launch with a live browser dropped the unreadable row"
    assert os.path.exists(os.path.join(PROFILE, browser_sessions.RESEAL_PENDING)), "a live launch cleared the pending marker"
    assert live_cookie("legacy_sign_in") is not None, "a live sign-in was lost while the row was pending"
    kill_browser()
    launch()
    wait_until(lambda: "unreachable_sign_in" not in rows(), 60,
               "the next closed start did not drop the row Chromium cannot re-seal")
    assert browser_sessions.keyed_profile(PROFILE), "the profile was not marked keyed after the closed start"
    assert not os.path.exists(os.path.join(PROFILE, browser_sessions.RESEAL_PENDING)), "the pending marker was left"
    cookie = live_cookie("legacy_sign_in")
    assert cookie and cookie["value"] == LEGACY["value"], "the closed start lost a live sign-in"
    print("purged: the unreadable row was dropped at the next closed start and the profile marked keyed")

    kill_browser()
    subprocess.run(["pkill", "-KILL", "-x", "gnome-keyring-d"], check=False)
    os.replace(KEY_FILE, HELD_KEY)
    env = dict(os.environ, DISPLAY=":1", HOME="/home/robots")
    refused = subprocess.run(["/usr/local/bin/robots-browser", "about:blank"], env=env,
                             capture_output=True, timeout=30)
    assert refused.returncode != 0, "the browser opened a sealed profile without its key"
    assert browser_pid() is None
    assert "legacy_sign_in" in rows(), "a refused start damaged the profile"
    print("guarded: without its key the browser refuses to open the profile")
    print("PASS: browser sessions")


if __name__ == "__main__":
    main()
