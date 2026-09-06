/**
 * @komerce-arch
 * @role          economic-engine-pricing-cost-explainability
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        cost_component_projection, market_context
 * @outputs       semantic_cost_line_explainability
 * @depends       none
 * @used-by       services/pricing-workspace.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      explain_without_recompute, never_promote_config_to_real, n3_is_period_structure
 * @impact-areas  pricing, economic-engine, admin-dashboard
 * @version       2026-09
 */

'use strict';

const CATEGORY_SEMANTICS = Object.freeze({
  product_purchase: Object.freeze({
    meaning: 'Prix réellement payé ou référence d’achat du produit auprès du fournisseur.',
    manipulation: 'Le coût d’achat unitaire qui entre dans le coût variable du produit.',
    driver: 'Prix fournisseur, remise, quantité achetée et devise d’achat.',
    changes_when: 'Nouvel achat, nouveau fournisseur, remise négociée ou variation de change.',
    default_assumption: 'Tant qu’un achat réellement réconcilié n’est pas disponible, la valeur configurée reste une hypothèse de coût et ne devient pas une preuve de décaissement.',
  }),
  sourcing: Object.freeze({
    meaning: 'Coût du travail de sourcing directement causé par le produit ou le flux.',
    manipulation: 'La part de sourcing variable imputée au produit, à la commande ou au flux selon sa méthode d’allocation.',
    driver: 'Mode de sourcing, quantité, valeur traitée et prestation réellement facturée.',
    changes_when: 'Le mode de sourcing, le fournisseur ou la prestation de sourcing change.',
    default_assumption: 'Une valeur forfaitaire ou configurée décrit une attente tant qu’elle n’est pas rapprochée d’une prestation réellement constatée.',
  }),
  hub: Object.freeze({
    meaning: 'Coût variable du Hub causé directement par le passage du produit, du colis ou d’une opération.',
    manipulation: 'La manutention ou l’opération Hub variable qui suit le flux et reste en N1.',
    driver: 'Nombre d’opérations, colis traités, contrôles, étiquetage ou prestation unitaire.',
    changes_when: 'Le traitement physique, le tarif d’opération ou le volume d’opérations change.',
    default_assumption: 'Cette ligne ne doit contenir que du Hub variable. Loyer, personnel fixe et capacité de structure appartiennent à N3 et ne doivent jamais être comptés ici une seconde fois.',
  }),
  packaging: Object.freeze({
    meaning: 'Coût des emballages directement consommés pour préparer le produit ou le colis.',
    manipulation: 'Le coût variable d’emballage imputé au flux.',
    driver: 'Type d’emballage, quantité consommée et coût d’achat réel des consommables.',
    changes_when: 'Le packaging, son prix d’achat ou la quantité consommée change.',
    default_assumption: 'Une moyenne configurée reste une approximation jusqu’à ce que la consommation réelle soit mesurée ou réconciliée.',
  }),
  freight: Object.freeze({
    meaning: 'Part du transport international attribuée au produit, colis ou shipment.',
    manipulation: 'Le coût de fret variable avant distribution locale.',
    driver: 'Mode de transport, poids taxable, volume, shipment, tarif transporteur et change.',
    changes_when: 'Le mode de transport, le tarif, le poids/volume réel ou le shipment change.',
    default_assumption: 'L’assiette d’allocation doit suivre la contrainte réelle du transport. Une approximation de poids ou volume doit rester explicitement signalée comme telle.',
  }),
  customs: Object.freeze({
    meaning: 'Droits, taxes et frais douaniers attribuables au flux importé.',
    manipulation: 'La charge douanière variable intégrée au coût rendu relais.',
    driver: 'Valeur taxable, nomenclature, taux applicable, liquidation réelle et change.',
    changes_when: 'La valeur taxable, le taux, la classification ou la liquidation douanière change.',
    default_assumption: 'Un taux configuré est une estimation. La vérité économique vient de la liquidation réellement constatée et de son allocation au flux.',
  }),
  port_transitary: Object.freeze({
    meaning: 'Frais de port et de transitaire nécessaires au passage du flux importé.',
    manipulation: 'La quote-part port/transitaire imputée au shipment, colis ou produit.',
    driver: 'Facture transitaire, frais portuaires, shipment et méthode d’allocation.',
    changes_when: 'Une facture, un shipment ou la clé d’allocation change.',
    default_assumption: 'La clé historique du snapshot est port_transitary ; la réconciliation réelle peut utiliser le vocabulaire port_transitaire. La correspondance doit rester explicite.',
  }),
  local_distribution: Object.freeze({
    meaning: 'Coût variable pour acheminer le flux depuis son point d’arrivée vers la distribution locale.',
    manipulation: 'Le dernier segment logistique avant le relais lorsque ce segment est distinct.',
    driver: 'Distance, tournée, prestataire, colis et coût réel de distribution.',
    changes_when: 'Le prestataire, la tournée, la destination ou le volume change.',
    default_assumption: 'Si aucune saisie réelle fine n’existe, la ligne doit rester estimée ou manquante ; elle ne doit pas être transformée silencieusement en zéro.',
  }),
  relay: Object.freeze({
    meaning: 'Commission ou coût variable du relais lié à la remise du flux au client.',
    manipulation: 'La commission attendue ou réellement réglée au relais.',
    driver: 'Contrat relais, commande/colis, canal et règlement effectivement constaté.',
    changes_when: 'Le contrat, le relais, le canal ou le règlement change.',
    default_assumption: 'Une commission configurée décrit ce qui devrait être payé ; elle ne constitue pas à elle seule la preuve d’un règlement réel.',
  }),
  payment: Object.freeze({
    meaning: 'Frais variables de paiement causés par l’encaissement de la vente.',
    manipulation: 'Le coût transactionnel du moyen de paiement.',
    driver: 'Canal de paiement, montant encaissé, commission du prestataire et change.',
    changes_when: 'Le canal, le montant encaissé ou le tarif du prestataire de paiement change.',
    default_assumption: 'Le taux configuré sert à estimer N2 ; la réconciliation réelle doit venir des frais effectivement prélevés sur la transaction.',
  }),
  risk_provision: Object.freeze({
    meaning: 'Provision économique pour couvrir un risque attendu de la vente.',
    manipulation: 'Une charge variable de contribution N2, mais pas un décaissement réel de la commande.',
    driver: 'Politique de risque, historique de pertes, catégorie et exposition.',
    changes_when: 'La politique de risque ou les observations de pertes réelles changent.',
    default_assumption: 'La provision reste une hypothèse statistique. Sa vérité se réconcilie au niveau de la période ; elle ne doit jamais être présentée comme une preuve de cash au niveau commande.',
  }),
  fixed_overhead: Object.freeze({
    meaning: 'Quote-part de charges fixes de structure nécessaire pour lire la viabilité économique de la période.',
    manipulation: 'Une allocation N3 de structure ; ce n’est pas une dette du SKU ni un coût variable de la vente.',
    driver: 'Charges fixes réelles de période, marchés éligibles et politique de mutualisation gouvernée.',
    changes_when: 'La charge de structure, la fenêtre économique ou la clé de mutualisation change.',
    default_assumption: 'N3 sert à mesurer la couverture de période. Il ne doit pas être réinjecté comme coût variable article ni utilisé pour créer artificiellement un plancher SKU.',
  }),
  incident: Object.freeze({
    meaning: 'Coût exceptionnel lié à un incident qui ne représente pas le fonctionnement normal.',
    manipulation: 'Un coût de crise ou d’anomalie isolé du modèle courant.',
    driver: 'Incident réel, montant constaté et décision de traitement.',
    changes_when: 'Un incident est constaté, corrigé ou reclassifié.',
    default_assumption: 'Un incident ne doit pas devenir une norme de pricing permanente sans décision explicite de reclassification.',
  }),
  marketing_campaign: Object.freeze({
    meaning: 'Dépense exceptionnelle ou bornée liée à une campagne commerciale.',
    manipulation: 'Un coût stratégique temporaire, distinct du fonctionnement économique normal.',
    driver: 'Budget de campagne, période, marché et consommation réelle du budget.',
    changes_when: 'La campagne démarre, se termine, change de budget ou est réconciliée.',
    default_assumption: 'Une campagne doit rester datée, bornée et traçable ; elle ne doit pas devenir une surcharge permanente cachée du prix.',
  }),
});

const SOURCE_LABELS = Object.freeze({
  default: 'Valeur centrale configurée',
  category: 'Valeur configurée par catégorie',
  manual: 'Valeur déclarée manuellement',
  supplier: 'Référence fournisseur',
  real: 'Valeur réelle constatée',
  missing: 'Donnée manquante',
  market_override: 'Override du marché',
});

const CONFIDENCE_LABELS = Object.freeze({
  low: 'Faible — hypothèse à challenger',
  medium: 'Moyenne — exploitable avec prudence',
  high: 'Élevée — source considérée robuste',
});

function layerFor(component = {}) {
  if (component.family === 'exceptional') return 'EXCEPTIONAL';
  if (component.family === 'landed_relay') return 'N1';
  if (component.family === 'business' && component.category === 'fixed_overhead') return 'N3';
  if (component.family === 'business') return 'N2';
  return 'UNKNOWN';
}

function truthState(component = {}) {
  const source = component.source || 'missing';
  if (source === 'real') return 'observed_real';
  if (source === 'missing') return 'missing';
  if (source === 'supplier') return 'external_reference';
  if (source === 'market_override') return 'configured_override';
  if (source === 'manual') return 'declared';
  return 'configured';
}

function sourceLabel(component = {}, context = {}) {
  if (component.source === 'market_override') {
    return `Override ${context.marketCode || 'marché'} sur base globale`;
  }
  return SOURCE_LABELS[component.source] || `Source : ${component.source || 'non renseignée'}`;
}

function impactFor(component = {}) {
  const layer = layerFor(component);
  if (layer === 'N1') {
    return {
      path: 'N1 → coût variable rendu relais → plancher économique → contribution → prix décisionnel',
      affects_price_floor: true,
      affects_contribution: true,
      affects_period_coverage: true,
      price_effect: 'Direct sur le coût variable et donc sur le plancher économique.',
    };
  }
  if (layer === 'N2') {
    return {
      path: 'N2 → coût variable business → contribution → couverture → prix décisionnel',
      affects_price_floor: true,
      affects_contribution: true,
      affects_period_coverage: true,
      price_effect: 'Direct sur le coût variable business et la contribution.',
    };
  }
  if (layer === 'N3') {
    return {
      path: 'N3 → charge économique de période → couverture marché → gate de décision',
      affects_price_floor: false,
      affects_contribution: false,
      affects_period_coverage: true,
      price_effect: 'Indirect : N3 borne la viabilité de période mais ne devient pas un coût variable du SKU.',
    };
  }
  return {
    path: 'Exceptionnel → lecture séparée → décision humaine avant reclassification',
    affects_price_floor: false,
    affects_contribution: false,
    affects_period_coverage: false,
    price_effect: 'Aucun effet permanent automatique sans décision explicite.',
  };
}

function evidenceFor(component = {}) {
  const state = truthState(component);
  const confidence = component.confidence || 'medium';
  return {
    truth_state: state,
    confidence,
    confidence_label: CONFIDENCE_LABELS[confidence] || confidence,
    is_observed_real: state === 'observed_real',
    needs_reconciliation: !['observed_real'].includes(state),
    caution: state === 'missing'
      ? 'Donnée absente : le moteur ne doit ni l’inventer ni la transformer en zéro.'
      : (state === 'observed_real'
        ? 'Valeur déclarée comme réelle ; sa chaîne de preuve reste celle du writer métier qui l’a produite.'
        : 'Cette valeur décrit une hypothèse, une configuration ou une référence ; elle ne doit pas être présentée comme un réel constaté.'),
  };
}

function explainComponent(component = {}, context = {}) {
  const semantic = CATEGORY_SEMANTICS[component.category] || {
    meaning: component.description || 'Composant économique du modèle de coût.',
    manipulation: 'Valeur économique utilisée par le moteur selon sa famille et sa méthode d’allocation.',
    driver: 'Données et règles propres à ce composant.',
    changes_when: 'Sa source, son assiette ou sa configuration change.',
    default_assumption: 'La provenance et la confiance doivent être vérifiées avant de traiter cette valeur comme un réel.',
  };
  const layer = layerFor(component);
  const inherited = context.marketCode ? component.inherited !== false : null;
  const humanNote = component.override_notes || component.notes || null;

  return Object.freeze({
    layer,
    meaning: semantic.meaning,
    manipulation: semantic.manipulation,
    origin: Object.freeze({
      source: component.source || 'missing',
      source_label: sourceLabel(component, context),
      base_source: component.base_source || null,
      inherited,
      market_code: context.marketCode || null,
      last_updated_at: component.override_updated_at || component.updated_at || component.base_updated_at || null,
    }),
    hypothesis: Object.freeze({
      text: humanNote || semantic.default_assumption,
      is_explicit_human_note: Boolean(humanNote),
    }),
    movement: Object.freeze({
      driver: semantic.driver,
      changes_when: semantic.changes_when,
      allocation_method: component.allocation_method || 'none',
      active_from: component.active_from || null,
      active_until: component.active_until || null,
    }),
    impact: Object.freeze({ layer, ...impactFor(component) }),
    evidence: Object.freeze(evidenceFor(component)),
  });
}

function explainComponents(components = [], context = {}) {
  return components.map(component => ({
    ...component,
    explainability: explainComponent(component, context),
  }));
}

module.exports = {
  CATEGORY_SEMANTICS,
  SOURCE_LABELS,
  CONFIDENCE_LABELS,
  layerFor,
  truthState,
  impactFor,
  evidenceFor,
  explainComponent,
  explainComponents,
};
