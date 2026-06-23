#!/usr/bin/env node
// scripts/copy-gdal-wasm.js
//
// gdal3.js ships its .wasm and .data files inside node_modules. Next.js's
// build doesn't bundle these automatically (they're large binary blobs, not
// JS modules), so we copy them into /public/gdal3wasm at install time, and
// the client fetches them from there at runtime (see lib/gis/parseGisFile.ts
// -> initGdalJs({ path: '/gdal3wasm' })).
//
// Run automatically via the "postinstall" script in package.json.

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'node_modules', 'gdal3.js', 'dist', 'package');
const DEST_DIR = path.join(__dirname, '..', 'public', 'gdal3wasm');

const FILES_TO_COPY = [
  'gdal3.js',
  'gdal3WebAssembly.wasm',
  'gdal3WebAssembly.data',
];

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.warn(
      `[copy-gdal-wasm] Could not find ${SRC_DIR}. Did "npm install" run? Skipping copy — GIS upload parsing will not work until this is fixed.`
    );
    return;
  }

  fs.mkdirSync(DEST_DIR, { recursive: true });

  for (const file of FILES_TO_COPY) {
    const src = path.join(SRC_DIR, file);
    const dest = path.join(DEST_DIR, file);
    if (!fs.existsSync(src)) {
      console.warn(`[copy-gdal-wasm] Expected file not found, skipping: ${src}`);
      continue;
    }
    fs.copyFileSync(src, dest);
    console.log(`[copy-gdal-wasm] Copied ${file} -> public/gdal3wasm/`);
  }

  console.log(
    '[copy-gdal-wasm] NOTE: gdal3WebAssembly.data/.wasm are large (commonly tens of MB). ' +
    'They live under public/ and are served as static assets — Vercel serves /public ' +
    'files via its CDN/edge layer, NOT through a serverless function, so they do not ' +
    'count against function size limits. They DO count against your repo size and ' +
    'Vercel build output size; if this becomes a problem, fetch them from a CDN ' +
    '(e.g. jsdelivr, see commented alternative in lib/gis/parseGisFile.ts) instead ' +
    'of vendoring them into the repo.'
  );
}

main();
