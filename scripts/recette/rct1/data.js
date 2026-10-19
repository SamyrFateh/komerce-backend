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
].map(a => Object.freeze({ ...a, email: `rct1.${a.key}@${EMAIL_DOMAIN}` })));

const RELAYS = Object.freeze([
  { name: 'RCT1-REL-KM', market: 'KM', phone: '+2690000110', address: 'RCT1 recette - point relais fictif Moroni', island: 'Grande Comore', island_code: 'MORONI' },
]);

const DESCRIPTION_SUFFIX = ' Produit de recette RCT1, donnee de test sans valeur commerciale reelle.';
const PRODUCTS = Object.freeze({
  P1: { ref: 'RCT1-P1', name: 'Theiere en fonte (recette RCT1)', category: 'Maison', subcategory: 'Cuisine', price_kmf: 15000, cost_kmf: 6000, stock: 100, weight_kg: 1, origin: 'IMPORT' },
  P3: { ref: 'RCT1-P3', name: 'Panier tisse local (recette RCT1)', category: 'Maison', subcategory: 'Rangement', price_kmf: 6000, cost_kmf: 3000, stock: 100, weight_kg: 1, origin: 'LOCAL_STOCK', local_stock_qty: 5, stock_market: 'KM' },
});
for (const p of Object.values(PRODUCTS)) p.description = `${p.name}.${DESCRIPTION_SUFFIX}`;

// Commandes via checkout canonique. expected_product_total_kmf = attendu independant (hors transport).
const ORDERS = Object.freeze([
  { ref: 'RCT1-E1', client: 'client-km', relay: 'RCT1-REL-KM', lines: [{ product: 'P1', qty: 1 }], expected_product_total_kmf: 15000 },
  { ref: 'RCT1-F', client: 'client-km', relay: 'RCT1-REL-KM', lines: [{ product: 'P1', qty: 1 }], expected_product_total_kmf: 15000 },
  { ref: 'RCT1-C', client: 'client-km', relay: 'RCT1-REL-KM', lines: [{ product: 'P1', qty: 1 }], expected_product_total_kmf: 15000 },
  { ref: 'RCT1-C2', client: 'client-km', relay: 'RCT1-REL-KM', lines: [{ product: 'P1', qty: 1 }], expected_product_total_kmf: 15000 },
  { ref: 'RCT1-G', client: 'client-km', relay: 'RCT1-REL-KM', lines: [{ product: 'P3', qty: 1 }], expected_product_total_kmf: 6000 },
]);

// Expeditions customs_shipments (fait simule S). freight/forwarder en KMF ; customs_paid null = declaree sans montant (inconnu).
const SHIPMENTS = Object.freeze([
  { ref: 'RCT1-SH2', orders: ['RCT1-E1', 'RCT1-F'], freight_kmf: 4000, customs_paid_kmf: 0, forwarder_fee_kmf: 1000, cif_value_kmf: 12000 },
  { ref: 'RCT1-SH1', orders: ['RCT1-C', 'RCT1-C2'], freight_kmf: 4000, customs_paid_kmf: null, forwarder_fee_kmf: null, cif_value_kmf: 12000 },
]);
// Couts manuels (L1) par commande : faits simules S, provenance FICTIF obligatoire.
const MANUAL_COSTS = Object.freeze({
  'RCT1-E1': { sourcing: 300, packaging: 200, hub: 400, local_distribution: 300 },
  'RCT1-F': { sourcing: 300, packaging: 200, hub: 400, local_distribution: 300 },
  'RCT1-C': { sourcing: 300, packaging: 200, hub: 400 },
  'RCT1-G': { sourcing: 150, packaging: 100, local_distribution: 300 },
});
// Attendus independants (hors transport vendu) : marge = total - couts.
const EXPECTED_MARGIN = Object.freeze({ 'RCT1-E1': { revenue_kmf: 15065, cost_kmf: 10300, margin_kmf: 4765 }, 'RCT1-G': { revenue_kmf: 6000, cost_kmf: 4150, margin_kmf: 1850 } });
const RELAY_COMMISSION_KMF = 600;

module.exports = { SHIPMENTS, MANUAL_COSTS, EXPECTED_MARGIN, RELAY_COMMISSION_KMF, ORDERS, EMAIL_DOMAIN, ACTORS, RELAYS, PRODUCTS };
