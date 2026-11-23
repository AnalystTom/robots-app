package com.robots.notifications

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build

internal object ChatGroup {
  const val KEY = "robots.chats"
  private val SUMMARY_ID = "robots:chats".hashCode()

  fun postSummary(context: Context, channel: String) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    @Suppress("DEPRECATION")
    val summary = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channel) else Notification.Builder(context))
      .setSmallIcon(R.drawable.ic_robots_notification)
      .setContentTitle(context.applicationInfo.loadLabel(context.packageManager))
      .setGroup(KEY)
      .setGroupSummary(true)
      .setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_MESSAGE)
      .apply {
        launch?.let {
          setContentIntent(PendingIntent.getActivity(context, SUMMARY_ID, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }
      }
      .build()
    context.getSystemService(NotificationManager::class.java).notify(SUMMARY_ID, summary)
  }
}
