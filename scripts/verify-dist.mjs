import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const base = process.env.VITE_APP_BASE || '/audacity-web-pwa/';
const checked = new Set();

if (!base.startsWith('/') || !base.endsWith('/')) {
  throw new Error(`VITE_APP_BASE must start and end with '/': ${base}`);
}

function verifyAsset(reference, owner) {
  if (!reference || /^(?:[a-z]+:|\/\/|#|data:)/i.test(reference)) return;
  const clean = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  let relative;
  if (clean.startsWith('/')) {
    if (base !== '/' && !clean.startsWith(base)) {
      throw new Error(`${owner} references ${clean} outside deployment base ${base}`);
    }
    relative = base === '/' ? clean.slice(1) : clean.slice(base.length);
  } else {
    relative = clean;
  }
  const target = resolve(dist, relative);
  if (target !== dist && !target.startsWith(`${dist}${sep}`)) {
    throw new Error(`${owner} references a path outside dist: ${reference}`);
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    throw new Error(`${owner} references missing asset ${reference} (${target})`);
  }
  checked.add(target);
}

const index = readFileSync(resolve(dist, 'index.html'), 'utf8');
const notFound = readFileSync(resolve(dist, '404.html'), 'utf8');
if (index !== notFound) throw new Error('404.html must match the built index.html');

for (const name of ['index.html', '404.html']) {
  const html = readFileSync(resolve(dist, name), 'utf8');
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
    verifyAsset(match[1], name);
  }
}

const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.webmanifest'), 'utf8'));
if (manifest.start_url !== base || manifest.scope !== base) {
  throw new Error(`Manifest start_url/scope must equal ${base}`);
}
for (const icon of manifest.icons || []) verifyAsset(icon.src, 'manifest.webmanifest');

const serviceWorker = readFileSync(resolve(dist, 'sw.js'), 'utf8');
if (!serviceWorker.includes(`${base}index.html`)) {
  throw new Error(`Service worker does not use deployment base ${base}`);
}

console.log(`Verified ${checked.size} local assets and PWA paths for base ${base}`);
