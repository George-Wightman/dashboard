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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// One widget per tile. Each draws what was last fetched straight away, then asks the planner for the
// latest (at most every five minutes, whichever widget asks) and redraws them all.
abstract class TileWidget(private val tileId: String) : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        Widgets.draw(ctx, mgr, tileId, ids)
        Widgets.refreshInBackground(ctx, goAsync(), force = false)
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
                if (Glance.refresh(app, force) || force) drawAll(app)
            } finally {
                pending?.finish()
            }
        }.start()
    }

    fun drawAll(ctx: Context) {
        val mgr = AppWidgetManager.getInstance(ctx)
        for ((id, cls) in PROVIDERS) draw(ctx, mgr, id, mgr.getAppWidgetIds(ComponentName(ctx, cls)))
    }

    fun draw(ctx: Context, mgr: AppWidgetManager, tileId: String, ids: IntArray) {
        if (ids.isEmpty()) return
        val views = views(ctx, tileId, Glance.cached(ctx)[tileId], Glance.fetchedAt(ctx), Glance.lastError(ctx), Glance.connected(ctx))
        for (id in ids) mgr.updateAppWidget(id, views)
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
    // did, teal only for today). Day or night by the planner's clock, not the phone's dark mode.
    fun hebrewViews(ctx: Context, tile: Tile, voice: Voice, fetchedAt: Long, error: String?): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_hebrew)
        val n = voice.night
        fun c(day: Int, night: Int) = ctx.getColor(if (n) night else day)
        val ink = c(R.color.heb_ink_day, R.color.heb_ink_night)
        val muted = c(R.color.heb_muted_day, R.color.heb_muted_night)
        val gold = c(R.color.heb_gold_day, R.color.heb_gold_night)
        val teal = c(R.color.heb_teal_day, R.color.heb_teal_night)
        v.setInt(R.id.heb_root, "setBackgroundResource", if (n) R.drawable.bg_hebrew_night else R.drawable.bg_hebrew_day)
        v.setTextViewText(R.id.heb_label, voice.label)
        v.setTextViewText(R.id.heb_word, voice.hebrew)
        v.setTextViewText(R.id.heb_line, voice.line)
        v.setTextViewText(R.id.heb_aside, voice.aside)
        v.setTextColor(R.id.heb_label, muted)
        v.setTextColor(R.id.heb_word, muted)
        v.setTextColor(R.id.heb_line, if (voice.level == "gold") gold else ink)
        v.setTextColor(R.id.heb_aside, muted)
        v.setTextColor(R.id.updated, muted)
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
        v.setViewVisibility(R.id.heb_gold_bar, if (voice.level == "gold") View.VISIBLE else View.GONE)
        v.setInt(R.id.heb_gold_bar, "setColorFilter", gold)
        val stamp = if (fetchedAt > 0) SimpleDateFormat("HH:mm", Locale.UK).format(Date(fetchedAt)) else ""
        v.setTextViewText(R.id.updated, if (error != null) "$stamp ⚠ ↻" else "$stamp ↻")
        v.setOnClickPendingIntent(R.id.heb_root, PendingIntent.getActivity(
            ctx, "hebrew".hashCode(), Intent(Intent.ACTION_VIEW, Uri.parse(tile.open)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        ))
        v.setOnClickPendingIntent(R.id.updated, PendingIntent.getBroadcast(
            ctx, "hebrew".hashCode() + 1, Intent(ctx, HebrewWidget::class.java).setAction(ACTION_REFRESH),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        ))
        return v
    }

    private fun showNumber(v: RemoteViews, on: Boolean) = v.setViewVisibility(R.id.number_row, if (on) View.VISIBLE else View.GONE)
}
