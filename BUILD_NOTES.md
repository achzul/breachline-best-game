# BREACHLINE for best-game-01 — build notes

## What this entry is

BREACHLINE is a round-based tactical FPS: the player and four bot
Wardens defend the Kestrel Yard against five bot Jackals who push a site
and plant a Charge. It was re-implemented fresh for best-game-01
("Make the best game", any genre) from the proven BREACHLINE design —
same match structure, economy, map concept and bot doctrine — authored
in this session against this competition's kit contract. The kit's own
`vendor/makefun-game.ts` is copied byte-for-byte (sha256
`dc67187521b24025ff952f8c231485a6eb92d6d71d29edd2a08154ffb4376129`,
verified after copying); everything else, including `main.ts`, is new
code written for this entry.

## The game

- **Match**: buy phase 12 s → live round 100 s → planted fuse 40 s;
  plant channel 2.8 s, defuse channel 5 s; first to 7 rounds.
- **Economy**: start $800; kill +$300; round win +$1,400; loss bonus
  $1,000 growing $200 per consecutive loss (cap $1,800); plant pays the
  planter +$300 and the whole Jackal team +$800 at round end.
- **Shop** (buy-phase number keys): Raptor-9 SMG $1,500, Mule 12G
  $1,700, VK-7 Carbine $2,700, Longbow-7 DMR $3,400, Kevlar $650, frag
  $300, smoke $300, flash $200. Loadouts persist across rounds; dying
  resets them.
- **Combat**: one shared hitscan model for player and bots — range
  falloff, headshot ×4, armour absorption (55% body / 25% head),
  movement/recoil bloom, magazines, reloads; frag (splash with LOS),
  smoke (10.5 s, blocks sight and perception) and flash (facing- and
  distance-scaled blindness) grenades with bounce physics.
- **Bots**: perception = ~58° vision cone + line of sight + gunfire
  noise + 6 s memory; navigation = waypoint graph with BFS paths over
  the yard's 33 nodes. Jackals: a carrier stages at the site entry until
  its push escorts gather, then plants — breaking off only for a close
  visible threat — while a mid and a lurk pressure and commit on first
  team contact or first death. Wardens: guard spots per site, intercept
  fresh contacts, rotate from a quiet site to a loud one, and on a plant
  the nearest bot defuses while the rest take post-plant spots.
- **Presentation**: procedural low-poly yard (canvas-generated ground
  and material textures), box-built bodies and guns, tracer lines,
  impact puffs, sprite smoke, explosion shake, synthesized WebAudio for
  every sound (no audio assets), DOM HUD with minimap, killfeed, buy
  menu, banners, channel bar, damage vignette and flash overlay.
  Title, buy, live and match-end screens are all real game states.

## Contract mapping (best-game-01 RULES.txt)

- Playable game is static files under `game/`, opening at
  `game/index.html`; the only library is three.js, vendored as its
  `*.min.js` builds under `game/vendor/three/` (plus its LICENSE), so
  the ~2.1 MB of library code is classified vendored in the dossier and
  does not count as authored source. The game makes zero runtime
  network requests.
- `main.ts` (authored for this entry, not the kit starter) copies
  `game/` and `screenshots/` into `MAKEFUN_OUTPUT_DIR` (default
  `/output`) and writes `dossier.json` through `buildDossier` from the
  kit's `vendor/makefun-game.ts`, with the same caps the starter used:
  text ≤ 160 KiB, screenshots ≤ 4 and ≤ 256 KiB each, game ≤ 993 files
  and ≤ 48 MiB.
- `shots.json` lists four staged screenshots; `screenshots/` holds the
  four real captures, first by name = cover. All are 1280×800 JPEGs
  under 256 KiB (49–78 KiB as captured).
- `.makefun/owner.json` carries the entrant wallet; README opens with
  the competition's live rank/reward badges; LICENSE is MIT with an
  explicit SPDX line.

## Architecture

Fixed-step simulation (1/60 s) in `game/src/state.js`; rendering, fx,
audio and HUD only read state and drain a per-step event queue, which
keeps matches deterministic per seed and makes headless verification
exact. Modules: `world` (map, colliders, waypoint graph, scene),
`physics` (movement collision, raycasts, smoke-aware sight),
`weapons` (combat + grenades), `bots` (perception, plans, combat),
`player` (pointer-lock controls), `rounds` (phase machine, shop,
channels, payouts), `actors` (records + procedural bodies), `view`,
`fx`, `audio`, `hud`, `input`, `main` (bootstrap, debug handles,
screenshot staging).

Design lessons carried over from the design's earlier verification
round, applied from the start: the buy keys and weapon-slot keys share
the number row through one edge queue with exactly one consumer per
phase; the carrier never outruns its escorts and never abandons a plant
for a distant contact; a recovered Charge promotes its picker to
carrier with the plan attached; mid/lurk commit triggers include first
contact and first death, not just timers.

## Verification (headless, puppeteer + chrome-headless-shell)

Harness kept outside the entry tree. All checks passed:

- **Load**: zero JS errors; 10 actors; title phase with the title
  screen up.
- **Buy flow**: an unaffordable press is ignored ($800 vs VK-7 $2,700);
  after a top-up, Digit3 buys the VK-7 and Digit5 Kevlar with exact
  money math ($5,000 → $1,650); the round goes live when the buy clock
  runs out.
- **Plant**: a carrier staged on its site plants (channel completes,
  phase flips to planted). **Defuse**: a Warden bot brought to the
  planted Charge channels it down and the round scores to the Wardens.
- **Full matches**: seeds 7 and 21 both play to completion (first to
  7), with plants in most rounds (3–10 per match across runs) and heavy
  combat (41–86 kills, 1,400–2,600 shots per match). Match outcomes
  vary between runs because bot think offsets use `Math.random()` —
  completion, plants and combat volume held in every run.
- **Screenshots**: all four staged shots captured from the running
  game and visually inspected (a firefight at site A, the title
  screen, the buy menu, the match-end screen).
- **Hand-in**: `node main.ts` run twice produces byte-identical
  `dossier.json` (438,299 B ≤ 1.5 MiB cap); the dossier's judge-visible
  text is 105,030 B ≤ 160 KiB cap, reporting 16 authored source files
  (103,809 B) and 3 vendored files (three.js builds + LICENSE).

### Bugs found and fixed during this build

- **Module API drift**: the combat module's killfeed/event shapes and
  `applyDamage` signature diverged from their consumers mid-build;
  consumers (bots, HUD, audio) were reconciled to the shared model —
  bots fire exclusively through the same `tryFire` path as the player.
- **Defuse test flakes (test design, not game bugs)**: the isolated
  defuse test twice raced its own staging — parked Jackal bots walked
  back to the site on their planted-phase plan and killed the test
  bot, and the page's live rAF loop kept playing the match between
  harness calls, so the staged bot could already be dead (or the round
  over) before the test's second call ran. The test now runs its whole
  staging inside one evaluate call, revives the bot it stages, and
  removes the Jackals from play; the suite then passed 18/18 twice in
  a row.
- **Cover-shot staging**: the staged player was killed by the staged
  firefight (death-cam cover), and the soak's debug HP leaked into the
  HUD as "99830". Staging now keeps the camera alive and the HUD
  clamps displayed HP to 100.
- **End-screen overlap**: the final round's banner showed through the
  match-end overlay; banners now hide when the match is over.

## Running locally

`node serve.ts` serves `game/` on http://localhost:8080 (`--port N`
to change). Debug handles for testing: `window.__game`,
`window.__actors`, `window.__tick(n)`; URL params `?seed=`,
`?autostart=1`, `?shot=title|buy|cover|end` (sets `window.__shotReady`).
