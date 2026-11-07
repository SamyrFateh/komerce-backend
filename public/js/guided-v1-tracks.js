/**
 * @komerce-arch-lite
 * @role golden-guided-market-hub-v1-scenarios
 * @domain dashboard
 * @layer frontend
 * @owner backend-core
 * @purpose Guider une recette humaine de vraies actions Hub/marchés sans écrire en base ni inventer un verdict.
 * @impact-areas dashboard, hub, market-delegation, staging-only
 */
'use strict';
(function initKomerceGuidedV1(global) {
  // Le rôle de session vérifie uniquement l'accès au guide. Les grants fins,
  // actes HTTP et lectures PG sont des preuves indépendantes du runner métier.
  const s=(title,actor,roles,path,expected,proof,source)=>Object.freeze({
    title,actor,roles,path,expected,proof,source,
  });
  const order='/admin/orders/:ref';
  const hubAdmin='/admin/hub?branch=administrative';
  const hubOps='/admin/hub?branch=operations';
  const relay='/admin/relais-live';
  const market='/dashboards/canonical/access.html';
  const suppliers='scripts/recette/hub-v1-http-action-runner.js';
  const physical='docs/hub/HUB_WORK_ORDER_FIRST_20261102.md';
  const control='docs/recette/E2E_MARKETS_AND_IDENTITIES_L10.md';
  const shared=[
    s('Réception Hub · quantités réelles','Agent Hub',['agent_hub'],hubOps,
      'Ouvrir la réception attendue depuis le dossier PO. Confirmer par le writer canonique uniquement les unités physiquement reçues. Une quantité absente reste à livrer.',
      'PO, article, quantité attendue/reçue, acteur, événement HTTP et ligne PostgreSQL ; réception partielle conservée.',physical),
    s('Scanner les articles réellement reçus','Agent Hub',['agent_hub'],'/admin/hub-live?view=execute',
      'Scanner le SKU physique et le rattacher à la bonne commande. Refuser code/quantité non concordants.',
      'Scan, SKU, order_item_id, quantité allouée et refus d’un deuxième scan identique.',physical),
    s('Créer les colis clients','Agent Hub',['agent_hub'],hubOps,
      'Créer un ou plusieurs colis clients à partir des allocations physiques. Un colis client appartient à une seule commande.',
      'Colis distincts et quantités exactes, aucun produit reçu deux fois, reliquat visible.',physical),
    s('Consolider en KOM-BOX si nécessaire','Agent Hub',['agent_hub'],hubOps,
      'Regrouper des colis clients dans une KOM-BOX ou expédier un colis volumineux autonome selon le circuit supporté.',
      'Colis clients, unités de transport et composition physique avant remise, sans double attribution.',physical),
    s('Expédier et attester la remise transitaire','Agent Hub / Transitaire',['agent_hub','agent_transitaire'],'/admin/workspaces/shipping-customs',
      'Ouvrir l’expédition, sélectionner les cartons réellement prêts, puis attester la remise au transitaire avec une preuve horodatée.',
      'Référence shipment, cartons/colis, acteur, preuve, statut après remise et composition figée.',physical),
    s('Réception attestée au relais choisi','Agent Relais',['agent_relais'],relay,
      'Se connecter au relais effectivement affecté. Ouvrir les colis de l’expédition puis attester les quantités et les éventuels manquants.',
      'Relais ID, colis, article/quantité, acteur et événement de réception ; colis d’un autre relais refusé.',control),
    s('Remise effective au client','Agent Relais',['agent_relais'],relay,
      'Cliquer sur la remise client autorisée et constater le nouvel état. Une remise prématurée ou un double retrait doit être refusé.',
      'Scans, preuve de retrait, colis collected et statut commande ; reliquat toujours explicite.',control),
    s('Réconciliation de la commande','Admin / Finance',['admin','finance'],'/admin/workspaces/accounting',
      'Rapprocher commande, achats, paiements, coûts, expéditions et retraits. Ne jamais remplacer coût inconnu par zéro.',
      'Journal d’événements, montants et devises, pièces et clôture justifiée ou anomalie persistante.',control)
  ];
  const starting=[
    s('Identifier commande et marché','Responsable marché / Admin',['market_operator','admin'],order,
      'Ouvrir la commande de la fixture. Vérifier qu’elle est payée, possède un relais de destination et des lignes IMPORT.',
      'Référence exacte, marché, mode de paiement, lignes/quantités et identifiant relais, lus à l’écran et par API.',suppliers),
    s('Besoin fournisseur déclenché','Agent Hub',['agent_hub'],hubAdmin,
      'Retrouver les besoins d’achat de la commande dans le Hub central, sans rattacher artificiellement le Hub au marché.',
      'order_item_id → besoin ouvert → fournisseur ; absence de mapping = BLOCKED, jamais PO inventée.',suppliers),
    s('Préparer le PO fournisseur','Agent Hub',['agent_hub'],hubAdmin,
      'Cliquer sur la préparation du PO ; regrouper seulement par fournisseur et marché compatibles.',
      'Clic, POST canonique, PO brouillon, quantité et readback API/PG. Responsable marché hors scope refusé.',suppliers),
    s('Autoriser l’engagement PO','Directrice Hub (grant engagement)',['agent_hub'],hubAdmin,
      'Avec le compte Directrice, autoriser explicitement l’engagement. Un agent Hub sans grant doit recevoir 403.',
      'Décision purchase_commitment, acteur et preuve ; refus AUTHORIZATION_GRANT_REQUIRED pour agent ordinaire.',suppliers),
    s('Soumettre et envoyer au fournisseur','Agent Hub',['agent_hub'],hubAdmin,
      'Après autorisation, soumettre le PO et enregistrer le canal d’envoi simulé. Aucun message, achat ni appel fournisseur réel.',
      'Statut PO, référence fournisseur et preuve de simulation ; rejeu sans effet externe.',suppliers),
    s('Autoriser séparément le paiement fournisseur','Directrice Hub (grant paiement)',['agent_hub'],hubAdmin,
      'Autoriser le paiement fournisseur à une étape distincte de l’engagement. Cela ne doit déclencher aucun débit réel.',
      'Décision supplier_payment, montant/devises, auteur, justificatif ; agent sans grant refusé.',suppliers)
  ];
  const tracks={
    v1_manual:Object.freeze({label:'V1 · Achat manuel → relais',steps:Object.freeze([
      ...starting,
      s('Confirmation fournisseur manuelle','Agent Hub',['agent_hub'],hubAdmin,
        'Renseigner la référence de commande fournisseur et la confirmation des quantités, sans préjuger de la réception au Hub.',
        'PO et lignes confirmées, justificatif, statut ; aucune réception physique inventée.',suppliers),
      ...shared,
    ])}),
    v1_api:Object.freeze({label:'V1 · Achat API certifié → relais',steps:Object.freeze([
      ...starting.slice(0,4),
      s('Déclencher la commande via API certifiée','Agent Hub / intégration autorisée',['agent_hub'],hubAdmin,
        'Vérifier que le fournisseur est réellement certifié API, puis déclencher l’exécution autorisée. Si intégration absente, BLOCKED, pas de succès simulé.',
        'Provider capability certifié, HTTP réel, supplier_order_id et statut durable.',suppliers),
      starting[5],
      s('Confirmation/tracking fournisseur par API','Agent Hub',['agent_hub'],hubAdmin,
        'Lire la confirmation et le tracking réellement reçus du fournisseur. Un timeout ou statut pending ne devient jamais livré.',
        'Réponse API, horodatage et preuve fournisseur, quantité et ETA non inventées.',suppliers),
      ...shared,
    ])}),
    v1_semi:Object.freeze({label:'V1 · Achat semi-API → relais',steps:Object.freeze([
      ...starting.slice(0,4),
      s('Préparer la transmission semi-API','Agent Hub',['agent_hub'],hubAdmin,
        'Lancer uniquement la partie supportée par l’intégration ; remettre la partie non couverte à l’agent, sans inventer une action automatique.',
        'Canal réellement utilisé, confirmation humaine requise et référence PO.',suppliers),
      starting[5],
      s('Compléter la confirmation manuelle','Agent Hub',['agent_hub'],hubAdmin,
        'Compléter preuve, montant et réponse fournisseur dans le dossier ; distinguer le retour de l’API du constat de l’agent.',
        'Justificatifs, auteur/heure et quantités confirmées.',suppliers),
      ...shared,
    ])}),
    v1_local:Object.freeze({label:'V1 · Commande locale sans Hub',steps:Object.freeze([
      s('Commande locale payée','Responsable marché / Admin',['market_operator','admin'],order,
        'Vérifier LOCAL_STOCK et relais, prix et paiement confirmé. Aucune ligne IMPORT cachée.',
        'Order 360, market, payment_status, lignes LOCAL_STOCK et affectation relais.',control),
      s('Aucun besoin d’achat Hub créé','Admin (contrôle négatif)',['admin'],hubOps,
        'Vérifier que cette commande n’a ni PO fournisseur, ni unité Hub, ni expédition internationale.',
        'Absence prouvée par GET/API/PG ; un résultat vide n’est pas à lui seul une preuve suffisante.',physical),
      s('Préparation locale','Responsable marché / Relais',['market_operator','agent_relais'],relay,
        'Préparer localement les articles et la mise à disposition au relais sans étape Hub internationale.',
        'Writer local, acteur, quantités, état avant/après et preuve locale.',control),
      s('Disponibilité attestée au relais','Agent Relais',['agent_relais'],relay,
        'Confirmer la présence physique des produits locaux au relais affecté.',
        'Colis/commande disponibles au bon relais, preuve de réception locale.',control),
      s('Remise locale au client','Agent Relais',['agent_relais'],relay,
        'Exécuter la remise avec preuve ; refuser double retrait et compte d’un autre relais.',
        'Scan, date, acteur, retrait et état collected.',control),
      s('Clôture du circuit local','Admin / Finance',['admin','finance'],'/admin/workspaces/accounting',
        'Contrôler encaissement, garde éventuelle du cash, coûts locaux et journal ; aucune douane ni fret international fictif.',
        'Réconciliation financière et coûts applicables uniquement au circuit local.',control),
    ])}),
    v1_partial:Object.freeze({label:'V1 · Réception partielle et reliquat',steps:Object.freeze([
      starting[0],starting[1],starting[2],starting[3],
      s('Réception fournisseur partielle','Agent Hub',['agent_hub'],hubOps,
        'Réceptionner une quantité inférieure à la commande. Refuser le cumul supérieur au PO.',
        'Attendu/reçu/manquant, événements distincts et PO partiellement reçue.',physical),
      s('Colis client pour quantité reçue','Agent Hub',['agent_hub'],hubOps,
        'Créer un colis seulement pour les articles effectivement reçus, sans bloquer artificiellement le reliquat.',
        'Quantités colis = allocations reçues ; rien pour les quantités manquantes.',physical),
      s('Expédier le partiel','Agent Hub',['agent_hub'],'/admin/workspaces/shipping-customs',
        'Expédier le colis prêt et constater les quantités toujours à livrer.',
        'Expédition réelle, remise transitaire, reliquat inchangé.',physical),
      s('Arbitrer reliquat ou remboursement','Responsable marché / Admin',['market_operator','admin'],order,
        'Laisser le reste à livrer ou traiter un remboursement par le writer et l’autorisation prévus. Aucun PSP réel en recette.',
        'Quantité résiduelle, montant remboursable et justificatif ; aucun double règlement.',control),
    ])}),
    v1_market:Object.freeze({label:'V1 · Prérequis et isolation d’un marché',steps:Object.freeze([
      s('Lifecycle et audit officiels','Admin central',['admin'],market,
        'Lire le lifecycle réel du marché. Une valeur ACTIVE issue du seed sans décision officielle est non conforme.',
        'Code marché, is_active, readiness, acteur et dernière transition auditée.',control),
      s('Référent central et responsable marché','Admin central',['admin'],market,
        'Vérifier le référent, les rattachements actifs et leurs plafonds. Hub central sans memberships locaux.',
        'IDs des personnes affectées, date et portée exacte, aucun grant individuel fabriqué.',control),
      s('Catalogue et publication locale','Responsable marché / Admin',['market_operator','admin'],'/admin/workspaces/catalog',
        'Lire produits réellement exposés et publiés pour ce marché. Un catalogue vide est BLOCKED.',
        'Produit/SKU, classification, exposition, état et prix actif.',control),
      s('Prix, devise et transport','Responsable marché',['market_operator'],'/admin/workspaces/pricing',
        'Contrôler prix local, devise (KMF pour KM, XAF pour CM/CG, EUR pour YT), parité et tarif de transport réel.',
        'Montant, devise, snapshot FX et transport, provenance des tarifs et arrondis.',control),
      s('Encaissements et relais','Admin central',['admin'],market,
        'Contrôler modes d’encaissement autorisés, caisse/relais existant, attestation de livrabilité et affectation.',
        'Readiness, moyens, tarifs, relais et preuve d’affectation active.',control),
      s('Isolation du responsable marché','Responsable marché',['market_operator'],'/admin/orders',
        'Se connecter avec un responsable de ce marché ; lire ses commandes et prouver le refus GET/POST sur un autre marché.',
        'Périmètre du jeton, marché autorisé, 403 hors périmètre et absence de fuite CM↔CG.',control),
      s('Hub central multi-marchés sans élévation','Agent Hub',['agent_hub'],hubOps,
        'Lire ce marché dans le Hub central s’il est actif et contrôler l’absence de droit Admin/marché commercial indu.',
        'Vue Hub et boutons propres au Hub, refus financier/gouvernance hors grants.',physical),
      s('Contrôle du circuit de destination','Agent Relais',['agent_relais'],relay,
        'Vérifier le relais réel et ses colis, sans transférer de droits d’un autre relais. Mayotte utilise ses propres règles de transport/douane.',
        'Market ID, relais ID, statut colis et séparation des destinations.',control),
      s('Bilan et décision marché','Admin central',['admin'],market,
        'Compiler prérequis et preuves. Si un manque persiste, conserver BLOCKED et ne pas activer artificiellement le marché.',
        'Tableau PASS/FAIL/BLOCKED/NOT_PROVEN et auteur du verdict humain.',control),
    ])}),
    v1_dj:Object.freeze({label:'V1 · Djibouti inactif : refus attendus',steps:Object.freeze([
      s('Constater le lifecycle inactif','Admin central',['admin'],market,
        'Lire le vrai statut de DJ sans l’activer ; relever l’audit existant et les readiness gaps.',
        'Lifecycle, devise DJF, trace et statut ready_for_activation sans mutation.',control),
      s('Refus de checkout DJ','Admin central',['admin'],'/admin/orders',
        'Consulter une preuve de tentative refusée par la route canonique. Ne pas créer de commande DJ ni déclencher une vente pour le seul test.',
        'HTTP 409 attendu sur fixture isolée, aucune commande créée ; sinon NOT_PROVEN.',control),
      s('Refus des opérations Hub sur DJ','Agent Hub',['agent_hub'],hubOps,
        'Vérifier que DJ inactif ne peut pas recevoir de PO ni accès d’exécution malgré le Hub central multi-marchés.',
        '403/409 canonique et zéro mutation, preuve API et audit.',control),
      s('Conserver DJ inactif','Admin central',['admin'],market,
        'Vérifier qu’aucune opération de cette recette n’a activé DJ.',
        'Lifecycle et audit inchangés, aucune nouvelle commande.',control),
    ])}),
  };
  const markets=Object.freeze({
    KM:'Comores · KMF · référence import + local + cash et îles',
    CM:'Cameroun · XAF · isolation stricte vis-à-vis de CG, readiness à prouver',
    CG:'Congo · XAF · isolation stricte vis-à-vis de CM, readiness à prouver',
    YT:'Mayotte · EUR natif · circuit transport/douane spécifique, readiness à prouver',
    DJ:'Djibouti · DJF · inactif, uniquement contrôles de refus',
  });
  global.KomerceGuidedV1=Object.freeze({tracks:Object.freeze(tracks),markets});
})(typeof window !== 'undefined' ? window : globalThis);
