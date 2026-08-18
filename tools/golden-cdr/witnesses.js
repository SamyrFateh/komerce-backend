/**
 * GOLDEN CDR — Produits témoins (LOT 0C-eco)
 * ------------------------------------------------------------------
 * Chaque témoin est un couple (produit, contexte) choisi pour exercer
 * un chemin distinct de computeCDR : catégorie × canal, plus les cas
 * limites qui déclenchent fallbacks et warnings.
 *
 * Le harnais ne prouve la parité que sur ce qu'il couvre : tout chemin
 * non représenté ici n'est pas protégé. Ajouter un témoin quand on
 * touche une branche non couverte.
 *
 * product = { category, cost_kmf, weight_kg }   (ce que lit computeCDR)
 * ctx     = { volume_m3, channel }              (le config est injecté par le harnais)
 */

module.exports = [
  // ── Baseline : mêmes produits, deux canaux (route paiement stripe vs cash) ──
  { id: 'phones__cash',      label: 'Téléphone — cash relais',
    product: { category: 'phones', cost_kmf: 150000, weight_kg: 0.4 },
    ctx: { volume_m3: 0.004, channel: 'cash_relais' } },

  { id: 'phones__diaspora',  label: 'Téléphone — diaspora',
    product: { category: 'phones', cost_kmf: 150000, weight_kg: 0.4 },
    ctx: { volume_m3: 0.004, channel: 'diaspora' } },

  // ── Catégories à profils douaniers différents ──
  { id: 'electronics__cash', label: 'Électronique — cash relais',
    product: { category: 'electronics', cost_kmf: 90000, weight_kg: 1.2 },
    ctx: { volume_m3: 0.010, channel: 'cash_relais' } },

  { id: 'cosmetics__diaspora', label: 'Cosmétique — diaspora (douane forte)',
    product: { category: 'cosmetics', cost_kmf: 25000, weight_kg: 0.3 },
    ctx: { volume_m3: 0.002, channel: 'diaspora' } },

  { id: 'fashion__cash',     label: 'Mode — léger, faible valeur',
    product: { category: 'fashion', cost_kmf: 12000, weight_kg: 0.25 },
    ctx: { volume_m3: 0.003, channel: 'cash_relais' } },

  // ── Cas physiques extrêmes : poids lourd vs volume encombrant ──
  { id: 'appliance__heavy',  label: 'Électroménager — poids lourd (kmf_per_kg)',
    product: { category: 'appliance', cost_kmf: 200000, weight_kg: 18 },
    ctx: { volume_m3: 0.08, channel: 'cash_relais' } },

  { id: 'bulky__volume',     label: 'Encombrant — gros volume (fret dominant)',
    product: { category: 'bulky', cost_kmf: 60000, weight_kg: 3 },
    ctx: { volume_m3: 0.25, channel: 'diaspora' } },

  // ── Cas limites : déclenchent les fallbacks / warnings ──
  { id: 'unknown_cat__cash', label: 'Catégorie inconnue → fallback douane',
    product: { category: 'ghost_category_xyz', cost_kmf: 50000, weight_kg: 1 },
    ctx: { volume_m3: 0.005, channel: 'cash_relais' } },

  { id: 'zero_cost__cash',   label: 'cost_kmf nul → CDR non significatif',
    product: { category: 'phones', cost_kmf: 0, weight_kg: 0.4 },
    ctx: { volume_m3: 0.004, channel: 'cash_relais' } },

  { id: 'high_value__diaspora', label: 'Forte valeur → composants pct dominants',
    product: { category: 'electronics', cost_kmf: 1200000, weight_kg: 2 },
    ctx: { volume_m3: 0.02, channel: 'diaspora' } },

  // ── Défauts implicites : volume absent → 0.005 par défaut (à figer) ──
  { id: 'no_volume__cash',   label: 'Volume absent → défaut 0.005 m³',
    product: { category: 'phones', cost_kmf: 150000, weight_kg: 0.4 },
    ctx: { channel: 'cash_relais' } },
];
