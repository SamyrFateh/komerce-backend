'use strict';
/* Reproduction isolée du bug « plus aucune carte après une recherche ».
   _balancedPick + _normalizeCat sont recopiés à l'identique depuis
   js/b-catalog.js (L503-536) — aucune dépendance DOM requise. */

const _normalizeCat = (c) => c || 'Autres';
const _shuffle = (a) => a; // déterministe pour le test

function _balancedPick(list, pageSize, maxPerCat) {
  const MIN_PER_SECTION = 4;
  const byCat = new Map();
  const order = [];
  for (const p of list) {
    const cat = _normalizeCat(p.category) || 'Autres';
    if (!byCat.has(cat)) { byCat.set(cat, []); order.push(cat); }
    byCat.get(cat).push(p);
  }
  const rich = [], thin = [];
  for (const cat of order) {
    const prods = byCat.get(cat);
    if (prods.length >= MIN_PER_SECTION) rich.push({ cat, prods });
    else thin.push(...prods);
  }
  if (thin.length >= MIN_PER_SECTION) rich.push({ cat: 'Autres', prods: thin });
  const nCats = rich.length || 1;
  const basePerCat = Math.floor(pageSize / nCats);
  let perCat = basePerCat >= 2 ? (basePerCat % 2 === 0 ? basePerCat : basePerCat - 1) : 2;
  if (typeof maxPerCat === 'number' && maxPerCat > 0) perCat = Math.min(perCat, maxPerCat);
  const flat = [];
  for (const section of rich) {
    const shuffled = _shuffle([...section.prods]);
    const take = Math.min(perCat, shuffled.length);
    const count = take >= 2 ? (take % 2 === 0 ? take : take - 1) : 0;
    for (let i = 0; i < count; i++) flat.push(shuffled[i]);
  }
  return flat;
}

const mk = (n, cat) => Array.from({ length: n }, (_, i) => ({ id: `${cat}-${i}`, category: cat }));
const CATALOGUE = [...mk(40, 'Mode'), ...mk(30, 'Tech'), ...mk(25, 'Maison')];

// ── Simulation du cycle réel ────────────────────────────────────────────
function renderGrid(state, inputValue) {
  const searching = inputValue.trim().length >= 2;
  return searching ? state.filtered : _balancedPick(state.filtered, 160, 16);
}

let fail = 0;
const check = (label, got, expectPositive) => {
  const ok = expectPositive ? got > 0 : got === 0;
  console.log(`   ${ok ? '✅' : '❌'} ${label} → ${got} carte(s)`);
  if (!ok) fail++;
};

console.log('\n=== AVANT correctif (comportement reproduit) ===');
{
  const state = { filtered: [...CATALOGUE], products: CATALOGUE, activeCat: 'all' };
  check('1. home au chargement', renderGrid(state, '').length, true);

  // 2. l'utilisateur tape « Mode 3 » → state.filtered devient étroit
  state.filtered = CATALOGUE.filter((p) => p.id.includes('Mode-3'));
  check('2. pendant la recherche (input rempli)', renderGrid(state, 'Mode 3').length, true);

  // 3. clic sur un résultat : input vidé, state.filtered PAS restauré
  const input = '';
  check('3. rendu suivant (input vidé, filtered étroit)', renderGrid(state, input).length, true);
}

console.log('\n=== APRÈS correctif (_resetSearchFilter appelé au clic) ===');
{
  const state = { filtered: [...CATALOGUE], products: CATALOGUE, activeCat: 'all' };
  state.filtered = CATALOGUE.filter((p) => p.id.includes('Mode-3'));
  // clic → _resetSearchFilter() restaure filtered depuis products
  state.filtered = [...state.products];
  check('3bis. rendu suivant après restauration', renderGrid(state, '').length, true);
}

console.log(`\n${fail === 1 ? '✅ Bug reproduit AVANT (1 échec attendu) et corrigé APRÈS'
  : `⚠️  ${fail} échec(s) — résultat inattendu`}`);
