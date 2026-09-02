/**
 * data.js — Données mockées pour le spike.
 *
 * Structure identique aux contrats réels :
 * - produit catalogue : { id, name, price, image, category }
 * - carte discovery : { kind, title, subtitle, cta_label, price, provider_name, zone }
 * - bloc merchandising : { id, title, blocks[] } (2ᵉ bloc transversal fictif)
 *
 * Aucune donnée n'est fetchée : le spike teste le shell, pas les données.
 * Les catégories et volumes reproduisent une home réelle (catégories courtes
 * ET longues pour tester le comportement de scroll).
 */
'use strict';

export const CATEGORIES = [
  { id: 'tout',        label: 'Tout',        count: 24 },
  { id: 'mode',        label: 'Mode',        count: 18 },
  { id: 'maison',      label: 'Maison',      count: 12 },
  { id: 'tech',        label: 'Tech',        count: 9  },
  { id: 'bricolage',   label: 'Bricolage',   count: 6  },
  { id: 'beaute',      label: 'Beauté',      count: 15 },
  { id: 'supermarche', label: 'Supermarché', count: 21 },
  { id: 'sport',       label: 'Sport',       count: 7  },
  { id: 'auto',        label: 'Auto',        count: 4  },
];

function makeProducts(category, n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      id: `${category}-${i}`,
      name: `Produit ${category} ${i}`,
      price: 5000 + (i * 1500) % 40000,
      image: '',
      category,
    });
  }
  return out;
}

export const PRODUCTS_BY_CATEGORY = Object.fromEntries(
  CATEGORIES.map(c => [c.id, makeProducts(c.id, c.count)])
);

// Discovery « Près de vous » — 3 kinds, structurellement identiques au vrai contrat
export const DISCOVERY_CARDS = [
  { kind: 'product',        title: 'Chaussure de football Elite Pro', subtitle: 'Disponible maintenant',      cta_label: 'Acheter',  price: 19900, provider_name: null,             zone: null },
  { kind: 'physical_offer', title: 'Samboussas au bœuf',              subtitle: 'Préparation sur commande',   cta_label: 'Commander', price: null,  provider_name: 'Chez Fati',      zone: 'Moroni' },
  { kind: 'service',        title: 'Installation climatiseur',         subtitle: 'Sur demande',                cta_label: 'Demander',  price: null,  provider_name: 'Bâtir Anjouan',  zone: 'Mutsamudu' },
  { kind: 'product',        title: 'Savon doux Premium',               subtitle: 'Disponible maintenant',      cta_label: 'Acheter',  price: 2500,  provider_name: null,             zone: null },
];

// 2ᵉ bloc transversal fictif — prouve que le shell accepte un futur flux composé
// (merchandising pays / promo / recommandations). Structure volontairement
// différente de Discovery pour tester la généricité du flux.
export const MERCH_BLOCK = {
  id: 'merch-comores',
  title: 'Le meilleur des Comores',
  blocks: [
    { label: 'Épices & vanille', hint: 'Produits du terroir' },
    { label: 'Artisanat local',  hint: 'Fait main' },
    { label: 'Promos du moment',  hint: '-30% cette semaine' },
  ],
};

export function formatPrice(p) {
  if (p == null) return '';
  return new Intl.NumberFormat('fr-FR').format(p) + ' KMF';
}
