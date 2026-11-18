// main.ts — the Palm Cove Heat entry program for make.fun's gta6-01 bounty.
//
// It assembles the hand-in: copies the static game (game/) and the maker's
// screenshots (screenshots/) from this repository into the output directory
// (MAKEFUN_OUTPUT_DIR, or /output on the grader), then writes dossier.json
// with the kit's own buildDossier so the dossier matches, byte for byte,
// what the sealed scorer builds from the same files.
//
// Node 22, standard library only, no network. Running it twice on the same
// repository writes the same bytes: the copy order is sorted and the
// dossier is canonical JSON.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The grader mounts the repository at MAKEFUN_BOT_DIR and does not promise
// any particular working directory, so resolve the source tree from the
// environment, falling back to this file's own directory — never from cwd.
const repoRoot = process.env.MAKEFUN_BOT_DIR || dirname(fileURLToPath(import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// The caps the bounty's gate.json hands to buildDossier (see the header of
// vendor/makefun-game.ts): only text_max_bytes shapes the dossier's bytes,
// the rest make this program refuse exactly where the scorer would.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function requireDir(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new Error(`main.ts: expected ${label} at ${path}, but it is missing`);
  }
}

/** Copy a directory tree, visiting entries in sorted order for determinism. */
function copyTreeSorted(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  const entries = readdirSync(from, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copyTreeSorted(src, dst);
    else cpSync(src, dst);
  }
}

/** Count files and bytes under a directory, recursively. */
function treeStats(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = treeStats(path);
      files += sub.files;
      bytes += sub.bytes;
    } else {
      files++;
      bytes += statSync(path).size;
    }
  }
  return { files, bytes };
}

function main(): void {
  const gameDir = join(repoRoot, 'game');
  const shotsDir = join(repoRoot, 'screenshots');
  requireDir(gameDir, 'the game directory');
  requireDir(shotsDir, 'the screenshots directory');
  requireDir(join(gameDir, 'index.html'), 'game/index.html');

  // The bounty takes 3 or 4 screenshots; refuse early with a clear message
  // rather than letting the dossier build fail on a technicality.
  const shots = readdirSync(shotsDir).filter((name) => /\.(png|jpe?g)$/i.test(name));
  if (shots.length < 3 || shots.length > 4) {
    throw new Error(`main.ts: screenshots/ must hold 3 or 4 images, found ${shots.length}`);
  }

  // Start from a clean output directory so stale files can never leak into
  // the hand-in and break the byte-for-byte dossier comparison. Empty the
  // directory's contents rather than removing the directory itself: on the
  // grader the output directory is a mounted volume, and removing a mount
  // point (or a directory whose parent is a read-only root) fails the run
  // with EBUSY/EROFS before any work happens.
  mkdirSync(outputDir, { recursive: true });
  for (const entry of readdirSync(outputDir)) {
    rmSync(join(outputDir, entry), { recursive: true, force: true });
  }

  copyTreeSorted(gameDir, join(outputDir, 'game'));
  copyTreeSorted(shotsDir, join(outputDir, 'screenshots'));

  const dossier = buildDossier(outputDir, DOSSIER_CAPS);
  writeFileSync(join(outputDir, 'dossier.json'), dossier);
  if (dossier.byteLength > 1.5 * 1024 * 1024) {
    throw new Error(`main.ts: dossier.json is ${dossier.byteLength} bytes, over the 1.5 MiB cap`);
  }

  const stats = treeStats(outputDir);
  console.log(
    `palm-cove-heat: handed in ${stats.files} files (${stats.bytes} bytes) ` +
      `with a ${dossier.byteLength}-byte dossier.json`,
  );
}

main();
