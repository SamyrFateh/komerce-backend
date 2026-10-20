# Komerce — contre-recette canonique, staging (20 octobre 2026)

**Rôle** : registre de contrôle indépendant ; ce document ne constitue ni un GO LIVE ni une validation humaine d'écran.
**Cible** : staging, version applicative `32fde301` constatée sur Railway au dernier contrôle (le SHA utilisé dans un constat humain doit toujours être recontrôlé avec `/health/version`).
**Protection** : lecture seule sur staging pour cet audit. Ni RESET, ni purge, ni paiement réel, ni ordre fournisseur, ni nouvelle publication. Pas de mutation métier par le cockpit de recette.

## 1. Éléments effectivement établis avant cette PR

| Périmètre | Fait observé | Preuve |
| --- | --- | --- |
| Staging technique | Déploiement Commerce #2764 `32fde301`, service Railway SUCCESS et 1/1 réplique | Railway déploiements vérifiés |
| RCT1 scope | Sept commandes RCT1 balisées, zéro référence RCT1 sans scope | [préflight #2765](https://github.com/SamyrFateh/komerce-backend/actions/runs/39460166843) |
| Commerce RCT1 30 jours | 7 commandes créées, 6 payées, 106 390 KMF de ventes payées, panier moyen 17 732 KMF, 7 unités vendues | [préflight SQL #2769](https://github.com/SamyrFateh/komerce-backend/actions/runs/39466340103) |
| Commerce KM (RCT1) | 6 créées, 6 payées, 106 390 KMF, panier 17 732 KMF, 7 unités | Même préflight SQL |
| Commerce CM (RCT1) | 1 créée, 0 payée, ventes 0, panier NULL, unités 0 | Même préflight SQL |
| Commerce CG (RCT1) | 0 créée, 0 payée, ventes 0, panier NULL, unités 0 | Même préflight SQL |
| Hors RCT1, activité réelle | 1 commande créée/payée, 25 000 KMF, panier 25 000 KMF, 1 unité | Même préflight SQL |
| Finance RCT1 | 6 commandes payées, ventes 106 390 KMF, marge consolidée 6 615 KMF (2 commandes « actual ») | [finance-probe #2766](https://github.com/SamyrFateh/komerce-backend/actions/runs/39460172345) |
| Parité, wallet, rendu RCT1 | Unitaires et suite Dashboard canonical de #2764 vertes | [PR #2764](https://github.com/SamyrFateh/komerce-backend/pull/2764) |

Les preuves ci-dessus concernent la base, le calcul ou des simulations de navigateur en CI. **Aucune preuve d'une API admin de staging authentifiée ni capture d'écran staging desktop/mobile n'a encore été constatée dans ce dossier.**

## 2. Parcours fonctionnels décidés, à exécuter dans le Golden existant

Ordre d'autorité : Sourcing → Raffinerie → Atelier des prix → Catalogue global → Marchés KM/CM/CG → Liste/partage → Commande/paiement → Achats fournisseurs → Réception Hub → Groupage/transport/douane → Relais/remise → réconciliation Finance → Pilotage par marché.

Le cockpit `/admin/golden-e2e` porte le guidage **Comprendre → Visualiser → Valider**. Il affiche les écrans sources existants ; il ne réimplémente aucun calcul ou workflow propriétaire. Un fait technique, une observation humaine et une décision d'acceptation sont **trois niveaux distincts**. Une étape bloquée interdit le verdict global GO.

| Domaine | Écran propriétaire de l'observation | Vérification métier | État de preuve |
| --- | --- | --- | --- |
| Sourcing + Raffinerie | `/admin/workspaces/sourcing` + `/admin/import-runtime` | fournisseur, import/run, SKU, catégorie, choix, provenance, date | À constater sur écran |
| Atelier des prix | `/admin/workspaces/pricing` | coût estimé/réel, unités, prix pays, inconnue ≠ zéro, approbation | À constater sur écran |
| Catalogue + pays | `/admin/workspaces/catalog`, `/dashboards/canonical/access.html` | offre globale ≠ exposition locale ; marché autorisé | À constater sur écran |
| Liste/commande/achats | `/admin/commerce`, `/admin/operations`, `/admin/workspaces/purchasing` | engagement/payment, Order 360, PO et preuves fournisseur | À constater sur écran |
| Hub, douane, relais | `/admin/hub-live`, `/admin/workspaces/shipping-customs`, `/admin/relais-live` | unités/colis, traçabilité, frais et remise | À constater sur écran |
| Finance + Pilotage | `/admin/finance`, `/admin/pilotage` | coût réel complet, marge et consolidation par marché | À constater sur écran |

## 3. Matrice des vues et Live

Les cinq **responsabilités de lecture/décision** sont Pilotage, Commerce, Commandes, Opérations, Finance. **Commandes** n'est pas une cinquième application dupliquée : `/admin/orders` redirige vers `/admin/operations` pour ses files, et `/admin/orders/:reference` conserve Order 360.

Les trois cockpits Live sont Sourcing (`/admin/import-runtime`), Hub (`/admin/hub-live`) et Relais (`/admin/relais-live`). Le Live observe les faits propriétaires, sans mutation parallèle.

À contrôler pour chacun : contexte acteur et Market résolus côté serveur, réponse d'API canonique, période, devise et unité, qualité des données, état vide vs zéro confirmé, erreurs visibles, fraîcheur et droits 401/403, liens/retour, captures **1440 / 1024 / 390 px**. La matrice L1–L10 reste une liste de lots correctifs, pas dix dashboards.

## 4. Contrôles opérés par ce lot

- Ajout de deux guides dans le Golden déjà déployé, sans nouvelle surface indépendante : `process` et `dashboards`.
- Empêcher de traiter le SHA *saisi* comme preuve : comparaison à `GET /health/version` avant autorisation d'enregistrer un constat.
- Préserver explicitement `simulation_scope=RCT1` en ouvrant les vues Commerce et Finance depuis un scénario RCT1 ; sur les autres vues, afficher un avertissement de périmètre non certifié.
- Tests unitaires et navigateur simulé : pas de paiement réel, ni fetch de mutation depuis les guides.

## 5. Verdict et suite

- **GO technique pour la réconciliation SQL Commerce RCT1**, sur la période et les périmètres cités.
- **Pas de GO métier / visuel global** à ce stade : API admin authentifiée, parcours humains et captures de staging non observés. Les tests navigateur sur serveur local ou réponses simulées ne prouvent pas le staging.
- Pas de fusion de PR, déploiement, modification de commande, paiement ou publication sans décision distincte.

À chaque étape : attendu → observé → preuve datée → écart classé P0/P1/P2 → décision humaine → étape suivante. Aucune donnée manquante remplacée par un faux zéro ou par un PASS de CI.
