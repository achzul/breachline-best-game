![Live rank](https://make.fun/badge/best-game-01/achzul/breachline-best-game/rank.svg)
![Live reward](https://make.fun/badge/best-game-01/achzul/breachline-best-game/reward.svg)
![make.fun bounty badge](https://make.fun/badge/best-game-01.svg)

Entry for the make.fun bounty: [Make the best game](https://make.fun/bounty/best-game-01)

# BREACHLINE — Kestrel Yard

A round-based tactical FPS that runs entirely in the browser. You fight
with the **Wardens**: you plus four bot teammates against five bot
**Jackals** who push one of two sites on the Kestrel Yard map and try to
plant the **Charge**. Stop the plant, wipe them out, or defuse the Charge
— first team to **7 rounds** takes the yard.

Every round opens with a 12-second **buy phase**. Kills pay $300, round
wins $1,400, a plant pays the whole Jackal team $800, and losers get a
growing loss bonus — so the economy, not just aim, decides who brings
carbines and who saves with pistols.

## How to play

| Input | Action |
| --- | --- |
| WASD / mouse | Move / look (click the game to lock the pointer) |
| Left click | Fire (hold for automatics) |
| Right mouse | Aim down sights (the Longbow-7 zooms) |
| R | Reload |
| Space | Jump |
| Ctrl / C | Crouch |
| 1 / 2 | Primary / sidearm |
| 3 / 4 / 5 | Select frag / smoke / flash grenade, click to throw |
| E (hold) | Defuse the planted Charge |
| Buy phase: 1–8 | Shop — the number keys belong to the store until the round goes live |

## What's inside

- **A real match structure** — buy phase, 100-second rounds, a 40-second
  Charge fuse, 2.8-second plant and 5-second defuse channels, loss-bonus
  economy, first to 7, and a full end screen with the ten-player K/D
  table and one-click restart.
- **Bots with a plan, not a script** — vision cones with line of sight,
  gunfire noise, six-second memory, waypoint navigation. The Jackals run
  a carrier + escort push with a mid and a lurk that commit on contact;
  the Wardens hold guard spots, rotate on noise, converge on a plant and
  send the nearest bot to defuse under cover.
- **One shared combat model** — the player and every bot fire through the
  same hitscan code: range falloff, headshots, armour absorption,
  movement and recoil bloom, magazines and reloads, plus frag, smoke and
  flash grenades with real bounce physics.
- **Zero runtime network, zero assets** — the map, bodies, guns and
  ground textures are procedural; every sound is synthesized WebAudio.
  three.js is vendored as its minified builds under `game/vendor/`.

## Run it locally

```sh
node serve.ts            # static server on http://localhost:8080
# or: node serve.ts --port 8901
```

Then open the page, read the briefing, and click to play. Add
`?seed=1234` for a different match shuffle, `?autostart=1` to skip the
title screen.

## Layout

- `game/` — the playable game (static files; `index.html` + `src/`)
- `main.ts` — the make.fun hand-in: copies `game/` and `screenshots/`
  to the output directory and writes `dossier.json`
- `serve.ts` — a tiny local static server for development
- `shots.json` / `screenshots/` — the staged dossier screenshots
- `BUILD_NOTES.md` — design, contract mapping and verification results

MIT licensed — see `LICENSE`.
