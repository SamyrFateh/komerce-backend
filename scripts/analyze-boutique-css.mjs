import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(.:\/)/, '$1'));
const cssPath = resolve(root, 'public/boutique/css/boutique.css');
const css = readFileSync(cssPath, 'utf8');

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '');
const withoutComments = stripComments(css);
const selectorCounts = new Map();
const selectorPattern = /([^{}@][^{}]*)\{/g;
let match;

while ((match = selectorPattern.exec(withoutComments))) {
  const selectorGroup = match[1]
    .split(',')
    .map((selector) => selector.trim())
    .filter(Boolean);

  for (const selector of selectorGroup) {
    if (!selector || selector.includes(';')) continue;
    if (selector.startsWith('@')) continue;
    if (/^(from|to|\d+(?:\.\d+)?%)$/.test(selector)) continue;
    selectorCounts.set(selector, (selectorCounts.get(selector) || 0) + 1);
  }
}

const duplicates = [...selectorCounts.entries()]
  .filter(([, count]) => count > 1)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

const metrics = {
  file: cssPath,
  bytes: Buffer.byteLength(css),
  lines: css.split(/\r?\n/).length,
  important: (css.match(/!important/g) || []).length,
  mediaQueries: (css.match(/@media/g) || []).length,
  uniqueSelectors: selectorCounts.size,
  duplicatedSelectors: duplicates.length,
};

console.log('Boutique CSS audit');
console.log('==================');
for (const [key, value] of Object.entries(metrics)) {
  console.log(`${key}: ${value}`);
}

if (duplicates.length) {
  console.log('\nMost duplicated selectors:');
  for (const [selector, count] of duplicates.slice(0, 20)) {
    console.log(`${String(count).padStart(3)}  ${selector}`);
  }
}