'use strict';

const fs = require('fs');
const file = 'scripts/code-quality-gate.js';
const src = fs.readFileSync(file, 'utf8');

const before = `          // La concaténation dangereuse : + req. | + params. | + body. dans le même contexte\n          if (/\\+\\s*(req|params|body|query)\\b/.test(line) || /\\$\\{.*?(req|params|body|query)/.test(line)) {\n            hits.push({ line: i + 1, col: 1, message: 'SQL avec concaténation directe de req/params/body — utiliser $1, $2, ...' });\n          }`;

const after = `          // La concaténation dangereuse est une donnée de requête utilisée\n          // DIRECTEMENT comme fragment SQL. Inspecter chaque interpolation\n          // séparément évite le faux positif historique où une interpolation\n          // serveur était suivie du second argument params de db.query.\n          const interpolations = [...line.matchAll(/\\$\\{([^}]*)\\}/g)].map(m => m[1]);\n          const hasDirectRequestInterpolation = interpolations.some(expr =>\n            /\\b(req|params|body|query)(?:\\.|\\[|\\b)/.test(expr)\n          );\n          const hasDirectRequestConcat = /\\+\\s*(req|params|body|query)(?:\\.|\\[|\\b)/.test(line);\n          if (hasDirectRequestConcat || hasDirectRequestInterpolation) {\n            hits.push({ line: i + 1, col: 1, message: 'SQL avec concaténation directe de req/params/body — utiliser $1, $2, ...' });\n          }`;

if (!src.includes(before)) {
  throw new Error('N2 SQL parser target not found');
}

fs.writeFileSync(file, src.replace(before, after));
console.log('Debt Zero: N2 SQL interpolation scanner narrowed to interpolation expressions');
