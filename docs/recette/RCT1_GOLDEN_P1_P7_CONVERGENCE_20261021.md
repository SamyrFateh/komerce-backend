# RCT1 × Golden E2E — contrat de convergence P1–P7 (21 octobre 2026)

**Statut : contrat de recette, pas un GO.** Ce document actualise le guidage de RCT1 à la suite des arbitrages P1–P7 et des PR dashboards #2786–#2798. Il ne modifie ni moteur métier, ni données, ni preuves historiques.

## 1. Hiérarchie et frontières

- **Référence métier :** `docs/doctrine/KOMERCE_CARTOGRAPHIE_PROCESSUS_P1_P7.md`, avec ses arbitrages ultérieurs (navigation directe autorisée, P6 → P1 par revue humaine, readiness P7).
- **Référence visuelle :** les huit derniers mocks validés, style blanc dominant de Finance, orange discret. La CI et Chromium local n'accordent pas de GO visuel staging.
- **Exécution métier :** propriétaires et services canoniques. Les huit dashboards sont des **lectures et points d'entrée** ; aucune action métier ou calcul réimplémenté dans le Golden.
- **RCT1 :** données et cas de recette **simulés**, isolés par `orders.simulation_scope='RCT1'`. Le moteur reste `scripts/recette/rct1/**` ; ne pas le réécrire ou réinstaller pour aligner les écrans.
- **Golden E2E :** guide **Comprendre → Visualiser → Valider** sur les vrais écrans ; observation humaine et preuve technique séparées ; aucune décision automatique ou certification implicite.
- **Sécurité :** staging uniquement, jamais de RESET/purge, jamais de paiement réel, PO réel, publication ou mutation SQL destinée à forcer un PASS. Les opérations de test nécessitent leur garde de cible et autorisation distincte.

## 2. Baseline RCT1 effectivement prouvée et divergences documentaires

Dernier contrôle SQL documenté **20 octobre 2026** : `docs/recette/CONTRE_RECETTE_CANONIQUE_STAGING_20261020.md` et ses liens de runs.

| Indicateur de la preuve datée | Observé le 20/10, scope RCT1 |
| --- | ---: |
| Commandes créées / payées | 7 / 6 |
| Ventes payées (wallet compris) | 106 390 KMF |
| Marge finalisée (2 commandes `actual`) | 6 615 KMF |
| Référence E1 | marge 4 765 KMF |
| Référence G | marge 1 850 KMF |
| Commandes RCT1 sans scope | 0 |

**Important :** valeurs historiques issues d'une preuve SQL datée, **ni seed imposé à nouveau ni attendu intemporel**. Relever l'état et la période de la nouvelle version avant comparaison.

Le guide historique `RCT1_GUIDE_RECETTE_ECRANS.md` annonce encore **5 commandes payées / 100 390 KMF et G non installée** ; ces chiffres sont antérieurs à la contre-recette. Il décrit aussi `/admin/orders` comme une redirection, annulée par #2786. Le guide reste archive des scénarios et des arbitrages (notamment P3), **pas une source de vérité actuelle sur la base**. Réconcilier l'attendu selon la preuve et l'identité de version ; ne jamais faire correspondre l'observé en modifiant la donnée.

**Avant toute recette :** `GET /health/version` doit correspondre au SHA réellement déployé ; le vieux staging `c24405533` ne prouve rien sur les PR #2786–#2798. Contrôler migrations applicables, flags, période, marché, rôle, API et navigateur authentifié. Sans version conforme : **BLOQUÉ**, et non GO.

## 3. Matrice de rapprochement RCT1 ↔ processus P1–P7

| Processus | Observation à prouver sur écran propriétaire | Preuve RCT1 préexistante / limite |
| --- | --- | --- |
| **P1 — transformation produit** | Source et run Sourcing → décision KEEP/WATCH/REJECT → Raffinerie → SKU/classification → Catalogue global → décision de prix / exposition par marché | Produits P1–P5, classification et P5 conversion testables. **RCT1 ne prouve pas à lui seul** le passage d'un même produit réel du sourcing à l'exposition. Faire le rapprochement par identifiants ; CJ 20/15/5 est un parcours séparé, jamais joint fictivement. |
| **P2 — commande / remise** | Liste figée et paiement selon **contrat actif**, dashboard Commandes `/admin/orders` distinct → Order 360 `/admin/orders/:reference` → retrait | Références RCT1 E1/F/C/C2/I3/G et leurs états. Moteur collectif historique 48/72 h ≠ contrat actuel présumé ; relever la version, aucun basculement implicite. |
| **P3 — achats** | Commande payée → besoin → PO → prix et preuve fournisseur → réception physique | Les commandes RCT1 ne prouvent pas à elles seules paiement fournisseur et réception à Dubaï ; lier les vraies références canoniques, marquer manque sinon. |
| **P4 — Hub, transport, douane et relais** | Fournisseur → **Hub mutualisé Dubaï** (PO / unités / réception) → colis et lot par marché → expédition / douane → entrée pays → ville / relais → remise | I1/I2 groupage, I3 envoi scindé, C douane inconnue, zéro douane confirmé. **PO groupé ≠ groupage transport.** Expéditions prêtes / consolidation transport restent des GAP sans objet canonique démontré, pas des faits inventés. `transit_hub=ANJOUAN` est un héritage KM, pas le Hub Dubaï. |
| **P5 — argent** | Paiement client (Stripe sandbox si confirmé, cash), garde cash, dépôt, rapprochement, règlement pays | E1 cash, E2 Stripe conditionnel et non exécuté ; ne pas assimiler preuve de vente à encaissement ou transfert réellement confirmé. |
| **P6 — coûts et marge** | Estimation figée → coûts constatés et provenance → applicabilité Hub/LOCAL_STOCK → marge réelle finalisée → **revue humaine** du prix | E1 = 4 765 ; G = 1 850 dans la preuve historique ; F relais manquant, C douane inconnue, I3 fret ventilé sans doublon. **Inconnu ≠ zéro ≠ non applicable ≠ simulé.** Aucun prix actif modifié automatiquement par la marge. |
| **P7 — marché** | Provisioning → readiness → ACTIVE → droits opérateurs → prix/exposition/commande autorisés | Tester isolation KM/CM/CG, devises KMF/XAF, marchés sans activité affichés correctement dans Pilotage. J/K et routage ville/relais CM/CG restent à prouver sans fausse île comorienne, sans Hub Douala/Yaoundé présumé, sans segment logistique inventé. |

## 4. Contrôle obligatoire des huit dashboards sur le même scénario

Pour **Pilotage, Commerce, Commandes, Opérations, Finance, Sourcing Live, Hub Live, Relais Live** : relever acteur et droit, marché, période, devise, `simulation_scope`, référence de commande/produit/PO/lot, endpoint propriétaire et horodatage ; confronter **attendu → JSON API → observé à l'écran** et vérifier ouverture de l'espace d'action + `return_to` sans perte de contexte.

- **Pilotage** : supervision de **tous** les marchés éligibles, y compris sans commande active ou avec incidents seuls ; alertes, chaîne, décisions et liens des huit surfaces (sans KPI recomptés client).
- **Commerce** : même cohorte de **ventes payées** (wallet compris, annulées/remboursées exclues) pour KPI, série par jour, donut par marché et commandes récentes ; pas de somme de devises hétérogènes sans conversion prouvée.
- **Commandes** : surface distincte `/admin/orders` (#2786, #2793), files et relations marché/produit/colis, liens vers Order 360 ; ne plus valider l'ancienne redirection.
- **Opérations** : chaîne P2 et exceptions, clic sur étape → bon propriétaire, aucune décision automatique.
- **Finance** : exactement **trois KPI** validés (CA encaissé, coûts constatés, marge réelle finalisée) ; distinguer ventes payées/encaissement, coût constaté/engagé, marge partielle/finalisée, origine réelle/RCT1.
- **Sourcing Live** : passage, source, fraîcheur, état inconnu explicite ; aucun statut métier créé par la vue.
- **Hub Live** : **Flux Hub par défaut**, Suivi/Commandes/Exécution accessibles ; PO et unités physiques, pas de faux groupage transport.
- **Relais Live** : KPI + file + détail dans la même vue ; contrôle des droits et preuve de retrait.

**Limite importante du guide Golden actuel :** `hrefForStep` transporte automatiquement `simulation_scope=RCT1` **seulement pour Commerce et Finance**. Les autres pages **ne sont pas certifiées compatibles avec ce filtre** : contrôler la référence et les faits via leurs API/propriétaires, consigner « périmètre non certifié » et ne jamais annoncer que RCT1 est isolé sur ces écrans sans preuve. L'authentification Golden vérifie une lecture amont, pas toutes les API.

## 5. Exécution graduée / acceptation

1. **Gel des preuves historiques.** Ne réécrire ni la contre-recette ni les anciens runs ; ne jamais les qualifier de GO visuel.
2. **Préflight lecture seule sur le staging actualisé :** `/health/version`, migrations/flags (dont `ORDER_COST_SNAPSHOT_ACTIVE`), inventaire scope RCT1 et cohorte 30 jours, droits des acteurs et activité réelle sans RCT1.
3. **Rejouer les observations humaines** dans le **Golden existant** (nouvelle piste « RCT1 × P1–P7 »), sur écrans desktop et mobile, sans nouvelles commandes : identifiant commun, état, provenance, captures.
4. **Compléter par les parcours P1–P7 manquants**, sans affirmer que les fixtures indépendantes ont le même ancêtre : sourcing/CJ, PO/Hub Dubaï, trajets CM/CG, P5, clôture cash, revue de prix.
5. **Décider scénario par scénario :** GO / NO GO / NON COUVERT avec motif, propriétaire, prochaine action. Les cas P3 (LOCAL_STOCK vs coût import), conversion D4, J/K, Stripe E2 et flag snapshot restent à confirmer selon version, pas à gommer.
6. **GO global uniquement** si chaîne démontrée par les mêmes références ou lien de provenance explicite, observée sur vrais écrans, API cohérentes, cas négatifs et séparation RCT1/réel prouvés, décision humaine signée. Si blocage : **NO GO limité et documenté**, ne pas inventer de moteur ni purger staging.

**Livrable attendu de la recette :** pour chaque étape, identifiants, acteur, version / période / marché / scope, objectif, attendu indépendant, réponse canonique, observé sur desktop/mobile, capture/URL/trace, écart et criticité, validation humaine, suite. Le Golden conserve seulement ces observations locales ; il n'écrit pas la vérité métier.

## Préalables à la recette Golden (remédiation audit Opus P1–P7)

| Lot | PR | Statut |
|---|---|---|
| D — signaux/tableaux de bord limités au réel (`simulation_scope IS NULL`) | #2800 | fusionnée |
| A1 — contexte marché requis sur le catalogue | #2801 | fusionnée (serveur ; durcissement front boutique bloqué par dette de gates boutique sur main) |
| A2 — exposition ENABLED + prix LOCAL_ACTIVE recontrôlés à l'engagement, panier partagé ancien inclus (lignes figées inchangées) | #2802 | fusionnée |
| B — preuve de livrabilité par marché (attestation centrale ; base historique réservée à KM) | #2804 | fusionnée (0cf71c912, GO Opus) |
| C1 — audit autorité physique de réception hub | #2803 | fusionnée (doc) |
| C2 — couverture physique quantitative avant préparation, PO historiques raccordées à la custody | #2807 | en contre-revue Opus ; non fusionnée sans GO + CI verte |

État d'exploitation constaté (lecture seule) : staging sur le commit c24405533, aucun lot ci-dessus déployé ; `ORDER_COST_SNAPSHOT_ACTIVE=true` sur staging (`stripe_mode: test`) ; production non touchée ; aucun flag modifié.

Préconditions avant la recette Golden :
1. Déployer main sur staging et vérifier le commit via `/health/version`.
2. CM/CG ne sont pas attestés : le checkout les refuse (`MARKET_DELIVERY_NOT_PROVEN`) tant qu'une attestation centrale (transporteur, tarif, preuve, validité) n'existe pas. KM repose sur la base historique (commandes KM réelles collectées) : vérifier ce compte avant déploiement, sinon attester KM.
3. Réception hub (C2, #2807) : la préparation exige une couverture physique quantitative ; `POST /api/purchasing/:id/receive` passe en 410. Dette historique : requête `scripts/diagnostics/order-physical-coverage-exceptions.sql` à exécuter par un humain ; nombre d'exceptions non vérifié ; aucun statut réécrit.
4. Moteur RCT1 inchangé.

## Références conservées

- `docs/recette/RECETTE_STAGING_CADRAGE_EXECUTABLE.md` (hypothèses et cas historiques).
- `docs/recette/RCT1_GUIDE_RECETTE_ECRANS.md` (ancien guide, cases d'observation non remplies).
- `docs/recette/CONTRE_RECETTE_CANONIQUE_STAGING_20261020.md` (preuves SQL datées).
- `docs/doctrine/KOMERCE_CARTOGRAPHIE_PROCESSUS_P1_P7.md` (doctrine processus).
- `docs/doctrine/KOMERCE_NAVIGABILITE_CONTRAT_EXECUTABLE.md` (parcours et retours).
- `public/js/golden-recipe-scenarios.js` (guide humain existant).
