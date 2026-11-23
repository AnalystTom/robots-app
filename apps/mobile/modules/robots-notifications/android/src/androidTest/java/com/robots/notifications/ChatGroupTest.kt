package com.robots.notifications

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ChatGroupTest {
  private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
  private val manager = context.getSystemService(NotificationManager::class.java)

  private fun push(threadId: String, title: String, body: String) = JSONObject(
    mapOf(
      "kind" to "completion",
      "botId" to "bot-$threadId",
      "threadId" to threadId,
      "spaceId" to "space-1",
      "notificationTitle" to title,
      "notificationBody" to body,
    )
  )

  @Before
  fun signedIn() {
    if (Build.VERSION.SDK_INT >= 33) {
      InstrumentationRegistry.getInstrumentation().uiAutomation
        .grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
    }
    manager.cancelAll()
    NotificationStorage(context).token = "test-session"
  }

  @Test
  fun chatsShareOneGroupAndAnUpdateReplacesItsNotification() {
    assertTrue(SenderPush.present(context, push("a", "Bookmark chat", "Saving the file now")))
    assertTrue(SenderPush.present(context, push("b", "Digest chat", "Still checking for new items")))
    assertTrue(SenderPush.present(context, push("a", "Bookmark chat", "Saved. Ready to use.")))

    val active = manager.activeNotifications
    val summaries = active.filter { it.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0 }
    val chats = active.filter { it.notification.flags and Notification.FLAG_GROUP_SUMMARY == 0 }
    assertEquals(1, summaries.size)
    assertEquals(2, chats.size)
    assertTrue(chats.all { it.notification.group == ChatGroup.KEY })
    val updated = chats.first { it.notification.extras.getString("robots.threadId") == "a" }
    assertEquals(
      "Saved. Ready to use.",
      updated.notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString(),
    )
  }

  @Test
  fun leaveStackedChatsInTheShade() {
    SenderPush.present(context, push("a", "Bookmark chat", "First reply from the bot"))
    SenderPush.present(context, push("b", "Digest chat", "Checking for new items"))
    SenderPush.present(context, push("a", "Bookmark chat", "Second reply, newer"))
    SenderPush.present(context, push("b", "Digest chat", "Found two new items"))
    SenderPush.present(context, push("a", "Bookmark chat", "Third reply, newest"))
    assertEquals(3, manager.activeNotifications.size)
  }
}
