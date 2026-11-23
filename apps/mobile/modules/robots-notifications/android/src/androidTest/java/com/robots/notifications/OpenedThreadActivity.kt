package com.robots.notifications

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

class OpenedThreadActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(TextView(this).apply {
      textSize = 22f
      setPadding(48, 200, 48, 48)
      text = "Opened chat\n" + (intent.data?.getQueryParameter("threadId") ?: "")
    })
  }
}
