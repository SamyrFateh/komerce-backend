/**
 * GOLDEN CDR — Produits témoins (LOT 0C-eco)
 * ------------------------------------------------------------------
 * Chaque témoin est un couple (produit, contexte) choisi pour exercer
 * un chemin distinct de computeCDR : catégorie × canal, plus les cas
 * limites qui déclenchent fallbacks et warnings.
 *
 * IMPORTANT : les catégories nominales ci-dessous sont les clés canoniques
 * réellement chargées depuis la DB de référence (preflight 2026-08-18) :
 * ceremonie, cosmetiques, electro, enfants, mariage, materiels, phones,
 * vetements. Une seule catégorie inconnue est volontaire :
 * ghost_category_xyz, qui protège explicitement le fallback douane.
 *
 * Le harnais ne prouve la parité que sur ce qu'il couvre : tout chemin
 * non représenté ici n'est pas protégé. Ajouter un témoin quand on
 * touche une branche non couverte.
 *
 * product = { category, cost_kmf, weight_kg }   (ce que lit computeCDR)
 * ctx     = { volume_m3, channel }              (la config est injectée par le harnais)
 */

module.exports = [
  // ── Baseline : même produit, deux canaux (paiement cash vs diaspora) ──
  { id: 'phones__cash', label: 'Téléphone — cash relais',
    product: { category: 'phones', cost_kmf: 150000, weight_kg: 0.4 },
    ctx: { volume_m3: 0.004, channel: 'cash_relais' } },

  { id: 'phones__diaspora', label: 'Téléphone — diaspora',
    product: { category: 'phones', cost_kmf: 150000, weight_kg: 0.4 },
    ctx: { volume_m3: 0.004, channel: 'diaspora' } },

  // ── Couverture nominale : 8/8 catégories canoniques DB ──
  { id: 'vetements__cash', label: 'Vêtement — léger, faible valeur',
    product: { category: 'vetements', cost_kmf: 12000, weight_kg: 0.25 },
    ctx: { volume_m3: 0.003, channel: 'cash_relais' } },

  { id: 'ceremonie__diaspora', label: 'Tenue cérémonie — diaspora',
    product: { category: 'ceremonie', cost_kmf: 45000, weight_kg: 0.7 },
    ctx: { volume_m3: 0.008, channel: 'diaspora' } },

  { id: 'electro__heavy', label: 'Électroménager compact — poids lourd',
    product: { category: 'electro', cost_kmf: 200000, weight_kg: 18 },
    ctx: { volume_m3: 0.08, channel: 'cash_relais' } },

  { id: 'cosmetiques__diaspora', label: 'Cosmétiques — diaspora',
    product: { category: 'cosmetiques', cost_kmf: 25000, weight_kg: 0.3 },
    ctx: { volume_m3: 0.002, channel: 'diaspora' } },

  { id: 'mariage__volume', label: 'Mariage / décoration — gros volume',
    product: { category: 'mariage', cost_kmf: 60000, weight_kg: 3 },
    ctx: { volume_m3: 0.25, channel: 'diaspora' } },

  { id: 'enfants__cash', label: 'Enfants — cash relais',
    product: { category: 'enfants', cost_kmf: 18000, weight_kg: 0.8 },
    ctx: { volume_m3: 0.01, channel: 'cash_relais' } },

  { id: 'materiels__heavy', label: 'Petit matériel — lourd',
    product: { category: 'materiels', cost_kmf: 90000, weight_kg: 8 },
    ctx: { volume_m3: 0.03, channel: 'cash_relais' } },

  // ── Cas limites : fallbacks / warnings / dominantes de calcul ──
  { id: 'unknown_cat__cash', label: 'Catégorie inconnue → fallback douane',
    product: { category: 'ghost_category_xyz', cost_kmf: 50000, weight_kg: 1 },
    ctx: { volume_m3: 0.005, channel: 'cash_relais' } },

  { id: 'zero_cost__cash', label: 'cost_kmf nul → CDR non significatif',
    product: { category: 'phones', cost_kmf: 0, weight_kg: 0.4 },
    ctx: { volume_m3: 0.004, channel: 'cash_relais' } },

  { id: 'high_value__diaspora', label: 'Forte valeur → composants pct dominants',
    product: { category: 'electro', cost_kmf: 1200000, weight_kg: 2 },
    ctx: { volume_m3: 0.02, channel: 'diaspora' } },

  // ── Défaut implicite : volume absent → 0.005 m³ par défaut (à figer) ──
  { id: 'no_volume__cash', label: 'Volume absent → défaut 0.005 m³',
    product: { category: 'phones', cost_kmf: 150000, weight_kg: 0.4 },
    ctx: { channel: 'cash_relais' } },
];
