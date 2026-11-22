import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))

import browser_sessions  # noqa: E402


def cookies_file(profile):
    directory = os.path.join(profile, "Default")
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, "Cookies")
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE cookies (name TEXT, host_key TEXT, encrypted_value BLOB)")
    connection.executemany(
        "INSERT INTO cookies VALUES (?, ?, ?)",
        [("public_sign_in", "example.com", b"v10" + b"x" * 8),
         ("keyed_sign_in", "example.org", b"v11" + b"y" * 8)],
    )
    connection.commit()
    connection.close()
    return path


def remaining_names(path):
    connection = sqlite3.connect(path)
    try:
        return sorted(row[0] for row in connection.execute("SELECT name FROM cookies"))
    finally:
        connection.close()


class ResealWithUnreadableRowTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="robots-reseal-")
        self.profile = os.path.join(self.root, "profile")
        os.makedirs(self.profile)
        self.db = cookies_file(self.profile)
        self.saved = (browser_sessions.wait_for_browser, browser_sessions.apply_sessions)
        browser_sessions.wait_for_browser = lambda port, deadline: True
        browser_sessions.apply_sessions = lambda port, request: {"ok": True}

    def tearDown(self):
        browser_sessions.wait_for_browser, browser_sessions.apply_sessions = self.saved

    def test_a_leftover_row_keeps_the_profile_closed_until_the_next_closed_start(self):
        first = browser_sessions.reseal(self.profile, 9222)
        self.assertFalse(first["ok"])
        self.assertFalse(browser_sessions.keyed_profile(self.profile))
        self.assertTrue(os.path.exists(os.path.join(self.profile, browser_sessions.RESEAL_PENDING)))
        self.assertEqual(remaining_names(self.db), ["keyed_sign_in", "public_sign_in"])

        second = browser_sessions.finish_closed_migration(self.profile)
        self.assertEqual(second, {"ok": True, "purged": 1})
        self.assertEqual(remaining_names(self.db), ["keyed_sign_in"])
        self.assertTrue(browser_sessions.keyed_profile(self.profile))


class FinishClosedMigrationTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="robots-profile-migration-")
        self.profile = os.path.join(self.root, "profile")
        os.makedirs(self.profile)
        self.db = cookies_file(self.profile)

    def mark_path(self):
        return os.path.join(self.profile, browser_sessions.STORE_MARK)

    def pending_path(self):
        return os.path.join(self.profile, browser_sessions.RESEAL_PENDING)

    def test_a_pending_profile_drops_unreadable_rows_then_is_marked_keyed(self):
        open(self.pending_path(), "w").close()
        result = browser_sessions.finish_closed_migration(self.profile)
        self.assertEqual(result, {"ok": True, "purged": 1})
        self.assertEqual(remaining_names(self.db), ["keyed_sign_in"])
        self.assertTrue(browser_sessions.keyed_profile(self.profile))
        self.assertFalse(os.path.exists(self.pending_path()))

    def test_a_profile_without_a_pending_reseal_is_left_for_reseal(self):
        result = browser_sessions.finish_closed_migration(self.profile)
        self.assertEqual(result, {"ok": True, "purged": 0})
        self.assertEqual(remaining_names(self.db), ["keyed_sign_in", "public_sign_in"])
        self.assertFalse(os.path.exists(self.mark_path()))


if __name__ == "__main__":
    unittest.main()
