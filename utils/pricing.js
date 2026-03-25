/**
 * KOMERCE — Moteur de Pricing v6.4
 * Formule officielle spec v6.4 — 16 étapes
 * Triple devise : AED (Dubai) · KMF (Comores) · EUR (France)
 */

const DEFAULT_RATES = { eur_kmf: 492, aed_kmf: 138, fret_eur_m3: 180 };

// Dimensions standard par catégorie (cm) L×l×H — 5 catégories v2
const DIMS = {
  electronique: { l: 17, w: 12, h: 11 },
  maison:       { l: 35, w: 30, h: 16 },
  mariage:      { l: 30, w: 25, h: 11 },
  mode_beaute:  { l: 22, w: 18, h: 10 },
  enfants:      { l: 25, w: 20, h:  9 },
};

// Taux douaniers par catégorie — à valider avec transitaire Mutsamudu
const TAXES = {
  electronique: { douane: 0.10, tva: 0.10, taxe_add: 0.00 },
  maison:       { douane: 0.15, tva: 0.10, taxe_add: 0.00 },
  mariage:      { douane: 0.20, tva: 0.10, taxe_add: 0.025 },
  mode_beaute:  { douane: 0.20, tva: 0.10, taxe_add: 0.01 },
  enfants:      { douane: 0.10, tva: 0.10, taxe_add: 0.00 },
};

function calcFret(l, w, h, rates = DEFAULT_RATES) {
  return Math.round((l * w * h / 1_000_000) * (rates.fret_eur_m3 || 180) * rates.eur_kmf);
}

function calcPrix({ prix_aed, category = 'electronique', source = 'S1', qty = 1,
                    dims = null, is_diaspora = false, relais_type = 'standard',
                    rates = DEFAULT_RATES }) {
  const taxes   = TAXES[category] || TAXES.electronique;
  const catDims = dims || DIMS[category] || DIMS.electronique;

  const achat_kmf        = Math.round(prix_aed * rates.aed_kmf * qty);
  const commission_agent = source === 'S1' ? Math.round(achat_kmf * 0.05) : 0;
  const emballage        = Math.round(3 * rates.aed_kmf);
  const transport_dxb    = 500;
  const sub_dxb          = achat_kmf + commission_agent + emballage + transport_dxb;
  const fret_kmf         = calcFret(catDims.l, catDims.w, catDims.h, rates) * qty;
  const cif              = sub_dxb + fret_kmf;
  const transitaire      = Math.round(cif * 0.02) + 450;
  const portuaires       = 1200;
  const douane           = Math.round(cif * taxes.douane);
  const tva              = Math.round(cif * taxes.tva);
  const taxe_add         = Math.round(cif * taxes.taxe_add);
  const transport_relais = 840;
  const commission_relais= relais_type === 'showroom' ? 750 : 500;
  const sub1             = cif + transitaire + portuaires + douane + tva + taxe_add + transport_relais + commission_relais;
  const frais_stripe     = is_diaspora ? Math.round(sub1 * 0.025) : 0;
  const sub2             = sub1 + frais_stripe;
  const marge            = Math.round(sub2 * 0.12);
  const prix_final_kmf   = sub2 + marge;
  const prix_final_eur   = Math.round(prix_final_kmf / rates.eur_kmf);

  return {
    prix_final_kmf, prix_final_eur,
    price_kmf: prix_final_kmf,
    cost_transport_kmf: fret_kmf + transport_dxb + transport_relais,
    cost_douane_kmf:    douane + tva + taxe_add + transitaire + portuaires,
    detail: { achat_kmf, commission_agent, emballage, transport_dxb, sub_dxb,
              fret_kmf, cif, transitaire, portuaires, douane, tva, taxe_add,
              transport_relais, commission_relais, frais_stripe, marge },
    meta: { source, category, qty, is_diaspora, relais_type,
            rates_used: { aed_kmf: rates.aed_kmf, eur_kmf: rates.eur_kmf } },
  };
}

function calcPrixTenue({ prix_tissu_aed, metrage, cout_confection_aed,
                         qty = 1, is_diaspora = false, relais_type = 'standard',
                         rates = DEFAULT_RATES }) {
  return calcPrix({
    prix_aed: prix_tissu_aed * metrage + cout_confection_aed,
    category: 'mariage', source: 'S1', qty, is_diaspora, relais_type, rates,
  });
}

module.exports = { calcPrix, calcPrixTenue, calcFret, DEFAULT_RATES, DIMS, TAXES };
