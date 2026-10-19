/**
 * @komerce-arch
 * @role          economic-engine-pricing-parameters-status
 * @domain        economic-engine
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context
 * @outputs       response_or_domain_result
 * @depends       db
 * @used-by       services/catalog-workspace.js
 * @db-read       finance_config, currency_parities, exchange_rates, cost_components
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, catalog
 * @version       2026-10
 */

'use strict';

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
  const [fcRes, parRes, fxRes, relRes] = await Promise.all([
    db.query(`SELECT taux_change_eur_kmf, taux_aed_kmf, hub_monthly_cost_aed, commission_relais_standard_kmf,
                     updated_at, updated_by FROM finance_config WHERE id = 1`),
    db.query(`SELECT currency, eur_rate, source_note FROM currency_parities WHERE currency IN ('KMF','XAF')`),
    db.query(`SELECT eur_kmf, aed_kmf, valid_from FROM exchange_rates ORDER BY valid_from DESC, id DESC LIMIT 1`).catch(() => ({ rows: [] })),
    db.query(`SELECT default_value, updated_by FROM cost_components
               WHERE key = 'commission_relais_kmf' AND is_active = TRUE ORDER BY display_order, key LIMIT 1`).catch(() => ({ rows: [] })),
  ]);
  const fc = fcRes.rows[0] || null;
  const parity = Object.fromEntries(parRes.rows.map(r => [r.currency, r]));
  const fx = fxRes.rows[0] || null;
  const rel = relRes.rows[0] || null;
  const operatorSet = Boolean(fc && fc.updated_by);
  const fxJournalMatches = Boolean(fx && fc && Number(fx.aed_kmf) === Number(fc.taux_aed_kmf));
  const items = [];

  // EUR/KMF : parité documentée vs taux du moteur de prix
  if (parity.KMF) {
    const legal = Number(parity.KMF.eur_rate);
    const pricing = fc ? Number(fc.taux_change_eur_kmf) : null;
    const diverges = pricing !== null && Math.abs(pricing - legal) > 0.0001;
    items.push(item({
      key: 'eur_kmf',
      label: 'Taux EUR → KMF',
      value: pricing,
      reference_value: legal,
      status: diverges ? 'divergent' : 'documented',
      provenance: `Parité documentée (currency_parities KMF) : ${legal} — ${parity.KMF.source_note || 'source non renseignée'}`,
      usage: 'Estimation des prix et prix EUR au paiement. Conversion d’un achat réel : à saisir avec la date du taux réellement appliqué.',
      consequence: diverges
        ? `Le moteur de prix utilise ${pricing} alors que la parité documentée est ${legal} : les prix EUR et les marges estimées dérivent légèrement.`
        : 'Aucune.',
    }));
  } else {
    items.push(item({ key: 'eur_kmf', label: 'Taux EUR → KMF', value: fc ? Number(fc.taux_change_eur_kmf) : null, status: 'missing',
      provenance: 'Aucune parité documentée trouvée', usage: 'Estimation des prix et prix EUR au paiement.',
      consequence: 'Le code applique alors une valeur de secours (492) sans l’annoncer.' }));
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

  items.push(item({
    key: 'aed_kmf',
    label: 'Taux AED → KMF',
    value: fc ? Number(fc.taux_aed_kmf) : null,
    status: !fc ? 'missing' : (operatorSet && fxJournalMatches ? 'operator_set' : 'default_unvalidated'),
    provenance: operatorSet && fxJournalMatches
      ? `Saisi par un opérateur, journal exchange_rates du ${fx.valid_from}. Source non vérifiée par le système.`
      : 'Valeur par défaut du schéma, sans saisie ni source.',
    usage: 'Estimation du coût d’achat des produits en AED et coût mensuel du Hub (7 000 AED). Ne doit pas qualifier un achat réel.',
    consequence: 'Coûts d’achat AED et forfait Hub convertis avec un taux non justifié : simulation seulement, jamais un coût réel.',
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
