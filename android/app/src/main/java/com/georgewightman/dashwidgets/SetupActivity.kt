package com.georgewightman.dashwidgets

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// The app's one screen. ⚙ → Phone widgets → Connect in the dashboard opens it with the planner's
// address and the widget key (dashwidgets://setup?u=…&k=…); a copied link can be pasted instead.
// After that it only says whether the widgets are connected and when they last fetched.
class SetupActivity : Activity() {
    private lateinit var status: TextView

    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        val pad = (20 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
            gravity = Gravity.TOP
        }
        root.addView(TextView(this).apply { text = "Dashboard widgets"; textSize = 26f; setTypeface(typeface, android.graphics.Typeface.BOLD) })
        status = TextView(this).apply { textSize = 16f; setPadding(0, pad, 0, pad) }
        root.addView(status)
        root.addView(TextView(this).apply {
            textSize = 15f
            text = "To add one: long-press your home screen, tap Widgets, and find Dashboard widgets. " +
                "Today is your day as a short calendar; the others are the dashboard's tiles. " +
                "Tap a widget to open it in the dashboard, or its time to fetch it again."
        })
        root.addView(Button(this).apply { text = "Paste a setup link"; setOnClickListener { paste() } })
        root.addView(Button(this).apply { text = "Fetch now"; setOnClickListener { fetch() } })
        root.addView(Button(this).apply {
            text = "Open the dashboard"
            setOnClickListener { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Glance.SITE))) }
        })
        setContentView(root)
        take(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        take(intent)
    }

    override fun onResume() {
        super.onResume()
        show()
    }

    private fun take(intent: Intent?) {
        val data = intent?.data?.toString() ?: return
        val setup = Glance.readSetup(data)
        if (setup == null) {
            status.text = "That link isn't a widgets setup link. Use ⚙ → Phone widgets → Connect in the dashboard."
            return
        }
        Glance.connect(this, setup.first, setup.second)
        fetch()
    }

    private fun paste() {
        val clip = (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
        val text = if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(this).toString() else ""
        val setup = Glance.readSetup(text)
        if (setup == null) {
            status.text = "There's no setup link on the clipboard."
            return
        }
        Glance.connect(this, setup.first, setup.second)
        fetch()
    }

    private fun fetch() {
        if (!Glance.connected(this)) { show(); return }
        status.text = "Fetching…"
        Thread {
            Glance.refresh(applicationContext, force = true)
            Widgets.drawAll(applicationContext)
            runOnUiThread { show() }
        }.start()
    }

    private fun show() {
        if (!::status.isInitialized) return
        status.text = when {
            !Glance.connected(this) -> "Not connected yet. In the dashboard on this phone, open ⚙ → Phone widgets and tap Connect."
            Glance.lastError(this) != null -> "Connected, but the last fetch failed: ${Glance.lastError(this)}"
            Glance.fetchedAt(this) > 0 -> "Connected. Last fetched at ${SimpleDateFormat("HH:mm", Locale.UK).format(Date(Glance.fetchedAt(this)))}."
            else -> "Connected."
        }
    }
}
