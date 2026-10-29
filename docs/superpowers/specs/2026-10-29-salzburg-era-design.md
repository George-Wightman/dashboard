# The Salzburg era — design

The second city on the map (docs/superpowers/specs/2026-10-22-civ-map-design.md). George flies to
Salzburg on 7 Nov 2026 and is there until about 4 Dec. After that it depends on a visa: with it, most
of January to April is in Salzburg (about 130 Salzburg days in all); without it, about 40 more days,
spread over short visits. The embassy was asked on 29 Oct; the answer will take a while. He moves to
London in May.

## Intent

The map carries on in Salzburg, so the life he leads there grows a world the way Mansfield does in
the UK. Salzburg life is different: no gym, a bodyweight and cardio routine (push-ups, squats, a
pull-up bar park nearby, runs); his days are free while Maya works, so the shopping, cleaning and
cooking are his; he picks up Signify shifts when he can. Hebrew stays the main focus and reading
stays at three times a week. He wants a routine with set times, but not rigid ones.

The length of stay is unknown, so the pace can't be set for "until April". Each visit is a chapter:
a solid month must feel finished on its own, and the same map carries on next visit.

## Goals

- A Salzburg map file, built like Mansfield's, that the existing city switch (the day's place stamp)
  picks up from 7 Nov.
- Five tracks: Learning (Hebrew), Sport (bodyweight and runs), Household (shopping, cleaning,
  cooking), Work (Signify shifts) and Culture (reading).
- Signify shifts earn hammers, in both cities, and fill the Work track. They are never a miss.
- Chapter 1 (7 Nov to 4 Dec): a month of solid days earns the first building on every track and
  reaches a couple of the nearby places.
- Enough land and buildings for the visa case. In the no-visa case a short visit grows land and finds
  places; it needn't end with a building.

## Non-goals and anti-goals

- No change to how a day scores: the same honest day score, barbarian rules (one camp per track,
  only missed tracks raid) and golden ages as Mansfield.
- Work is never a miss and never part of a day's done/total: shifts aren't his to choose.
- Nothing personal in the public repo: the flat, the places, their names and the drawings live only
  in the private sync repo's `map/` folder. Hidden places are never named to him.
- Not a reskinned Mansfield: Salzburg's own ground (the river, the old town, the hills and the
  mountains) and its own finds.

## How it works

**The city.** Centred on his flat (the centre tile). Drawn like a tourist map, not to scale (George,
29 Oct, after seeing the first build: "the city parts more spread out … the stuff further away, like
the mountains, we can reduce that distance"): `a·ln(1 + d/s)` tiles at d km from the old town, so the
old town's sights sit tiles apart and the villages, castles and mountains round the edge are pulled in.
Small city hills cover only their own tile and the ring round it; there's no random-hill noise. The land
reaches out to the mountains for later chapters. No coastline clip: Salzburg isn't on an island; the
world view shows Austria in Europe. `place: 'salzburg'`, from 2026-11-07 to 2027-04-30.

**Places he knows** show from the start or almost: the flat, his supermarket, the pull-up bar park.
About two dozen more, from the old town out to the villages and the German border, and the rest — neighbourhoods, parks, the old town's sights, the buildings' spots, the wonder sites — are
picked by Claude from the real map and stay hidden until he reaches them. The fortress and the
mountains are wonder sites (he named them himself, so they can show as stars).

**Tracks** (areas → track):
- Learning: Hebrew.
- Sport: Health, Gym (bodyweight sessions in Hevy, runs from the watch).
- Household: Home, Food (the "Shop and cook for Maya" habit, chores, cooking — Food still never
  counts as a miss, but cooking done earns its hammers here).
- Culture: Reading.
- Work: Signify shifts (below).

Each track has three or four buildings at rising thresholds. Chapter 1's thresholds are set from his
real rates so a solid month earns the first card on each; the later ones are set for the visa case and
revisited when the embassy answers (raising an unearned threshold changes nothing he has).

**Signify shifts.** The planner already reads his Work calendar. It records each shift that has
ended as a work record in the shared document (fixed id per event, following edits, taken off if the
event goes), like the Health runs. The map adds, on that day, 20 hammers for a shift of an hour or
more (10 for shorter) to the pool and the Work track, in whichever city the day belongs to. Mansfield
has no Work track, so there they're hammers only. They don't change the day's done/total and can't
send barbarians.

**Short visits** (George, 29 Oct): new land and places are enough for a short visit; it needn't end
with a building. So the buildings after Chapter 1's are spaced for the visa case (about 130 Salzburg
days), not for 10-day visits.

**Pacing.** Same costs as Mansfield (40 a tile, bank 5, finished-day bonus 20).

**Look.** The Mansfield style. New ground: mountain (from OSM peaks, cliffs and bare rock, and the
hills round them), with a drawing in the public renderer. The river is the Salzach from OSM. Finds
are Salzburg's own (names and values come from the map file, not the engine's Mansfield list).
Drawings for every building and wonder in a private art module.

## Calls made while writing this (Claude's, not George's)

- **The routine isn't part of this build.** His Salzburg habits and their times are set with him in a
  planning chat before 7 Nov. Bodyweight sessions logged in Hevy tick the existing Gym habit (area
  Health), as JD sessions do now; runs tick the Easy run habit. "Shop and cook for Maya" is area Home.
  So Sport = Health, Gym; Household = Home, Food.
- **Shifts count from the release onwards,** like the Health runs (`startedOn`): past shifts aren't
  backfilled, so his Mansfield map doesn't change under him on release.
- **A chapter is a visit:** a run of Salzburg days with no UK day between them. The map shows the
  chapter number and its dates; the label needs no thresholds.
- **"A solid month"** is his good weeks, not perfect ones: about five days in seven on each daily
  thing, three or four bodyweight sessions and two runs a week, reading three times. The first card on
  each track sits at about 70% of what such a month earns. Work's first card needs only a few shifts,
  since how many he's offered isn't his choice.
- **Camps:** one per track plus one for home, so up to six in Salzburg (`MAX_CAMPS` becomes the
  number of tracks plus one).
- **The anchors:** his supermarket is the nearest Billa (about 400 m); the pull-up bar park is the
  nearest outdoor fitness station (about 700 m). Both are visible from the start. He can correct either.

## Constraints

- Live by 7 Nov (he flies that morning). The engine and planner changes go out through the usual
  release (build-release, planner bundle).
- Replay stays pure and deterministic: work records are just more input.
- The builder (`dev/build-map.mjs`) must keep building Mansfield exactly as before.

## Left to the builder

The exact places and their positions, building thresholds from his real numbers, the finds list,
the drawings, and how the planner tells shifts apart from other events on the Work calendar.
