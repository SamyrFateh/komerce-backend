#!/usr/bin/env node
'use strict';

/**
 * feature-memo.js — Génère le DOSSIER d'une feature depuis son manifeste + le code.
 *
 *   Corollaire de feature-audit.js : la même source (le manifeste) et la même
 *   analyse produisent, au lieu d'un verdict, une DESCRIPTION complète — logique,
 *   intégration, couture avec le contexte, test de régression, propriétés.
 *   L'audit demande « respecte-t-elle ses contrats ? » ; le mémo demande
 *   « qu'est-ce que c'est, et quelles sont ses propriétés ? ». Deux projections.
 *
 *   Ce qui est AUTO (vérifiable) : identité, périmètre, fichiers, sélecteurs/
 *   exports dérivés du code, couplage dérivé, contrats → assertions de régression,
 *   dette mesurée. Ce qui reste ASSISTÉ (à compléter) : la prose du « pourquoi »
 *   et les happy-paths e2e — marqués ⟦À COMPLÉTER⟧.
 *
 * Usage : node scripts/feature-memo.js --feature modal-product [--root DIR]
 */
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i>=0?args[i+1]:null; };
const ROOT = path.resolve(val('--root') || process.cwd());
const NAME = val('--feature');
if (!NAME) { console.error('--feature requis'); process.exit(2); }

// ── Charger le manifeste (toutes couches) ───────────────────────────────────
let M = null;
for (const dir of ['features', 'public/boutique/features']) {
  const f = path.join(ROOT, dir, `${NAME}.feature.js`);
  if (fs.existsSync(f)) { M = require(f); M.__base = path.dirname(f); break; }
}
if (!M) { console.error(`manifeste introuvable: ${NAME}`); process.exit(2); }

const owned = [];
for (const layer of Object.keys(M.files||{})) for (const rel of M.files[layer])
  owned.push({ layer, rel, abs: path.join(M.__base, rel), exists: fs.existsSync(path.join(M.__base, rel)) });

const read = f => fs.readFileSync(f,'utf8');
const present = owned.filter(f => f.exists);

// ── Introspection légère du code possédé ────────────────────────────────────
function cssFacts(files) {
  const sels = new Set(), bps = new Set();
  for (const f of files) { const c = read(f.abs).replace(/\/\*[\s\S]*?\*\//g, '');
    (c.match(/^[.#][\w-][^{,]*(?=[\s,{])/gm)||[]).forEach(s=>sels.add(s.trim().split(/\s/)[0]));
    (c.match(/@media[^{\n]+/g)||[]).forEach(m=>bps.add(m.replace(/\s+/g,' ').trim()));
  }
  return { selectors:[...sels].slice(0,12), breakpoints:[...bps] };
}
function jsFacts(files) {
  const ex = [];
  for (const f of files) { const c = read(f.abs);
    (c.match(/(?:export\s+(?:function|const)\s+\w+|module\.exports\s*=\s*{[^}]*})/g)||[]);
    (c.match(/\b(?:function|const)\s+([a-zA-Z_$][\w$]*)\s*[=(]/g)||[]).slice(0,8).forEach(m=>ex.push(m.replace(/\s*[=(]$/,'')));
  }
  return [...new Set(ex)].slice(0,10);
}

// ── Couture dérivée : autres modules JS qui touchent les sélecteurs possédés ──
function derivedCoupling(cssFiles) {
  const jsDir = path.join(M.__base, '..', 'js');
  if (!fs.existsSync(jsDir)) return [];
  const prefixes = [...new Set(cssFiles.flatMap(f =>
    (read(f.abs).match(/\.(k-[\w-]+)/g)||[]).map(s=>s.slice(1).split('-').slice(0,2).join('-'))))].slice(0,6);
  const hits = [];
  const walk = d => fs.readdirSync(d).forEach(e => {
    const p = path.join(d,e);
    if (fs.statSync(p).isDirectory()) return walk(p);
    if (!e.endsWith('.js')) return;
    const c = read(p); const touched = prefixes.filter(px => c.includes(px));
    if (touched.length) hits.push({ mod: path.relative(M.__base, p), families: touched.length });
  });
  try { walk(jsDir); } catch {}
  return hits.sort((a,b)=>b.families-a.families).slice(0,8);
}

// ── Propriétés live (mini-run des contrats, pour l'état de propreté) ─────────
function liveContracts() {
  const out = [];
  const cs = M.contracts || {};
  if (cs['render-static']) for (const r of cs['render-static']) {
    const a = path.join(M.__base, r.artifact);
    const ok = fs.existsSync(a) && (r.mustContain||[]).every(rx => (rx instanceof RegExp?rx:new RegExp(rx)).test(read(a)));
    out.push(`- **Rendu** \`${r.label||r.artifact}\` → ${fs.existsSync(a)?(ok?'✔ vérifié':'✖ ABSENT'):'– artefact absent'}`);
  }
  if (cs.doctrine) {
    const css = present.filter(f=>/\.css$/.test(f.abs) && !/\/dist\//.test(f.abs));
    let n=0; css.forEach(f=> n+=(read(f.abs).match(/(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\()/g)||[]).length);
    out.push(`- **Doctrine token** → ${n} littéral(aux) couleur (cliquet ${cs.doctrine.max ?? 0})`);
  }
  if (M.contract && M.contract.exposes) out.push(`- **Interface** → ${M.contract.exposes.length} endpoint(s) exposé(s) (vérif câblage dans le repo complet)`);
  return out;
}

// ── Rendu du mémo ───────────────────────────────────────────────────────────
const cssF = present.filter(f=>/\.css$/.test(f.abs));
const jsF  = present.filter(f=>/\.js$/.test(f.abs) && !/\.feature\.js$/.test(f.abs));
const css  = cssF.length ? cssFacts(cssF) : null;
const coupling = cssF.length ? derivedCoupling(cssF) : [];
const L = [];
const p = s => L.push(s);

p(`# Dossier feature — \`${M.name}\``);
p(`> Généré par \`feature-memo.js\` depuis le manifeste + le code réel. ⟦À COMPLÉTER⟧ = prose/comportemental à finir à la main.\n`);
p(`**Domaine** : ${M.domain} · **Statut** : ${M.status} · **Owner** : ${M.owner} · **Couches** : ${Object.keys(M.files||{}).join(', ')||'—'}\n`);

p(`## 1. Service rendu`);
p(M.service || '⟦À COMPLÉTER⟧');
p('');
p(`## 2. Périmètre`);
p(`**Dans** : ${(M.perimeter?.in||['⟦À COMPLÉTER⟧']).map(x=>`\n- ${x}`).join('')}`);
p(`\n**Hors** : ${(M.perimeter?.out||['—']).map(x=>`\n- ${x}`).join('')}`);
p('');
p(`## 3. Logique & fichiers possédés`);
for (const layer of Object.keys(M.files||{})) {
  const fs_ = owned.filter(f=>f.layer===layer);
  p(`**${layer}** (${fs_.filter(f=>f.exists).length}/${fs_.length} présents) : ${fs_.map(f=>`\`${f.rel.replace(/^\.\.\//,'')}\`${f.exists?'':' ⟨absent⟩'}`).join(', ')}`);
}
if (css) { p(`\nSélecteurs CSS (échantillon) : ${css.selectors.map(s=>`\`${s}\``).join(', ')}`);
           p(`Breakpoints : ${css.breakpoints.map(b=>`\`${b}\``).join(', ')||'—'}`); }
if (jsF.length) p(`Fonctions JS (échantillon) : ${jsFacts(jsF).map(f=>`\`${f}\``).join(', ')}`);
p('');
p(`## 4. Couture avec le contexte (intégration)`);
p(`**Expose** : ${(M.contract?.exposes||['—']).map(x=>`\n- ${x}`).join('')}`);
p(`\n**Consomme** : ${(M.contract?.consumes||['—']).map(x=>`\n- ${x}`).join('')}`);
if (coupling.length) { p(`\n**Couplage dérivé** (modules JS qui touchent les mêmes familles — risque de cascade/DOM partagé) :`);
  coupling.forEach(c=>p(`- \`${c.mod}\` (${c.families} famille(s))`)); }
p('');
p(`## 5. Propriétés vérifiées (live)`);
const live = liveContracts(); p(live.length?live.join('\n'):'⟦aucun contrat déclaré — à ajouter⟧');
p('');
p(`## 6. Test de régression`);
p(`Étage statique (au commit) : \`node scripts/feature-audit.js --feature ${M.name} --strict\``);
if (M.contracts?.['render-static']) { p(`\nContrat → assertions générées :`);
  M.contracts['render-static'].forEach(r=> (r.mustContain||[]).forEach(rx=>p(`- doit contenir \`${rx}\` dans \`${r.artifact}\``))); }
p(`\nÉtage dynamique (CI) : \`tests/contracts.spec.js\` — ⟦happy-paths comportementaux à compléter⟧`);
p('');
p(`## 7. Invariants & dette`);
(M.invariants||['⟦À COMPLÉTER⟧']).forEach(i=>p(`- ${i}`));

const OUT = path.join(ROOT, `MEMO_${M.name}.md`);
fs.writeFileSync(OUT, L.join('\n'));
console.log(`✔ Mémo généré : ${path.relative(process.cwd(), OUT)}  (${L.join('\n').length} octets)`);
