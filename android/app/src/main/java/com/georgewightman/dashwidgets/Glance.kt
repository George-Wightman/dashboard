package com.georgewightman.dashwidgets

import android.content.Context
import android.net.Uri
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// What the widgets show, as the planner's web app sends it (js/glance.js): for each tile a title, a
// big number with its caption, a few lines, and the dashboard link a tap opens. The app only lays
// these out, so what a widget says changes on the dashboard's side without a new app.
data class Tile(val title: String, val number: String, val caption: String, val lines: List<String>, val open: String, val voice: Voice? = null)

// The Hebrew widget's words (js/hebrew-voice.js): a small label, a Hebrew word, the line and its
// aside, how the day stands (none, bit, done, gold), whether it's the night look, and the week's seven
// days (gold, done, bit, duo, miss, today, ahead).
data class Voice(val label: String, val hebrew: String, val line: String, val aside: String, val level: String, val night: Boolean, val week: List<String>, val card: Card? = null)

// The card the tall widget shows now (js/hebrew-voice.js hebrewCard): cheer, poster, gold, done, word,
// phrase or numbers, what it says, and when it should change (ms since 1970, 0 for no time).
data class Card(val kind: String, val label: String, val hebrew: String, val line: String, val aside: String, val big: String,
    val he: String, val tr: String, val en: String, val stats: List<Pair<String, String>>, val nextAt: Long)

class GlanceException(message: String) : Exception(message)

object Glance {
    const val SITE = "https://george-wightman.github.io/dashboard/"
    // The Hebrew app: the one other place a widget may open.
    const val HEBREW_APP = "https://george-wightman.github.io/hebrew-reader/"
    val TILES = listOf("day", "fuel", "hebrew", "body", "goals", "countdown", "week", "map")
    // Not more often than this, however many widgets ask at once.
    private const val FRESH_MS = 5 * 60 * 1000L
    private const val PREFS = "glance"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun parse(json: String): Map<String, Tile> {
        val root = JSONObject(json)
        if (root.has("error")) throw GlanceException(root.getString("error"))
        val tiles = root.getJSONObject("tiles")
        val out = LinkedHashMap<String, Tile>()
        for (id in TILES) {
            val t = tiles.optJSONObject(id) ?: continue
            val lines = t.optJSONArray("lines")
            out[id] = Tile(
                title = t.optString("title"),
                number = t.optString("number"),
                caption = t.optString("caption"),
                lines = if (lines == null) emptyList() else (0 until lines.length()).map { lines.getString(it) },
                // Only ever the dashboard or the Hebrew app: a setup link from somewhere else can't make a tap open any page it likes.
                open = t.optString("open", SITE).let { if (it.startsWith(SITE) || it.startsWith(HEBREW_APP)) it else SITE },
                voice = t.optJSONObject("voice")?.let { v ->
                    val week = v.optJSONArray("week")
                    Voice(
                        label = v.optString("label"), hebrew = v.optString("hebrew"), line = v.optString("line"), aside = v.optString("aside"),
                        level = v.optString("level", "none"), night = v.optBoolean("night"),
                        week = if (week == null) emptyList() else (0 until week.length()).map { week.getString(it) },
                        card = v.optJSONObject("card")?.let { c ->
                            val word = c.optJSONObject("word")
                            val stats = c.optJSONArray("stats")
                            Card(
                                kind = c.optString("kind", "cheer"), label = c.optString("label"), hebrew = c.optString("hebrew"),
                                line = c.optString("line"), aside = c.optString("aside"), big = c.optString("big"),
                                he = word?.optString("he") ?: "", tr = word?.optString("tr") ?: "", en = word?.optString("en") ?: "",
                                stats = if (stats == null) emptyList() else (0 until stats.length()).map { stats.getJSONObject(it).let { s -> s.optString("n") to s.optString("t") } },
                                nextAt = try { java.time.Instant.parse(c.optString("nextAt")).toEpochMilli() } catch (e: Exception) { 0L },
                            )
                        },
                    )
                },
            )
        }
        return out
    }

    // dashwidgets://setup?u=<web app address>&k=<widget key>, as ⚙ → Phone widgets hands it over.
    fun readSetup(text: String): Pair<String, String>? {
        val uri = Uri.parse(text.trim())
        if (uri.scheme != "dashwidgets" || uri.host != "setup") return null
        val url = uri.getQueryParameter("u") ?: return null
        val key = uri.getQueryParameter("k") ?: return null
        if (!url.startsWith("https://script.google.com/macros/s/") || key.length < 32) return null
        return url to key
    }

    fun connect(ctx: Context, url: String, key: String) {
        prefs(ctx).edit().putString("url", url).putString("key", key).remove("fetchedAt").remove("error").apply()
    }

    fun connected(ctx: Context) = prefs(ctx).getString("url", null) != null && prefs(ctx).getString("key", null) != null

    fun cached(ctx: Context): Map<String, Tile> = prefs(ctx).getString("json", null)?.let {
        try { parse(it) } catch (e: Exception) { null }
    } ?: emptyMap()

    fun fetchedAt(ctx: Context): Long = prefs(ctx).getLong("fetchedAt", 0L)
    fun lastError(ctx: Context): String? = prefs(ctx).getString("error", null)

    // Asks the planner for the latest, unless it was asked a moment ago. Blocking: never on the main thread.
    @Synchronized
    fun refresh(ctx: Context, force: Boolean = false): Boolean {
        val p = prefs(ctx)
        val url = p.getString("url", null) ?: return false
        val key = p.getString("key", null) ?: return false
        if (!force && System.currentTimeMillis() - p.getLong("triedAt", 0L) < FRESH_MS) return false
        p.edit().putLong("triedAt", System.currentTimeMillis()).apply()
        return try {
            val json = post(url, JSONObject().put("glance", key).toString())
            parse(json)
            p.edit().putString("json", json).putLong("fetchedAt", System.currentTimeMillis()).remove("error").apply()
            true
        } catch (e: Exception) {
            p.edit().putString("error", e.message ?: "Couldn't reach the planner").apply()
            false
        }
    }

    // Apps Script answers a POST with a redirect to its reply, to be fetched with a GET.
    private fun post(address: String, body: String): String {
        var conn = URL(address).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = false
        conn.connectTimeout = 15000
        conn.readTimeout = 30000
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "text/plain;charset=utf-8")
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        var hops = 0
        while (conn.responseCode in 300..399 && hops++ < 5) {
            val next = conn.getHeaderField("Location") ?: break
            conn.disconnect()
            conn = URL(next).openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
        }
        if (conn.responseCode != 200) throw GlanceException("The planner answered ${conn.responseCode}")
        return conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    }
}
