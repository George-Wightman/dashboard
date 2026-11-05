package com.georgewightman.dashwidgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.view.View
import android.widget.RemoteViews
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
        if (intent.action == Widgets.ACTION_REFRESH) {
            Widgets.refreshInBackground(ctx, goAsync(), force = true)
            return
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

object Widgets {
    const val ACTION_REFRESH = "com.georgewightman.dashwidgets.REFRESH"

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

    // A fetch through WorkManager, which runs it once Android lets the app use the network. Started
    // in the background, a plain request fails while the phone is idle: Android blocks a background
    // app's network then, and the Hebrew card sat on the day before's (5 Nov 2026). One at a time.
    fun fetchLater(ctx: Context) {
        val request = OneTimeWorkRequestBuilder<RefreshWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(ctx.applicationContext).enqueueUniqueWork(WORK, ExistingWorkPolicy.KEEP, request)
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
