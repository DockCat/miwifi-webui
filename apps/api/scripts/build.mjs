/**
 * API build script: bundle with esbuild.
 *
 * The migration SQL files are copied next to the bundle because the
 * migration runner reads them from disk at runtime.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const result = await build({
  entryPoints: [path.join(rootDir, 'src/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: path.join(distDir, 'main.js'),
  // Node built-ins stay external so CJS `require("node:…")` from
  // dependencies keeps working under ESM output.
  packages: 'external',
  external: ['pg-native'],
  sourcemap: true,
  logLevel: 'info'
});

await cp(
  path.join(rootDir, 'src/db/migrations'),
  path.join(distDir, 'migrations'),
  { recursive: true }
);

if (result.errors.length > 0) {
  process.exit(1);
}
