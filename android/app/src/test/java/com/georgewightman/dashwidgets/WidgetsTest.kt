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

// What the planner sends (js/glance.js), as it answered for Wed 21 Oct 2026.
private const val SAMPLE = """{"at":"2026-10-21T06:53:24.245Z","day":"2026-10-21","tiles":{
"day":{"title":"Wednesday 21","number":"1/6","caption":"done today","lines":["▸ 09:00  Find a new laptop battery","09:30  Re-join JD Gyms","10:00  Signify (until 12:00)","12:15  Research the Visa D","12:30  Signify (until 15:00)","13:30  Gym (until 15:15)","16:30  Hebrew practice","+ 3 more"],"open":"https://george-wightman.github.io/dashboard/"},
"fuel":{"title":"Fuel","number":"57 g","caption":"of 180 g protein today","lines":["Breakfast: Big egg breakfast · 57 g","This week ≈3,690 kcal a day"],"open":"https://george-wightman.github.io/dashboard/?big=fuel"},
"hebrew":{"title":"Hebrew","number":"0:45","caption":"of 7 h this week","lines":["12 of 40 reps spoken","3 of 15 words live","○○●····  Mon–Sun"],"open":"https://george-wightman.github.io/dashboard/?big=hebrew"},
"body":{"title":"Body","number":"30","caption":"of 90 cardio min this week","lines":["Gym 1 of 5 this week","Back this morning: fine"],"open":"https://george-wightman.github.io/dashboard/?big=body"},
"goals":{"title":"Goals","number":"2","caption":"goals on the go","lines":["Reread Man's Search for Meaning: 7% · by 30 Nov","Remote income alongside Signify: 0 of 5 · by 20 Dec"],"open":"https://george-wightman.github.io/dashboard/?big=goals"},
"countdown":{"title":"Countdown","number":"17","caption":"days to Flight to Salzburg","lines":[],"open":"https://george-wightman.github.io/dashboard/?big=countdown"},
"week":{"title":"This week","number":"","caption":"","lines":["Nothing to show yet."],"open":"https://george-wightman.github.io/dashboard/?big=week"}}}"""

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

    @Test fun beforeConnectingItSaysHow() {
        val view = Widgets.views(ctx, "fuel", null, 0, null, connected = false).apply(ctx, FrameLayout(ctx))
        assertTrue(view.findViewById<TextView>(R.id.lines).text.contains("Connect"))
        assertEquals(View.GONE, view.findViewById<View>(R.id.number_row).visibility)
    }
}
