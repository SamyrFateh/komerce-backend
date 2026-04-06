/**
 * KOMERCE — Moteur de Pricing v6.4
 * Formule officielle spec v6.4 — 16 étapes
 * Triple devise : AED (Dubai) · KMF (Comores) · EUR (France)
 *
 * v6.5 : Migration vers getRuleNumber() — tous les paramètres pricing
 *        sont configurables via business_rules (admin UI).
 *        Les fonctions sont désormais async.
 */

const { getRuleNumber } = require('./rules');

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

async function getDefaultRates() {
  return {
    eur_kmf: await getRuleNumber('EUR_KMF_FALLBACK', 492),
    aed_kmf: await getRuleNumber('AED_KMF_FALLBACK', 138),
    fret_eur_m3: 180,
  };
}

async function calcFret(l, w, h, rates) {
  if (!rates) rates = await getDefaultRates();
  return Math.round((l * w * h / 1_000_000) * (rates.fret_eur_m3 || 180) * rates.eur_kmf);
}

async function calcPrix({ prix_aed, category = 'electronique', source = 'S1', qty = 1,
                    dims = null, is_diaspora = false, relais_type = 'standard',
                    rates = null }) {
  if (!rates) rates = await getDefaultRates();
  const taxes   = TAXES[category] || TAXES.electronique;
  const catDims = dims || DIMS[category] || DIMS.electronique;

  const commissionAgentPct   = await getRuleNumber('COMMISSION_AGENT_PCT', 5) / 100;
  const transportDxbKmf      = await getRuleNumber('TRANSPORT_DXB_KMF', 500);
  const transitairePct       = await getRuleNumber('TRANSITAIRE_PCT', 2) / 100;
  const transitaireFixedKmf  = await getRuleNumber('TRANSITAIRE_FIXED_KMF', 450);
  const portuairesKmf        = await getRuleNumber('PORTUAIRES_KMF', 1200);
  const transportRelaisKmf   = await getRuleNumber('TRANSPORT_RELAIS_KMF', 840);
  const commRelaisStd        = await getRuleNumber('COMMISSION_RELAIS_STANDARD_KMF', 500);
  const commRelaisShowroom   = await getRuleNumber('COMMISSION_RELAIS_SHOWROOM_KMF', 750);
  const fraisStripePct       = await getRuleNumber('FRAIS_STRIPE_PCT', 2.5) / 100;
  const margePct             = await getRuleNumber('MARGE_PCT', 12) / 100;

  const achat_kmf        = Math.round(prix_aed * rates.aed_kmf * qty);
  const commission_agent = source === 'S1' ? Math.round(achat_kmf * commissionAgentPct) : 0;
  const emballage        = Math.round(3 * rates.aed_kmf);
  const transport_dxb    = transportDxbKmf;
  const sub_dxb          = achat_kmf + commission_agent + emballage + transport_dxb;
  const fret_kmf         = await calcFret(catDims.l, catDims.w, catDims.h, rates) * qty;
  const cif              = sub_dxb + fret_kmf;
  const transitaire      = Math.round(cif * transitairePct) + transitaireFixedKmf;
  const portuaires       = portuairesKmf;
  const douane           = Math.round(cif * taxes.douane);
  const tva              = Math.round(cif * taxes.tva);
  const taxe_add         = Math.round(cif * taxes.taxe_add);
  const transport_relais = transportRelaisKmf;
  const commission_relais= relais_type === 'showroom' ? commRelaisShowroom : commRelaisStd;
  const sub1             = cif + transitaire + portuaires + douane + tva + taxe_add + transport_relais + commission_relais;
  const frais_stripe     = is_diaspora ? Math.round(sub1 * fraisStripePct) : 0;
  const sub2             = sub1 + frais_stripe;
  const marge            = Math.round(sub2 * margePct);
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

async function calcPrixTenue({ prix_tissu_aed, metrage, cout_confection_aed,
                         qty = 1, is_diaspora = false, relais_type = 'standard',
                         rates = null }) {
  if (!rates) rates = await getDefaultRates();
  return calcPrix({
    prix_aed: prix_tissu_aed * metrage + cout_confection_aed,
    category: 'mariage', source: 'S1', qty, is_diaspora, relais_type, rates,
  });
}

module.exports = { calcPrix, calcPrixTenue, calcFret, DEFAULT_RATES, DIMS, TAXES, getDefaultRates };
