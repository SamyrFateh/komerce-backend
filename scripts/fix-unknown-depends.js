'use strict';
/**
 * Applique les corrections issues de scripts/_unknown-classification.json :
 *  - champ avoidable (require/import statique ou appelant trouvé)  -> liste resolue
 *  - champ non-avoidable mais 0 resolution trouvee (et non-tombstone) -> "none"
 *    (fait verifie par recherche exhaustive sur les SCAN_ROOTS, pas une supposition)
 *  - tombstone (isTombstone=true)                                  -> "none" / "none"
 *
 * N'ecrit RIEN pour un champ deja rempli (non @unknown).
 * Idempotent : relancer sans effet si deja applique.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const classPath = path.join(ROOT, 'scripts', '_unknown-classification.json');
const data = JSON.parse(fs.readFileSync(classPath, 'utf8'));

let filesTouched = 0;
let fieldsFixed = { depends: 0, usedBy: 0 };

for (const r of data.results) {
  const full = path.join(ROOT, r.file);
  let txt = fs.readFileSync(full, 'utf8');
  let changed = false;

  if (r.dependsUnknown) {
    const value = (r.isTombstone || !r.dependsAvoidable)
      ? 'none'
      : [...new Set(r.staticInternalRequires)].sort().join(', ');
    const re = /^(\s*\*\s+@depends\s+)@unknown(\s*)$/m;
    if (re.test(txt)) {
      txt = txt.replace(re, (m, pre, post) => `${pre}${value}${post}`);
      changed = true;
      fieldsFixed.depends++;
    }
  }

  if (r.usedByUnknown) {
    const value = (r.isTombstone || !r.usedByAvoidable)
      ? 'none'
      : [...new Set(r.usedByHits)].sort().join(', ');
    const re = /^(\s*\*\s+@used-by\s+)@unknown(\s*)$/m;
    if (re.test(txt)) {
      txt = txt.replace(re, (m, pre, post) => `${pre}${value}${post}`);
      changed = true;
      fieldsFixed.usedBy++;
    }
  }

  if (changed) {
    fs.writeFileSync(full, txt);
    filesTouched++;
  }
}

console.log(`Fichiers modifiés : ${filesTouched}`);
console.log(`  @depends corrigés : ${fieldsFixed.depends}`);
console.log(`  @used-by corrigés : ${fieldsFixed.usedBy}`);
