# KOMERCE — Certification Chromium réelle sur staging et marchés

**Statut : harnais Chromium en lecture seule, pas un GO métier P1–P7.**

## Pourquoi nos précédents tests verts ne suffisaient pas

Le gate Playwright historique des dashboards sert des API simulées. Il vérifie des
contrats et des composants, mais ne certifie pas les comportements réellement déployés :
menus, sous-menus, navigation, données, filtres, droits et actions utilisateur.

Le nouveau gate navigue sur le véritable staging Railway en Chromium, avec de
vraies sessions, sans mock API, à 1440 × 900 et 390 × 844. Il vérifie la
révision réellement servie via /health/version et la confronte au HEAD main du run.

## Lancer sans poste local

Workflow GitHub Actions : staging-canonical-chromium-audit.yml.
Lancement manuel avec roles=admin (première baseline) ou roles=all (sept rôles).
Autre déclencheur : une issue créée par le propriétaire et intitulée
[staging-op] canonical-chromium-audit.

Chaque profil requiert deux secrets GitHub E2E_ROLE_EMAIL et E2E_ROLE_PASSWORD
avec ROLE dans ADMIN, MARKET_OPERATOR, FINANCE, SOURCING, AGENT_HUB,
AGENT_RELAIS, AGENT_TRANSITAIRE. Les comptes doivent être dédiés au staging.
Absence d'identifiant = échec explicite, jamais test ignoré considéré vert.
Les identifiants ne sont ni journalisés ni inclus dans les artefacts.

Le hostname d'audit est exclusivement komerce-backend-production.up.railway.app,
identifié dans Railway comme service de l'environnement staging.
Le nom du domaine ne dispense jamais de contrôler sa véritable identité.
Aucune écriture métier : les méthodes HTTP API non-GET sont bloquées,
hormis la connexion. Jamais de RESET, seed, purge ou paiement réel.

## Deux certifications à ne pas confondre

1. L5 Chromium lecture seule : rôle, session, menu N1/N2/N3, vrais clics,
routes, retour, responsive, réseau, exceptions JS, versions, comparaison de
la navigation observée avec les routes du référentiel ; contexte KM/CM/CG/DJ.
2. E2E métier isolé : fixture de référence commune, transitions P1–P7,
sources SQL canoniques, payload API, écran propriétaire, résultats attendus,
cas négatifs, idempotence, séparation RCT1/réel, nettoyage sélectif.

Seule la phase 1 est amorcée par ce harnais. Les cellules de la seconde
sont intentionnellement NOT_PROVEN, jamais PASS.

## Matrice complète à certifier pour chaque marché

| Dimension | Preuves requises |
|---|---|
| Lifecycle | PROVISIONING, readiness, ACTIVE, SUSPENDED, CLOSED terminal |
| Délégation | équipe, invitations, capabilities, scopes et accès trans-marché interdits |
| Catalogue P1 | sourcing, raffinerie, produits, exposition par pays |
| Prix P1/P6 | LOCAL_ACTIVE, FX gouverné, KMF/XAF/DJF, marge estimée/réelle |
| Commande P2 | éligibilité catalogue, prix local figé, paiement, remise |
| Achat P3 | besoins réels, PO fournisseur, paiement, réception physique |
| Logistique P4 | Hub Dubaï, lot, douane, transport, relais et remise |
| Cash P5 | encaissement, custody, dépôt, rapprochement, settlement |
| Pilotage P6/P7 | KPI propres à chaque marché, isolation des périodes et devises |

Pour chaque ligne : rôle × marché × viewport × objet de référence ×
source canonique × payload API × écran × clic/transition × retour × preuve.
L'accès refusé correctement par une capability serveur n'est pas un bug ;
un accès permis à un autre marché est critique P0.

## Résultat et méthode de correction

Le workflow archive : rapport Playwright HTML, traces, screenshots,
JSON par profil, navigation-graph.json, findings.csv, rapport.md,
markets-processes-matrix.csv. Même lorsque la recette est rouge.

D'abord figer la carte réelle et identifier les anomalies. Ensuite regrouper
par cause racine, corriger par PR ciblée, rejouer les mêmes cas. On ne valide
pas un parcours uniquement parce que la CI a réussi des mocks.

**GO global** seulement lorsque les sept processus P1–P7 sont réellement
prouvés sur les marchés applicables avec données propriétaires, vrai navigateur,
droits serveur et retours, plus cas négatifs et vérification humaine.
