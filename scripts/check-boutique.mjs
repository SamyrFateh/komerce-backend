import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(.:\/)/, '$1'));
const files = {
  index: resolve(root, 'public/boutique/index.html'),
  css: resolve(root, 'public/boutique/css/boutique.css'),
  catalog: resolve(root, 'public/boutique/js/b-catalog.js'),
  main: resolve(root, 'public/boutique/js/main.js'),
};

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const read = (file) => readFileSync(file, 'utf8');

for (const [name, file] of Object.entries(files)) {
  check(existsSync(file), `Missing ${name}: ${file}`);
}

const index = existsSync(files.index) ? read(files.index) : '';
const css = existsSync(files.css) ? read(files.css) : '';
const catalog = existsSync(files.catalog) ? read(files.catalog) : '';

const charsetAt = index.indexOf('<meta charset="UTF-8">');
const firstScriptAt = index.indexOf('<script');
check(charsetAt !== -1, 'index.html must declare UTF-8 charset.');
check(firstScriptAt === -1 || charsetAt < firstScriptAt, 'UTF-8 charset must appear before scripts in <head>.');
check(!/\sstyle=/.test(index), 'index.html should not contain inline style attributes.');
check(index.includes('<link rel="preload" as="image" href="/images/hero_banner.png"'), 'Hero preload must target the rendered hero image.');
check(/<img class="k-hero-img"[^>]+width="1600"[^>]+height="896"/.test(index), 'Hero image should keep explicit width and height.');
check(!/@import\s+url\(/.test(css), 'boutique.css should not import remote fonts; load them from index.html.');

for (const asset of [
  'public/images/hero_banner.png',
  'public/images/avatar_seule.png',
  'public/images/panier_tresse_vert.png',
  'public/boutique/js/komerce-api.js',
  'public/boutique/js/main.js',
]) {
  check(existsSync(resolve(root, asset)), `Missing boutique asset: ${asset}`);
}

check(!/\$\{p\.name\}/.test(catalog), 'b-catalog.js should sanitize product names before HTML injection.');
check(!/alt="\$\{p\.name\}/.test(catalog), 'b-catalog.js should sanitize product names in image alt attributes.');
check(!/p\.description\.slice\(/.test(catalog), 'b-catalog.js should sanitize product descriptions before slicing/injection.');

for (const jsFile of [files.catalog, files.main]) {
  const result = spawnSync(process.execPath, ['--check', jsFile], { encoding: 'utf8' });
  if (result.error?.code === 'EPERM') {
    console.warn(`Skipping syntax check for ${jsFile}: child process execution is blocked in this environment.`);
    continue;
  }
  const output = result.stderr || result.stdout || result.error?.message || 'unknown error';
  check(result.status === 0, `Syntax check failed for ${jsFile}: ${output}`.trim());
}

if (failures.length) {
  console.error('Boutique checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Boutique checks passed.');