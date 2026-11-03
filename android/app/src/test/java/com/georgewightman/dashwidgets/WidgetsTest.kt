package com.georgewightman.dashwidgets

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

// What the planner sends (js/glance.js), in its shape, with a made-up day: this repo is public, so
// never paste a real answer in here.
private const val SAMPLE = """{"at":"2026-10-21T06:53:24.245Z","day":"2026-10-21","tiles":{
"day":{"title":"Wednesday 21","number":"1/6","caption":"done today","lines":["▸ 09:00  Water the plants","09:30  Renew the library card","10:00  Shift (until 12:00)","12:15  Read about bike repairs","12:30  Shift (until 15:00)","13:30  Gym (until 15:15)","16:30  Hebrew practice","+ 3 more"],"open":"https://george-wightman.github.io/dashboard/"},
"fuel":{"title":"Fuel","number":"57 g","caption":"of 150 g protein today","lines":["Breakfast: Porridge and eggs · 57 g","This week ≈2,500 kcal a day"],"open":"https://george-wightman.github.io/dashboard/?big=fuel"},
"hebrew":{"title":"Hebrew","number":"0:45","caption":"of 7 h this week","lines":["12 of 40 reps spoken","3 of 15 words live","○○●····  Mon–Sun"],"open":"https://george-wightman.github.io/dashboard/?big=hebrew"},
"body":{"title":"Body","number":"30","caption":"of 90 cardio min this week","lines":["Gym 1 of 5 this week","Back this morning: fine"],"open":"https://george-wightman.github.io/dashboard/?big=body"},
"goals":{"title":"Goals","number":"2","caption":"goals on the go","lines":["Read a novel: 7% · by 30 Nov","Learn to juggle: 0 of 5 · by 20 Dec"],"open":"https://george-wightman.github.io/dashboard/?big=goals"},
"countdown":{"title":"Countdown","number":"17","caption":"days to The holiday","lines":[],"open":"https://george-wightman.github.io/dashboard/?big=countdown"},
"week":{"title":"This week","number":"","caption":"","lines":["Nothing to show yet."],"open":"https://george-wightman.github.io/dashboard/?big=week"},
"map":{"title":"Townsby","number":"24","caption":"tiles","lines":["2 tiles to claim","Golden age · 3 days","Next tile 15/40"],"open":"https://george-wightman.github.io/dashboard/?big=map"}}}"""

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w411dp-h891dp-xxhdpi")
class WidgetsTest {
    private val ctx: Context get() = RuntimeEnvironment.getApplication()

    @Test fun readsEveryTile() {
        val tiles = Glance.parse(SAMPLE)
        assertEquals(Glance.TILES, tiles.keys.toList())
        assertEquals("57 g", tiles.getValue("fuel").number)
        assertEquals(8, tiles.getValue("day").lines.size)
        assertEquals("https://george-wightman.github.io/dashboard/?big=fuel", tiles.getValue("fuel").open)
    }

    @Test fun aTapOnlyEverOpensTheDashboard() {
        val tiles = Glance.parse("""{"tiles":{"fuel":{"title":"Fuel","open":"https://evil.example/?big=fuel"},"goals":{"title":"Goals","open":"intent://x#Intent;end"}}}""")
        assertEquals(Glance.SITE, tiles.getValue("fuel").open)
        assertEquals(Glance.SITE, tiles.getValue("goals").open)
        val hebrew = Glance.parse("""{"tiles":{"hebrew":{"title":"Hebrew","open":"https://george-wightman.github.io/hebrew-reader/hebrew-reader.html"}}}""")
        assertEquals("https://george-wightman.github.io/hebrew-reader/hebrew-reader.html", hebrew.getValue("hebrew").open)
    }

    @Test(expected = GlanceException::class) fun aRefusalIsAnError() {
        Glance.parse("""{"error":"The planner refused the widget key"}""")
    }

    @Test fun takesOnlyAProperSetupLink() {
        val key = "k".repeat(43)
        val url = "https://script.google.com/macros/s/AKfy/exec"
        assertEquals(url to key, Glance.readSetup("dashwidgets://setup?u=${android.net.Uri.encode(url)}&k=$key"))
        assertNull(Glance.readSetup("dashwidgets://setup?u=https%3A%2F%2Fevil.example%2Fexec&k=$key"))
        assertNull(Glance.readSetup("dashwidgets://setup?u=${android.net.Uri.encode(url)}&k=short"))
        assertNull(Glance.readSetup("https://example.com"))
    }

    @Test fun drawsEachWidgetInDayAndNight() {
        val tiles = Glance.parse(SAMPLE)
        val out = File("build/widget-shots").apply { mkdirs() }
        for (night in listOf(false, true)) {
            val conf = Configuration(ctx.resources.configuration)
            conf.uiMode = (conf.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
                (if (night) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO)
            val themed = ctx.createConfigurationContext(conf)
            for (id in Glance.TILES) {
                val views = Widgets.views(themed, id, tiles[id], 1_761_029_604_000L, null, connected = true)
                val parent = FrameLayout(themed)
                val view = views.apply(themed, parent)
                val wide = id == "day" || id == "goals" || id == "week"
                val w = (if (wide) 340 else 170) * 3
                val h = (if (id == "day") 260 else 170) * 3
                view.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
                view.layout(0, 0, w, h)
                val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                view.draw(Canvas(bmp))
                File(out, "$id-${if (night) "night" else "day"}.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
                assertEquals(tiles.getValue(id).title, view.findViewById<TextView>(R.id.title).text.toString())
                // Something to read: lines, or the big number (a countdown to one date has only that).
                assertTrue(id, view.findViewById<TextView>(R.id.lines).text.isNotEmpty() || view.findViewById<TextView>(R.id.number).text.isNotEmpty())
            }
        }
    }

    // The Hebrew widget with its words (js/hebrew-voice.js) and each kind of card. Invented, like SAMPLE.
    private fun hebrewSample(level: String, night: Boolean, card: String) = """{"tiles":{"hebrew":{"title":"Hebrew","number":"0:45","caption":"of 3.5 h this week","lines":[],
"open":"https://george-wightman.github.io/hebrew-reader/hebrew-reader.html",
"voice":{"label":"3 of 7 this week","hebrew":"יאללה","line":"You've got half an hour. I know you have.","aside":"Do it now, before it's 10pm and you can't be bothered.",
"level":"$level","night":$night,"week":["done","gold","miss","duo","bit","today","ahead"],"card":$card}}}}"""

    private val CARDS = mapOf(
        "cheer" to """{"kind":"cheer","label":"3 of 7 this week","hebrew":"יאללה","line":"You've got half an hour. I know you have.","aside":"Do it now, before it's 10pm and you can't be bothered.","nextAt":"2030-01-01T11:00:00.000Z"}""",
        "word" to """{"kind":"word","label":"Word of the day","hebrew":"מילה","word":{"he":"מטבח","tr":"mitbakh","en":"kitchen"},"nextAt":"2030-01-01T11:00:00.000Z"}""",
        "phrase" to """{"kind":"phrase","label":"Salzburg in 3 days","hebrew":"משפט","word":{"he":"מה שלומך?","tr":"ma shlomekh?","en":"how are you? (to her)"}}""",
        "numbers" to """{"kind":"numbers","label":"This week","hebrew":"השבוע","stats":[{"n":"1:05","t":"of Hebrew this week"},{"n":"3","t":"days practised"},{"n":"+4","t":"words to strong"}],"aside":"Ahead of where you were last week."}""",
        "poster" to """{"kind":"poster","label":"3 days off the road","hebrew":"נו, באמת","big":"3","line":"days off the road, mate. Come on.","aside":"Ten minutes, just to get started."}""",
        "gold" to """{"kind":"gold","label":"4 of 7 this week","hebrew":"מצוין","big":"34","line":"minutes. That's the good stuff.","aside":"4 words to strong. Same again tomorrow."}""",
    )

    private fun shoot(view: View, w: Int, h: Int, file: File) {
        view.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        view.layout(0, 0, w, h)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bmp))
        file.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun theHebrewWidgetDrawsEachCardTallAndWide() {
        val out = File("build/widget-shots").apply { mkdirs() }
        for ((kind, json) in CARDS) {
            val night = kind == "poster"
            val level = if (kind == "gold") "gold" else "none"
            val tile = Glance.parse(hebrewSample(level, night, json)).getValue("hebrew")
            assertEquals("https://george-wightman.github.io/hebrew-reader/hebrew-reader.html", tile.open)
            assertEquals(kind, tile.voice!!.card!!.kind)
            val view = Widgets.views(ctx, "hebrew", tile, 1_761_029_604_000L, null, connected = true).apply(ctx, FrameLayout(ctx))
            // His home screen: two columns by four rows. And the wide one, for anyone who has it so.
            shoot(view, 175 * 3, 400 * 3, File(out, "hebrew-tall-$kind.png"))
            shoot(view, 340 * 3, 170 * 3, File(out, "hebrew-wide-$kind.png"))
            when (kind) {
                "word", "phrase" -> {
                    assertEquals(View.VISIBLE, view.findViewById<View>(R.id.heb_he).visibility)
                    assertEquals(View.GONE, view.findViewById<View>(R.id.heb_line).visibility)
                }
                "numbers" -> assertEquals("1:05", view.findViewById<TextView>(R.id.stat_n0).text.toString())
                "poster", "gold" -> assertEquals(View.VISIBLE, view.findViewById<View>(R.id.heb_big).visibility)
                else -> assertEquals("You've got half an hour. I know you have.", view.findViewById<TextView>(R.id.heb_line).text.toString())
            }
            assertEquals(if (level == "gold") View.VISIBLE else View.GONE, view.findViewById<View>(R.id.heb_gold_bar).visibility)
        }
        assertTrue(Glance.parse(hebrewSample("none", false, CARDS.getValue("word"))).getValue("hebrew").voice!!.card!!.nextAt > 0)
    }

    @Test fun beforeConnectingItSaysHow() {
        val view = Widgets.views(ctx, "fuel", null, 0, null, connected = false).apply(ctx, FrameLayout(ctx))
        assertTrue(view.findViewById<TextView>(R.id.lines).text.contains("Connect"))
        assertEquals(View.GONE, view.findViewById<View>(R.id.number_row).visibility)
    }
}
