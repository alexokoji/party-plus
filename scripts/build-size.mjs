/**
 * Production build + gzip bundle report, written to its own dist directory.
 *
 * This exists so measuring bundle size never touches `.next`. `next build`
 * and `next dev` share `.next` by default, so building while the dev server
 * is running replaces the chunks it is serving and the dev server then fails
 * with "Cannot find module './NNN.js'" until restarted.
 */
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";

const DIST = ".next-size";

rmSync(DIST, { recursive: true, force: true });

const build = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  env: { ...process.env, DIST_DIR: DIST },
  shell: process.platform === "win32",
});
if (build.status !== 0) process.exit(build.status ?? 1);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".js")) out.push(full);
  }
  return out;
}

const chunkDir = join(DIST, "static", "chunks");
const files = walk(chunkDir)
  .map((f) => {
    const raw = readFileSync(f);
    return { file: f.replace(chunkDir + "\\", "").replace(chunkDir + "/", ""), raw: raw.length, gzip: gzipSync(raw).length };
  })
  .sort((a, b) => b.gzip - a.gzip);

const totalGzip = files.reduce((sum, f) => sum + f.gzip, 0);
const kb = (n) => (n / 1024).toFixed(1).padStart(7) + " KB";

console.log("\nClient chunks by gzip size:\n");
for (const f of files.slice(0, 12)) {
  console.log(`${kb(f.gzip)} gzip  ${kb(f.raw)} raw   ${f.file}`);
}
console.log(`\n${kb(totalGzip)} gzip  TOTAL across ${files.length} client chunks\n`);
