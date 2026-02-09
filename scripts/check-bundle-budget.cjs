#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DIST_DIR = path.resolve(__dirname, '..', 'dist', 'assets');

const BUDGETS = {
  jsGzip: 320 * 1024,
  cssGzip: 32 * 1024,
  staticGzip: 420 * 1024
};

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function gzipSize(filePath) {
  const buf = fs.readFileSync(filePath);
  return zlib.gzipSync(buf).length;
}

if (!fs.existsSync(DIST_DIR)) {
  console.error('Bundle budget check failed: dist/assets not found. Run a build first.');
  process.exit(1);
}

const files = walk(DIST_DIR);
const jsFiles = files.filter((f) => f.endsWith('.js'));
const cssFiles = files.filter((f) => f.endsWith('.css'));
const staticFiles = files.filter((f) => f.endsWith('.glb') || f.endsWith('.fbx') || f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.webp'));

const totals = {
  jsGzip: jsFiles.reduce((sum, f) => sum + gzipSize(f), 0),
  cssGzip: cssFiles.reduce((sum, f) => sum + gzipSize(f), 0),
  staticGzip: staticFiles.reduce((sum, f) => sum + gzipSize(f), 0)
};

console.log('Bundle budget report (gzip):');
console.log(`- JS: ${totals.jsGzip} / ${BUDGETS.jsGzip} bytes`);
console.log(`- CSS: ${totals.cssGzip} / ${BUDGETS.cssGzip} bytes`);
console.log(`- Static assets: ${totals.staticGzip} / ${BUDGETS.staticGzip} bytes`);

const failures = [];
if (totals.jsGzip > BUDGETS.jsGzip) failures.push('JS bundle exceeds budget');
if (totals.cssGzip > BUDGETS.cssGzip) failures.push('CSS bundle exceeds budget');
if (totals.staticGzip > BUDGETS.staticGzip) failures.push('Static assets exceed budget');

if (failures.length) {
  console.error('\nBudget check failed:');
  failures.forEach((line) => console.error(`- ${line}`));
  process.exit(1);
}

console.log('\nBudget check passed.');
