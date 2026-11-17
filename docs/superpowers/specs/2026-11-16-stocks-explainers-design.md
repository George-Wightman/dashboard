# Stocks: tap to explain (short design)

**Why.** George isn't an investor by training. The Stocks card shows five lens dots with terse reasons
("P/E 21, below its 2-year median of 39") and verdicts ("mixed") that don't say what they mean. He
wants to tap a thing and learn what it is, what we look for, and what his reading says.

**Goals.** Every lens, every verdict, "a moment to add?" and the jargon inside reasons (P/E, gross
margin, operating margin, return on capital, RSI) can be tapped for a plain-English explainer.
**Non-goals.** No new data, no AI calls, no advice. **Anti-goals.** Anything that reads as "buy" or
"sell"; text that needs a network; a wall of text on a phone.

**Approaches.**
- *Written explainers plus a plain reading of his number* (chosen): fixed text per lens and term, and
  a sentence built from the reason line and dot. Free, instant, offline.
- *Ask Gemini on tap*: personal, but his rule keeps Gemini to check-ins, and it fails offline.
- *Written explainers only*: simplest, but doesn't answer "what does mine say", which is the point.

**Design (agreed 16 Nov 2026).**
- Tap a lens name on a holding's card: a panel opens under it with *What it is*, *What we look for*,
  *Green / amber / red*, *Yours*. One panel open at a time; tap again to close.
- Known terms inside a reason are underlined; tapping one opens the term's explainer in the same place.
- The verdict line and "A moment to add?" open their own explainers the same way.
- Text lives in `js/stocks-explain.js` (pure, tested); `js/ui/stocks.js` wires the taps.

**Left to the builder.** Exact wording (plain, second person, no advice), styling within the
existing Stocks look.
