/**
 * @komerce-arch
 * @role          economic-engine-pricing-parameters-status
 * @domain        economic-engine
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context
 * @outputs       response_or_domain_result
 * @depends       db, services/fx-authority.js
 * @used-by       services/catalog-workspace.js
 * @db-read       finance_config, currency_parities, exchange_rates, cost_components
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, catalog
 * @version       2026-10
 */

'use strict';

const fxAuthority = require('./fx-authority');

/**
 * C2 — état des paramètres économiques AVANT application des valeurs de secours.
 * Lecture seule. Ne valide aucune valeur : une valeur numérique présente ne prouve
 * pas qu'elle est justifiée. Statuts :
 *   documented          valeur avec source documentaire en base (currency_parities)
 *   operator_set        saisie par un opérateur (utilisateur journalisé), source non vérifiée par le système
 *   default_unvalidated valeur de défaut du schéma ou du seed, jamais confirmée
 *   divergent           deux valeurs concurrentes pour la même grandeur
 *   missing             aucune valeur
 */

const CONFIG = Object.freeze({
  href: '/admin/workspaces/pricing',
  label: 'Atelier prix',
  role: 'admin',
});

function item(base) { return { config: CONFIG, ...base }; }

async function getPricingParameterStatus(db) {
  const [fcRes, parRes, relRes] = await Promise.all([
    db.query(`SELECT hub_monthly_cost_aed, commission_relais_standard_kmf,
                     updated_at, updated_by FROM finance_config WHERE id = 1`),
    db.query(`SELECT currency, eur_rate, source_note FROM currency_parities WHERE currency IN ('KMF','XAF')`),
    db.query(`SELECT default_value, updated_by FROM cost_components
               WHERE key = 'commission_relais_kmf' AND is_active = TRUE ORDER BY display_order, key LIMIT 1`).catch(() => ({ rows: [] })),
  ]);
  const fc = fcRes.rows[0] || null;
  const parity = Object.fromEntries(parRes.rows.map(r => [r.currency, r]));
  const rel = relRes.rows[0] || null;
  const operatorSet = Boolean(fc && fc.updated_by);
  const items = [];

  // EUR/KMF : parité fixe = autorité FX unique (plus de taux parallèle dans finance_config)
  if (parity.KMF) {
    const legal = Number(parity.KMF.eur_rate);
    items.push(item({
      key: 'eur_kmf',
      label: 'Taux EUR → KMF',
      value: legal,
      status: 'documented',
      provenance: `Parité fixe (currency_parities KMF) : ${legal} — ${parity.KMF.source_note || 'source non renseignée'}`,
      usage: 'Autorité unique pour les prix EUR, paiements, remboursements et le moteur de prix. Conversion d’un achat réel : à saisir avec la date du taux réellement appliqué.',
      consequence: 'Aucune.',
    }));
  } else {
    items.push(item({ key: 'eur_kmf', label: 'Taux EUR → KMF', value: null, status: 'missing',
      provenance: 'Aucune parité fixe trouvée', usage: 'Prix EUR, paiements, remboursements.',
      consequence: 'Toute conversion est refusée (503 fx_rate_unavailable) : aucune valeur de secours.' }));
  }

  if (parity.XAF) {
    items.push(item({
      key: 'xaf_parity',
      label: 'Parité XAF (Cameroun, Congo)',
      value: Number(parity.XAF.eur_rate),
      status: 'documented',
      provenance: `currency_parities XAF — ${parity.XAF.source_note || 'source non renseignée'}`,
      usage: 'Conversion XAF ↔ KMF dérivée via l’EUR (pas de taux direct).',
      consequence: 'Aucune. Le taux est conservé en pleine précision, l’arrondi est appliqué à l’affichage.',
    }));
  } else {
    items.push(item({ key: 'xaf_parity', label: 'Parité XAF (Cameroun, Congo)', value: null, status: 'missing',
      provenance: 'Absente', usage: 'Conversion XAF ↔ KMF via l’EUR.',
      consequence: 'Les prix et coûts des marchés XAF ne sont pas calculables.' }));
  }

  let aedKmf = null;
  let aedReason = null;
  try {
    aedKmf = (await fxAuthority.convert({ amount: '1', from: 'AED', to: 'KMF', round: false, client: db })).amount;
  } catch (err) {
    aedReason = err && err.message ? err.message : 'indisponible';
  }
  items.push(item({
    key: 'aed_kmf',
    label: 'Taux AED → KMF',
    value: aedKmf,
    status: aedKmf ? 'documented' : 'missing',
    provenance: aedKmf
      ? 'Observation EUR/USD approuvée par deux personnes × peg USD/AED (autorité FX)'
      : `Aucun taux disponible : ${aedReason}`,
    usage: 'Estimation du coût d’achat des produits en AED et coût mensuel du Hub (7 000 AED). Ne doit pas qualifier un achat réel.',
    consequence: aedKmf
      ? 'Aucune.'
      : 'Coûts d’achat AED, forfait Hub et recommandations en AED refusés (503) tant qu’aucune observation EUR/USD n’est approuvée.',
  }));

  items.push(item({
    key: 'relay_commission_kmf',
    label: 'Commission relais (montant fixe par article, due à la remise au client)',
    value: rel ? Number(rel.default_value) : (fc ? Number(fc.commission_relais_standard_kmf) : null),
    status: !rel && !fc ? 'missing' : (rel && rel.updated_by ? 'operator_set' : 'default_unvalidated'),
    provenance: rel ? 'cost_components.commission_relais_kmf (global, tous marchés)' : 'finance_config.commission_relais_standard_kmf (repli historique)',
    usage: 'Coût du relais alloué par article au moment de l’allocation du colis. Valeur globale : aucun montant par marché.',
    consequence: 'Un montant non validé est traité comme estimation, jamais comme coût réel. Les marchés Cameroun et Congo n’ont pas de commission propre.',
  }));

  return { items, has_unvalidated: items.some(i => ['missing', 'default_unvalidated', 'divergent'].includes(i.status)) };
}

module.exports = { getPricingParameterStatus };
