# Certification transverse — Achats fournisseurs → Hub → Contrôle → Emballage
_Date : 2026-11-01. Référence de départ : main 930373243b188b3b0c02cb9a48199f7b5952b464._

## Verdict à ce jalon
**GO borné pour la visibilité des PO en attente et la complétude physique testée. NO-GO pour une certification métier complète de bout en bout en environnement réel.**

Ne pas confondre : la réussite de suites Jest/Chromium simulées confirme des contrats isolés ; elle n'atteste ni l'état des données Railway ni la capacité d'un opérateur à réaliser tous les scans, contrôles et emballages depuis une session réelle.

## Références et assertions vérifiables
1. **Besoin d'achat** : `services/purchase-line-snapshot.js` relie `purchase_lines` à `order_item_id`, `purchase_order_id`, SKU fournisseur et `procurement_hub_ref`. Le regroupement peut englober plusieurs commandes/marchés ; ne jamais supposer qu'une PO correspond à un seul marché.
2. **PO active et expédiée fournisseur** : `public/dashboards/canonical/js/purchasing-workspace.js` affiche désormais `shipped` dans « Ordre d'Achat en Cours » avec le libellé « Expédiée par le fournisseur ». `hub_received` est réservé à l'historique après preuve de réception.
3. **Réception Hub** : `services/hub-receivable.js` lit `v_purchase_line_progress` et fournit par PO et SKU les quantités attendues/reçues/restantes, même pour `shipped`. `services/hub-operations.js` reçoit les unités et déclenche l'évaluation de complétude après écriture physique. La quarantaine ne déclenche pas de complétude.
4. **Clôture et commande client** : `services/purchasing-completion-service.js` clôture une PO `shipped` uniquement si toutes les quantités physiques éligibles sont reçues ; l'ordre client ne passe en `preparation` que si la couverture de ses articles est complète (la transition est régie par `order-status-machine`).
5. **Lecture Hub** : `services/hub-dubai-projection.js` fournit les réceptions attendues et les comptes d'unités. Il signale explicitement comme « source absente » les expéditions prêtes et le groupage transport, au lieu d'inventer des zéros.
6. **Contrôle et emballage** : `services/hub-operations.js` autorise des états physiques `RECEIVED → IDENTIFIED → QUALITY_CHECKED → LOCATED → ALLOCATED → PICKED → PACKED → DISPATCHED`. Les états de sortie exigent un `MARKET_PARCEL`. Les opérations `SPLIT / MERGE / REPACK` ont une identité physique et un historique de custody.
7. **UI opérateur incomplète** : le parcours `/admin/hub-live?view=execute` expose réception fournisseur, commandes, répartition, expédition et affectation inventaire via `operations-workspace.js`. Le contrôle qualité et l'emballage unitaires ne sont pas réunis dans une file opérateur traçable sur cette surface. C'est un manque UX à résoudre, sans dupliquer la machine physique.
8. **Incidents et propriétaire** : `services/logistics-control-chain-projection.js` produit des signaux et causes conservatrices, avec références de commandes et fraîcheur. L'affichage effectif d'une anomalie PO sur tous les dashboards n'est pas encore validé avec un incident réel.

## Cas de certification — preuves obligatoires
| Cas | Résultat attendu | Niveau de preuve |
| --- | --- | --- |
| PO envoyée puis `shipped` | Reste en cours côté Achats ; apparaît comme attendue côté Hub | Jest + Chromium simulé sur la PR |
| Réception 8/10 | Affichage 8 reçus, 2 restants ; ni `hub_received` ni `preparation` | Jest service + tests PostgreSQL déjà présents |
| Réception complémentaire 2/10 | Fermeture `hub_received`, passage de commande éligible à `preparation`, conservation du lien order-item/PO | Jest service ; test transactionnel réel à revalider |
| Sur-réception/identité fausse/casse | Quarantaine, incident, aucune complétude comptée | Tests Hub physiques déjà présents ; propagation dashboard non démontrée |
| Contrôle qualité → emballage | Preuve par unité (acteur, horodatage, custody, nouveau colis, Market, filiation) ; aucune avancée silencieuse | **NON CERTIFIÉ de bout en bout via dashboard** |
| PO multisource/multimarché + incident | L'incident suit les commandes individuelles, sans mélange des marchés ni double comptage | **À CERTIFIER** |
| Livraison transitaire → relais | Les références, suivis, volumes, frais et incidents restent liés au colis expédié | **HORS DU JALON** ; ne pas déduire de l'UI actuelle |

## Conditions pour annoncer la certification complète
- Exécuter sur PostgreSQL jetable les scénarios réels (mocks uniquement pour fournisseurs externes), puis au moins une recette Chromium du Hub connecté à ce serveur de test.
- Vérifier le passage aller/retour de **la même** PO, `purchase_line`, `order_item`, unité physique, colis et commande 360 ; incident et responsable visibles, jamais une ligne perdue.
- Scanner réception partielle, écart, quarantaine/résolution, contrôle qualité, emballage, expédition ; vérifier impossibilité de sauter les étapes.
- Vérifier rôles `admin`/`agent_hub`, isolation des marchés et idempotence sur doubles scans.
- Capturer les preuves de tests et la réponse de santé/SHA de staging. **Ne pas certifier sur la seule base de jeux de données simulés.**

## Reste à développer séparément
- Hub Live : file opérateur « À réceptionner / À contrôler / À emballer / Prêt à expédier » (lecture/gestes strictement gouvernés par les services physiques existants).
- Liens transverses PO → commande(s) → allocation(s) → unité(s) → colis et retour, y compris pour PO regroupées multi-marchés.
- Incident : propriétaire, criticité, prochaine action, horodatage, source et visibilité cohérente dans Achats, Hub, Commandes 360 et À traiter.
- Le passage de l'ordre en `preparation` sur réception complète ne prouve **pas** que les unités ont passé `QUALITY_CHECKED`. Aucun dashboard ne doit présenter ce statut comme « contrôlé » ou « prêt à expédier » sans preuve physique distincte.

_Le présent document décrit des constats de code et des critères de certification ; il ne certifie pas un parcours connecté en production._
