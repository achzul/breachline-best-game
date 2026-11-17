// BREACHLINE — hand-in program for the make.fun best-game-01 bounty.
//
// The game itself is the static site in game/ (open game/index.html in a
// browser and play; nothing is built and nothing is fetched). This program
// is only the courier: it copies game/ and screenshots/ into the output
// directory and writes the dossier the judge reads, using the kit's own
// dossier library (vendor/makefun-game.ts, byte-identical to the kit).
//
// Run locally the same way the grader runs it, with an output override:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyTree(name: string): void {
  const from = join(root, name);
  if (!existsSync(from)) return;
  cpSync(from, join(outDir, name), { recursive: true });
}

mkdirSync(outDir, { recursive: true });
copyTree('game');
copyTree('screenshots');

// The caps below are the scorer's own limits for this bounty: they shape the
// dossier's text budget and refuse shapes the scorer itself would refuse
// (too many screenshots, an oversized game/ tree, an over-long path).
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
