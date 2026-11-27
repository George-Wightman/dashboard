package com.georgewightman.dashwidgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.RemoteViews
import android.widget.Toast
import org.json.JSONObject
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

// One widget per tile. Each draws what was last fetched straight away, then asks the planner for the
// latest (at most every five minutes, whichever widget asks) and redraws them all.
abstract class TileWidget(private val tileId: String) : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        Widgets.draw(ctx, mgr, tileId, ids)
        Widgets.fetchLater(ctx)
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Widgets.ACTION_REFRESH -> { Widgets.refreshInBackground(ctx, goAsync(), force = true); return }
            // A row's ○ on Today: tick that item for today.
            Widgets.ACTION_TICK -> {
                val item = intent.getStringExtra(Widgets.EXTRA_ITEM) ?: return
                Widgets.actInBackground(ctx, goAsync(), JSONObject().put("kind", "tick").put("item", item), item)
                return
            }
            // The Hebrew widget's +15.
            Widgets.ACTION_HEBREW -> {
                Widgets.actInBackground(ctx, goAsync(), JSONObject().put("kind", "hebrew").put("minutes", Widgets.HEBREW_STEP), "hebrew")
                return
            }
        }
        super.onReceive(ctx, intent)
    }
}

class DayWidget : TileWidget("day")
class FuelWidget : TileWidget("fuel")
class HebrewWidget : TileWidget("hebrew")
class BodyWidget : TileWidget("body")
class GoalsWidget : TileWidget("goals")
class CountdownWidget : TileWidget("countdown")
class WeekWidget : TileWidget("week")
class MapWidget : TileWidget("map")

// The queued fetch: draws whatever it got (a failure shows as ⚠) and tries again a few times.
class RefreshWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val app = applicationContext
        if (!Glance.connected(app)) return Result.success()
        val ok = Glance.refresh(app, force = true)
        Widgets.drawAll(app)
        return if (ok || runAttemptCount >= 5) Result.success() else Result.retry()
    }
}

// Never meant to run: queued ten years out so WorkManager's queue is never empty (see Widgets.fetchLater).
class PlaceholderWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result = Result.success()
}

object Widgets {
    const val ACTION_REFRESH = "com.georgewightman.dashwidgets.REFRESH"
    const val ACTION_TICK = "com.georgewightman.dashwidgets.TICK"
    const val ACTION_HEBREW = "com.georgewightman.dashwidgets.HEBREW_ADD"
    const val EXTRA_ITEM = "item"
    const val HEBREW_STEP = 15

    // A tap that changes something: "…" on what was tapped straight away, then the planner's answer
    // (the tiles as they now are) drawn, and a line saying what happened.
    fun actInBackground(ctx: Context, pending: android.content.BroadcastReceiver.PendingResult?, act: JSONObject, mark: String) {
        val app = ctx.applicationContext
        Glance.setPending(app, mark)
        drawAll(app)
        Thread {
            try {
                val said = Glance.act(app, act)
                Glance.setPending(app, null)
                drawAll(app)
                Handler(Looper.getMainLooper()).post { Toast.makeText(app, said, Toast.LENGTH_SHORT).show() }
            } finally {
                pending?.finish()
            }
        }.start()
    }

    val PROVIDERS: Map<String, Class<out TileWidget>> = linkedMapOf(
        "day" to DayWidget::class.java, "fuel" to FuelWidget::class.java, "hebrew" to HebrewWidget::class.java,
        "body" to BodyWidget::class.java, "goals" to GoalsWidget::class.java, "countdown" to CountdownWidget::class.java,
        "week" to WeekWidget::class.java, "map" to MapWidget::class.java,
    )

    // Each tile's colours, as Daylight's (styles/daylight.css); values-night has the night ones.
    private val BACKGROUND = mapOf(
        "day" to R.drawable.bg_day, "fuel" to R.drawable.bg_fuel, "hebrew" to R.drawable.bg_hebrew, "body" to R.drawable.bg_body,
        "goals" to R.drawable.bg_goals, "countdown" to R.drawable.bg_countdown, "week" to R.drawable.bg_day, "map" to R.drawable.bg_map,
    )
    private val INK = mapOf(
        "day" to R.color.ink, "fuel" to R.color.on_fuel, "hebrew" to R.color.on_hebrew, "body" to R.color.on_body,
        "goals" to R.color.ink, "countdown" to R.color.ink, "week" to R.color.ink, "map" to R.color.on_map,
    )
    private val NAMES = mapOf(
        "day" to "Today", "fuel" to "Fuel", "hebrew" to "Hebrew", "body" to "Body", "goals" to "Goals", "countdown" to "Countdown", "week" to "This week", "map" to "Map",
    )

    fun refreshInBackground(ctx: Context, pending: android.content.BroadcastReceiver.PendingResult?, force: Boolean) {
        val app = ctx.applicationContext
        Thread {
            try {
                val ok = Glance.refresh(app, force)
                if (ok || force) drawAll(app)
                // Refused (the phone idle, the app in the background): Android's queue tries again.
                if (!ok && Glance.connected(app)) fetchLater(app)
            } finally {
                pending?.finish()
            }
        }.start()
    }

    const val WORK = "glance"
    const val PLACEHOLDER = "glance-placeholder"

    // A fetch through WorkManager, which runs it once Android lets the app use the network. Started
    // in the background, a plain request fails while the phone is idle: Android blocks a background
    // app's network then, and the Hebrew card sat on the day before's (5 Nov 2026). One at a time.
    //
    // The placeholder goes first and stays queued. WorkManager switches one of its own receivers on
    // when work is queued and off when the queue empties; switching any part of the app on or off makes
    // Android rebuild every widget and call onUpdate, which queued a fetch, which emptied the queue when
    // it finished... The widgets flashed their "Open the app to connect" first frame every second or
    // two, each flash a fetch from the planner (27 Nov 2026). With something always queued, nothing is
    // ever switched off. Androidx's own Glance widgets do the same.
    fun fetchLater(ctx: Context) {
        val work = WorkManager.getInstance(ctx.applicationContext)
        work.enqueueUniqueWork(PLACEHOLDER, ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<PlaceholderWorker>()
            .setInitialDelay(3650, TimeUnit.DAYS).build())
        val request = OneTimeWorkRequestBuilder<RefreshWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .build()
        work.enqueueUniqueWork(WORK, ExistingWorkPolicy.KEEP, request)
    }

    fun drawAll(ctx: Context) {
        val mgr = AppWidgetManager.getInstance(ctx)
        for ((id, cls) in PROVIDERS) draw(ctx, mgr, id, mgr.getAppWidgetIds(ComponentName(ctx, cls)))
    }

    fun draw(ctx: Context, mgr: AppWidgetManager, tileId: String, ids: IntArray) {
        if (ids.isEmpty()) return
        val tile = Glance.cached(ctx)[tileId]
        val views = views(ctx, tileId, tile, Glance.fetchedAt(ctx), Glance.lastError(ctx), Glance.connected(ctx))
        for (id in ids) mgr.updateAppWidget(id, views)
        if (tileId == "hebrew") scheduleHebrew(ctx, tile?.voice?.card)
    }

    // The widget for one tile: its colours, title, the time it was fetched (tap to fetch again), the
    // big number and caption, and its lines. A tap anywhere else opens the tile in the dashboard.
    fun views(ctx: Context, tileId: String, tile: Tile?, fetchedAt: Long, error: String?, connected: Boolean): RemoteViews {
        if (tileId == "hebrew" && connected && tile?.voice != null) return hebrewViews(ctx, tile, tile.voice, fetchedAt, error)
        val v = RemoteViews(ctx.packageName, R.layout.widget_tile)
        v.setInt(R.id.root, "setBackgroundResource", BACKGROUND.getValue(tileId))
        val ink = INK.getValue(tileId)
        for (id in intArrayOf(R.id.title, R.id.updated, R.id.number, R.id.caption, R.id.lines)) {
            if (Build.VERSION.SDK_INT >= 31) v.setColorStateList(id, "setTextColor", ink) else v.setTextColor(id, ctx.getColor(ink))
        }
        v.setTextViewText(R.id.title, tile?.title?.ifBlank { null } ?: NAMES.getValue(tileId))
        val stamp = if (fetchedAt > 0) SimpleDateFormat("HH:mm", Locale.UK).format(Date(fetchedAt)) else ""
        v.setTextViewText(R.id.updated, if (error != null && tile != null) "$stamp ⚠ ↻" else "$stamp ↻")
        when {
            !connected -> {
                showNumber(v, false)
                v.setTextViewText(R.id.lines, "Open ⚙ → Phone widgets in the dashboard, and tap Connect.")
            }
            tile == null -> {
                showNumber(v, false)
                v.setTextViewText(R.id.lines, error ?: "Fetching…")
            }
            else -> {
                showNumber(v, tile.number.isNotBlank() || tile.caption.isNotBlank())
                v.setTextViewText(R.id.number, tile.number)
                v.setTextViewText(R.id.caption, tile.caption)
                v.setTextViewText(R.id.lines, tile.lines.joinToString("\n"))
            }
        }
        // Today's rows, each with a ○ that ticks it, when the planner says which rows can be ticked.
        val rows = connected && tile != null && tileId == "day" && tile.ticks.any { it != null }
        v.setViewVisibility(R.id.lines, if (rows) View.GONE else View.VISIBLE)
        v.setViewVisibility(R.id.rows, if (rows) View.VISIBLE else View.GONE)
        if (rows && tile != null) {
            val waiting = Glance.pending(ctx)
            for (i in ROW.indices) {
                val text = tile.lines.getOrNull(i)
                v.setViewVisibility(ROW[i], if (text == null) View.GONE else View.VISIBLE)
                if (text == null) continue
                v.setTextViewText(ROW_TEXT[i], text)
                for (id in intArrayOf(ROW_TEXT[i], ROW_TICK[i])) {
                    if (Build.VERSION.SDK_INT >= 31) v.setColorStateList(id, "setTextColor", ink) else v.setTextColor(id, ctx.getColor(ink))
                }
                val item = tile.ticks.getOrNull(i)
                v.setViewVisibility(ROW_TICK[i], if (item == null) View.INVISIBLE else View.VISIBLE)
                if (item == null) continue
                v.setTextViewText(ROW_TICK[i], if (item == waiting) "…" else "○")
                v.setOnClickPendingIntent(ROW_TICK[i], PendingIntent.getBroadcast(
                    ctx, TICK_CODE + i, Intent(ctx, DayWidget::class.java).setAction(ACTION_TICK).putExtra(EXTRA_ITEM, item),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ))
            }
        }
        val open = if (connected) (tile?.open ?: Glance.SITE) else Glance.SITE
        v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(
            ctx, tileId.hashCode(), Intent(Intent.ACTION_VIEW, Uri.parse(open)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        ))
        v.setOnClickPendingIntent(R.id.updated, PendingIntent.getBroadcast(
            ctx, tileId.hashCode() + 1, Intent(ctx, PROVIDERS.getValue(tileId)).setAction(ACTION_REFRESH),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        ))
        return v
    }

    private val ROW = intArrayOf(R.id.row0, R.id.row1, R.id.row2, R.id.row3, R.id.row4, R.id.row5, R.id.row6, R.id.row7)
    private val ROW_TEXT = intArrayOf(R.id.row0_text, R.id.row1_text, R.id.row2_text, R.id.row3_text, R.id.row4_text, R.id.row5_text, R.id.row6_text, R.id.row7_text)
    private val ROW_TICK = intArrayOf(R.id.row0_tick, R.id.row1_tick, R.id.row2_tick, R.id.row3_tick, R.id.row4_tick, R.id.row5_tick, R.id.row6_tick, R.id.row7_tick)
    // Each row's ○ its own PendingIntent: the request code is what keeps them apart.
    private const val TICK_CODE = 9100

    private val DOTS = intArrayOf(R.id.dot0, R.id.dot1, R.id.dot2, R.id.dot3, R.id.dot4, R.id.dot5, R.id.dot6)

    // The Hebrew widget, in the Hebrew app's paper and ink (its style guide: gold only for what he
    // did, teal only for today). Day or night by the planner's clock, not the phone's dark mode. One
    // card at a time (word, phrase, encouragement, a big number, the week's numbers); the sections it
    // doesn't use are hidden, so it suits a tall widget as well as a wide one.
    fun hebrewViews(ctx: Context, tile: Tile, voice: Voice, fetchedAt: Long, error: String?): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_hebrew)
        val n = voice.night
        fun c(day: Int, night: Int) = ctx.getColor(if (n) night else day)
        val ink = c(R.color.heb_ink_day, R.color.heb_ink_night)
        val muted = c(R.color.heb_muted_day, R.color.heb_muted_night)
        val gold = c(R.color.heb_gold_day, R.color.heb_gold_night)
        val teal = c(R.color.heb_teal_day, R.color.heb_teal_night)
        val card = voice.card ?: Card("cheer", voice.label, voice.hebrew, voice.line, voice.aside, "", "", "", "", emptyList(), 0L)
        v.setInt(R.id.heb_root, "setBackgroundResource", if (n) R.drawable.bg_hebrew_night else R.drawable.bg_hebrew_day)

        fun text(id: Int, value: String, colour: Int) {
            v.setTextViewText(id, value)
            v.setTextColor(id, colour)
            v.setViewVisibility(id, if (value.isBlank()) View.GONE else View.VISIBLE)
        }
        text(R.id.heb_label, (if (error != null) "⚠ " else "") + card.label, muted)
        text(R.id.heb_word, card.hebrew, muted)
        val isWord = card.kind == "word" || card.kind == "phrase"
        val isBig = card.big.isNotBlank()
        text(R.id.heb_big, card.big, if (card.kind == "gold") gold else ink)
        text(R.id.heb_line, if (isWord || card.kind == "numbers") "" else card.line, if (card.kind == "gold") gold else ink)
        text(R.id.heb_he, if (isWord) card.he else "", ink)
        text(R.id.heb_tr, if (isWord) card.tr else "", muted)
        text(R.id.heb_en, if (isWord) card.en else "", ink)
        text(R.id.heb_aside, if (isWord) "" else card.aside, muted)
        // A big number or a word sits in the middle; the rest reads from the top.
        v.setViewVisibility(R.id.heb_top_space, if (isBig || isWord) View.VISIBLE else View.GONE)
        val stats = if (card.kind == "numbers") card.stats else emptyList()
        v.setViewVisibility(R.id.heb_stats, if (stats.isEmpty()) View.GONE else View.VISIBLE)
        val statIds = listOf(R.id.stat_n0 to R.id.stat_t0, R.id.stat_n1 to R.id.stat_t1, R.id.stat_n2 to R.id.stat_t2)
        for ((i, ids) in statIds.withIndex()) {
            val s = stats.getOrNull(i)
            text(ids.first, s?.first ?: "", if (i == 0) gold else ink)
            text(ids.second, s?.second ?: "", muted)
        }
        for ((i, id) in DOTS.withIndex()) {
            val state = voice.week.getOrNull(i) ?: "ahead"
            val (shape, colour) = when (state) {
                "gold" -> R.drawable.dot_ring_fill to gold
                "done" -> R.drawable.dot_fill to gold
                "bit" -> R.drawable.dot_half to gold
                "duo" -> R.drawable.dot_half to muted
                "miss" -> R.drawable.dot_dashed to muted
                "today" -> R.drawable.dot_ring_bold to teal
                else -> R.drawable.dot_ring to muted
            }
            v.setImageViewResource(id, shape)
            v.setInt(id, "setColorFilter", colour)
            v.setInt(id, "setImageAlpha", if (state == "ahead") 140 else 255)
        }
        for (id in DAYS) v.setTextColor(id, muted)
        v.setViewVisibility(R.id.heb_gold_bar, if (voice.level == "gold") View.VISIBLE else View.GONE)
        v.setInt(R.id.heb_gold_bar, "setColorFilter", gold)
        v.setOnClickPendingIntent(R.id.heb_root, PendingIntent.getActivity(
            ctx, "hebrew".hashCode(), Intent(Intent.ACTION_VIEW, Uri.parse(tile.open)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        ))
        v.setOnClickPendingIntent(R.id.heb_head, refreshIntent(ctx))
        // +15: Hebrew done away from the app, added without opening anything.
        text(R.id.heb_add, if (Glance.pending(ctx) == "hebrew") "…" else "+$HEBREW_STEP", teal)
        v.setOnClickPendingIntent(R.id.heb_add, PendingIntent.getBroadcast(
            ctx, "hebrew".hashCode() + 2, Intent(ctx, HebrewWidget::class.java).setAction(ACTION_HEBREW),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        ))
        return v
    }

    private val DAYS = intArrayOf(R.id.day0, R.id.day1, R.id.day2, R.id.day3, R.id.day4, R.id.day5, R.id.day6)

    private fun refreshIntent(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
        ctx, "hebrew".hashCode() + 1, Intent(ctx, HebrewWidget::class.java).setAction(ACTION_REFRESH),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    // When the Hebrew card says it should change (a new slot, a shift ending), ask again then rather
    // than whenever Android next wakes the widget (every 30 minutes at best). An inexact alarm: a few
    // minutes late is fine, and it needs no permission.
    fun scheduleHebrew(ctx: Context, card: Card?) {
        val at = card?.nextAt ?: 0L
        if (at <= System.currentTimeMillis()) return
        val alarms = ctx.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
        alarms.set(android.app.AlarmManager.RTC, at + 30_000L, refreshIntent(ctx))
    }

    private fun showNumber(v: RemoteViews, on: Boolean) = v.setViewVisibility(R.id.number_row, if (on) View.VISIBLE else View.GONE)
}
