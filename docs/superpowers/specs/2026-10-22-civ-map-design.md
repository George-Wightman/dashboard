# The map: Civ-style progress for the dashboard

Status: design, 22 Oct 2026, from the third playable mockup (a private artifact) and the additions
George asked for on top of it. The places, their positions, the drawings of real buildings and the
map data are personal, so they live in the private sync repo (`notes/civ-map.md`, `map/`), never in
this public repo. Everything here is generic.

## Why

George plays a lot of Civilization 6 and wants his days to build something he can see: a cartoon hex
map of the real place he lives that grows as he ticks off his day, with discovery and a little
choosing, the "one more turn" pull. Missed work costs him. It mirrors his days; it is not a second
game to play, so a day's choices take under a minute.

## Goals

- A city per place he lives, each on a hex land inside a game-drawn England and Europe. The home city now,
  the next ones later (each from its own map file).
- One honest loop: ticked work earns hammers, hammers become tiles he chooses to claim, misses bring
  barbarians that head for what he neglected.
- Discovery: only one ring past his borders is visible; places and small finds are a surprise; the
  wonders are plain stars on the horizon until built.
- Earned things he places himself: building cards from Hebrew, gym and reading, and wonder cards from
  goal steps.
- A map that reacts to his days: golden ages for finished streaks, roads from his cardio, buildings
  that level up, the real season on the land, and a morning replay of yesterday.
- A record of the era: a chronicle of turns with his own check-in words, and a time-lapse.
- Claude sees the map in a catch-up; the phone gets a map widget.

## Non-goals

- Civ's other systems: tech trees, combat, rival civs, trade, a choice every day beyond picking tiles
  and placing cards.
- Phone notifications for the map.
- Other cities' map files in this build (the code takes any number of cities).

## Anti-goals (failure even if it works)

- A map that makes a bad day look good. It reads the honest day score (`dayScore` in
  `js/schedule.js`): moving or deleting work after the 11:00 lock counts as it already does.
- Padding rewarded: many tiny tasks must not beat one long one.
- Anything personal in this repo: place names, positions, drawings of real buildings, his data.
- Permanent labels and clutter: names show on hover or tap, and only on tiles with something on them.
- A tile that pushes other tiles off his one screen.

## How it plays

**A day is a turn,** settled once it's over (the app's day boundary). Today shows as in progress.
A day's hammers go to the city he was in (below).

**Hammers.** Each counted, ticked row in `dayScore` earns 10, or 20 when it was planned for an hour or
more. A finished day (done = total, at least 3 counted rows) adds 20.

**Tiles.** 40 hammers (30 in a golden age) give a tile to claim; he can bank 5. He claims by choosing
any land tile next to his borders. If a turn would bank more than 5, the extra are claimed for him by
a fixed rule (nearest the centre), so no progress is lost.

**Vision.** He sees his tiles and one ring past them. Beyond is fog: a parchment hex pattern that
hides where the land ends. Wonder sites show in the fog as one plain star, and stay a star (gold once
his) until built.

**Finds.** About one land tile in ten holds a small find (coal, deer, wheat, sheep, horses, a pub, an
old pit wheel, stone, fish), worth 10 to 20 hammers once when claimed.

**Places** (neighbourhoods, parks, shops, home) appear the moment they come into sight, with a
"Discovered" banner, and are his once claimed.

**Building cards.** Three tracks fill from rows by area (Learning from Hebrew, Sport from Health,
Culture from Reading; the mapping is in the map file): each earns its buildings in order at set
thresholds. A card is placed on any tile of his in that building's zone (its real spot and the six
round it), shown as a faint dashed outline in the track's colour once he's seen it.

**Levels.** Once a track's cards are all earned, further points level its placed buildings up (level
2, then 3), each drawn with a visible upgrade.

**Wonder cards.** Each goal milestone ticked gives one. It is placed on a wonder site he owns; only
then does the wonder show what it is.

**Golden ages.** Three finished days in a row start one; it lasts while the run does. Borders glow
gold and tiles cost 30. A day with a miss ends it; days entirely off don't count either way.

**Barbarians.** A day with anything left undone sends a camp out of the fog, 3 tiles beyond the
border, on the side of what was neglected: the zone or building of the track of the missed row (a missed gym
heads for the gym), or home for a row with no track. Each turn every camp moves one tile towards its target.
On a missed day, a camp next to his border raids the owned tile nearest its target (the building
itself if it's there): a raided tile is darkened, and the next 20 hammers repair it before anything
else. A finished day drives off the nearest camp.

**Roads.** Each 10 minutes on the cardio target lays one road step, along the shortest path through
his tiles from the centre to the nearest place, building or wonder not yet joined up.

**Which city.** The device's time zone picks the place (`placeFor` in `js/sky.js`): the first device
open of a day stamps the day's place in the shared document; a day with no stamp takes the previous
day's. A city's map file says which place and dates it covers (say, the UK until a move).
Hammers from a day with no city wait for that city's file.

## The look

The third mockup's style: chunky cartoon hexes with depth, varied terrain (grassland, farmland,
forest, hills, park, water, town, market, works), sparse decoration, finds as small icons, placed
buildings on a plaza in their track's colour, a see-through city banner, faint railways, rivers. The
land is true to scale at about 1 km a tile with only the town centre opened out; England and Europe
are drawn at 3 km a tile, game-style coasts filled with the fog pattern, the places he'll go next pinned.

**Seasons** follow the real date: autumn colours on trees (Sep to Nov), snow on the land and roofs
(Dec to Feb), blossom (Mar to May), plain green in summer.

## Where it shows

- **A dashboard tile:** a small picture of the land and the headline numbers: tiles to claim,
  hammers to the next tile, a golden age or barbarians when there are any.
- **The morning turn:** the first time a device shows the tile on a new day, yesterday plays out on
  it: the hammers count up, new things rise in, and a line says what happened. Shown once per device.
- **The big view (⤢):** the playable map (pan, zoom, the land / England / Europe), claiming and
  placing, the cards, the tracks with levels, the chronicle, and a time-lapse of the era.
- **Chronicle:** one entry per turn with what happened (discoveries, buildings, wonders, golden
  ages, raids), and the first line he said in that day's check-ins.
- **Claude:** `catchup` and a `map` read summarise the map: tiles, banked, golden age, camps and what
  they're heading for, what's next.
- **Phone:** a Map widget (title, tiles, a few lines), from the planner's glance.

## Data and privacy

- Game state is never stored. The map is a pure function of the shared document, the map file and
  his choices: replay every settled turn from the city's start.
- His choices are records in a new `game` map in the document, one per choice so two devices merge
  cleanly: `claim:<city>:<q>,<r>` and `place:<city>:<card>` with the day and time, and
  `day:<YYYY-MM-DD>` for the day's place. The replay applies choices in time order on their day and
  ignores any that aren't legal then (two devices claiming the same last tile).
- Milestones stamp `doneOn` when ticked; an old done milestone with no stamp uses its `updated` day.
- A city's map file is `map/<city>.json` in the sync repo, read with the same key as `data.json`,
  kept on the device for offline use, under 1 MB. With no file, the feature is hidden.
- Drawings of real buildings are SVG strings in the map file, drawn through `<image>` so nothing in
  them can run. The generic art lives here.
- A generic script here (`dev/build-map.mjs`) builds a city's map file from a private places file and
  OpenStreetMap. Tests use an invented town.

## Left to the builder

Exact palettes, the animation, the replay's caching, the chronicle's wording, and the tile's layout,
within the mockup's look.
