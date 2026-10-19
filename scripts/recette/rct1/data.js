/**
 * @komerce-arch-lite
 * @role          rct1-data
 * @domain        economic-engine
 * @layer         script
 * @owner         backend-core
 * @purpose       Donnees declaratives RCT1 : acteurs, relais, produits, references stables.
 * @impact-areas  staging-only, economic-engine, recette
 */
'use strict';

// Natures : T = donnee de test. Aucune valeur n'est un fait reel de l'entreprise.
const EMAIL_DOMAIN = 'recette.komerce.invalid';
const ACTORS = Object.freeze([
  { key: 'client-km', role: 'client', market: 'KM', full_name: 'RCT1 Client KM', phone: '+2690000101' },
  { key: 'agent-relais-km', role: 'agent_relais', market: 'KM', full_name: 'RCT1 Agent relais KM', phone: '+2690000102', relay: 'RCT1-REL-KM' },
  { key: 'operator-km', role: 'market_operator', market: 'KM', scope_role: 'manager', full_name: 'RCT1 Operateur KM', phone: '+2690000103' },
  { key: 'agent-hub', role: 'agent_hub', market: 'KM', full_name: 'RCT1 Agent hub', phone: '+2690000104' },
  { key: 'client-wm', role: 'client', market: 'WM', full_name: 'RCT1 Client WM', phone: '+2370000101' },
  { key: 'operator-wm', role: 'market_operator', market: 'WM', scope_role: 'manager', full_name: 'RCT1 Operateur WM', phone: '+2370000103' },
  { key: 'operator-cm', role: 'market_operator', market: 'CM', scope_role: 'manager', full_name: 'RCT1 Operateur CM', phone: '+2370000203', lead_of: 'CM' },
  { key: 'operator-cg', role: 'market_operator', market: 'CG', scope_role: 'manager', full_name: 'RCT1 Operateur CG', phone: '+2420000203', lead_of: 'CG' },
  { key: 'client-cm', role: 'client', market: 'CM', full_name: 'RCT1 Client CM', phone: '+2370000201' },
].map(a => Object.freeze({ ...a, email: `rct1.${a.key}@${EMAIL_DOMAIN}` })));

const RELAYS = Object.freeze([
  { name: 'RCT1-REL-KM', market: 'KM', phone: '+2690000110', address: 'RCT1 recette - point relais fictif Moroni', island: 'Grande Comore', island_code: 'MORONI' },
]);

// Marches CM/CG (decision metier 2026-10-20) : provisioning canonique uniquement. Valeurs T « FICTIF recette » :
// plafonds = defaut central cash (CASH_CUSTODY_DEFAULT_HOLDING_KMF), prestataire mtn_momo (Orange Cameroun mis de cote),
// politique cash = defaut du service (SINGLE), relais = fixtures documentees (seed-staging-market-relays). Aucun prix ni parametre commercial invente.
const FICTIF_LIMIT = 1000000;
const MARKET_PROVISIONING = Object.freeze({
  CM: { code: 'CM', name: 'Cameroun', currency: 'XAF', minor_unit: 0, lead: 'operator-cm',
    relay: { name: 'Relais Komerce Yaoundé Centre', phone: '+237600000001', address: 'Yaoundé Centre, Cameroun', zone: 'Yaoundé', latitude: 3.8480, longitude: 11.5021 } },
  CG: { code: 'CG', name: 'Congo', currency: 'XAF', minor_unit: 0, lead: 'operator-cg',
    relay: { name: 'Relais Komerce Brazzaville Centre', phone: '+242060000001', address: 'Brazzaville Centre, République du Congo', zone: 'Brazzaville', latitude: -4.2634, longitude: 15.2429 } },
});
const MARKET_PROVISIONING_PARAMS = Object.freeze({
  financial_limits: Object.freeze({ 'execution.cash.confirm': FICTIF_LIMIT, 'finance.act': FICTIF_LIMIT, 'settlement.receive': FICTIF_LIMIT, 'cash.custody.receive': FICTIF_LIMIT }),
  payment_provider: Object.freeze({ provider: 'mtn_momo' }),
  cash_policy: Object.freeze({ cash_enabled: true, confirmation_mode: 'SINGLE' }),
});
// Commande CM (K : isolation + XAF). P4 a 20 000 XAF au CM (cadrage section 4) = 15 000 KMF a la parite documentee. Aucun prix CG documente : pas de commande CG.
const MARKET_ORDERS = Object.freeze([
  { ref: 'RCT1-CM1', market: 'CM', client: 'client-cm', lines: [{ product: 'P4', qty: 1 }], expected_product_total_kmf: 15000, expected_product_display: { amount: 20000, currency: 'XAF' } },
]);

const DESCRIPTION_SUFFIX = ' Produit de recette RCT1, donnee de test sans valeur commerciale reelle.';
// Hypothese initiale P3 : 6 000 KMF. L'arbitrage metier (ex. 7 000) se passe par RCT1_P3_PRICE_KMF (corps d'issue P3_PRICE=...), jamais par SQL.
const P3_PRICE_KMF = Number(process.env.RCT1_P3_PRICE_KMF) > 0 ? Math.round(Number(process.env.RCT1_P3_PRICE_KMF)) : 6000;
const PRODUCTS = Object.freeze({
  P1: { ref: 'RCT1-P1', komerce_category: 'mariage', name: 'Vaisselle de mariage : theiere en fonte (recette RCT1)', category: 'Maison', subcategory: 'Cuisine', price_kmf: 15000, cost_kmf: 6000, stock: 100, weight_kg: 1, origin: 'IMPORT' },
  P3: { ref: 'RCT1-P3', komerce_category: 'mariage', name: 'Panier decor tisse local (recette RCT1)', category: 'Maison', subcategory: 'Rangement', price_kmf: 6000, cost_kmf: 3000, stock: 100, weight_kg: 1, origin: 'LOCAL_STOCK', local_stock_qty: 5, stock_market: 'KM' },
  P2: { ref: 'RCT1-P2', komerce_category: 'autre', name: 'Lampe a huile importee (recette RCT1)', category: 'Maison', subcategory: 'Cuisine', price_kmf: 25000, cost_kmf: 12000, stock: 100, weight_kg: 1, origin: 'IMPORT' },
  P4: { ref: 'RCT1-P4', komerce_category: 'mariage', name: 'Set de verres vaisselle importe (recette RCT1)', category: 'Maison', subcategory: 'Cuisine', price_kmf: 10000, cost_kmf: 5000, stock: 100, weight_kg: 1, origin: 'IMPORT' },
  P5: { ref: 'RCT1-P5', komerce_category: 'mariage', name: 'Vaisselle : service a the importe, prix EUR (recette RCT1)', category: 'Maison', subcategory: 'Cuisine', price_kmf: 49197, price_eur: 100, cost_kmf: 20000, stock: 100, weight_kg: 1, origin: 'IMPORT',
    expected_conversion: { KMF: 49197, XAF: 65596 } },
});
for (const p of Object.values(PRODUCTS)) p.description = `${p.name}.${DESCRIPTION_SUFFIX}`;

// Commandes via checkout canonique. expected_product_total_kmf = attendu independant (hors transport).
const ORDERS = Object.freeze([
  { ref: 'RCT1-E1', client: 'client-km', relay: 'RCT1-REL-KM', lines: [{ product: 'P1', qty: 1 }], expected_product_total_kmf: 15000 },
  { ref: 'RCT1-F', client: 'client-km', relay: 'RCT1-REL-KM', lines: [{ product: 'P1', qty: 1 }], expected_product_total_kmf: 15000 },
  { ref: 'RCT1-C', client: 'client-km', relay: 'RCT1-REL-KM', lines: [{ product: 'P1', qty: 1 }], expected_product_total_kmf: 15000 },
  { ref: 'RCT1-C2', client: 'client-km', relay: 'RCT1-REL-KM', lines: [{ product: 'P1', qty: 1 }], expected_product_total_kmf: 15000 },
  // I3 : une commande de 2 lignes IMPORT dont le colis est scinde en 2 colis / 2 expeditions (total produit attendu 40 000).
  { ref: 'RCT1-I3', client: 'client-km', relay: 'RCT1-REL-KM', lines: [{ product: 'P1', qty: 1 }, { product: 'P2', qty: 1 }], expected_product_total_kmf: 40000, split: true },
  { ref: 'RCT1-G', client: 'client-km', relay: 'RCT1-REL-KM', lines: [{ product: 'P3', qty: 1 }], expected_product_total_kmf: P3_PRICE_KMF },
]);

// Expeditions customs_shipments (fait simule S). freight/forwarder en KMF ; customs_paid null = declaree sans montant (inconnu).
const SHIPMENTS = Object.freeze([
  { ref: 'RCT1-SH2', orders: ['RCT1-E1', 'RCT1-F'], freight_kmf: 4000, customs_paid_kmf: 0, forwarder_fee_kmf: 1000, cif_value_kmf: 12000 },
  { ref: 'RCT1-SH1', orders: ['RCT1-C', 'RCT1-C2'], freight_kmf: 4000, customs_paid_kmf: null, forwarder_fee_kmf: null, cif_value_kmf: 12000 },
]);
// I3 : chaque ligne part dans son propre colis et sa propre expedition ; fret simule S, douane 0 confirmee.
const SPLIT = Object.freeze({
  order: 'RCT1-I3',
  shipments: Object.freeze([
    { ref: 'RCT1-SH3', product: 'P1', freight_kmf: 2000, cif_value_kmf: 12000 },
    { ref: 'RCT1-SH4', product: 'P2', freight_kmf: 3000, cif_value_kmf: 24000 },
  ]),
});
// Couts manuels (L1) par commande : faits simules S, provenance FICTIF obligatoire.
const MANUAL_COSTS = Object.freeze({
  'RCT1-E1': { sourcing: 300, packaging: 200, hub: 400, local_distribution: 300 },
  'RCT1-F': { sourcing: 300, packaging: 200, hub: 400, local_distribution: 300 },
  'RCT1-C': { sourcing: 300, packaging: 200, hub: 400 },
  'RCT1-G': { sourcing: 150, packaging: 100, local_distribution: 300 },
});
// Attendus independants (hors transport vendu) : marge = total - couts.
const EXPECTED_MARGIN = Object.freeze({ 'RCT1-E1': { revenue_kmf: 15065, cost_kmf: 10300, margin_kmf: 4765 }, 'RCT1-G': { revenue_kmf: P3_PRICE_KMF, cost_kmf: 4150, margin_kmf: P3_PRICE_KMF - 4150 } });
const RELAY_COMMISSION_KMF = 600;

module.exports = { MARKET_PROVISIONING, MARKET_PROVISIONING_PARAMS, MARKET_ORDERS, P3_PRICE_KMF, SPLIT, SHIPMENTS, MANUAL_COSTS, EXPECTED_MARGIN, RELAY_COMMISSION_KMF, ORDERS, EMAIL_DOMAIN, ACTORS, RELAYS, PRODUCTS };
