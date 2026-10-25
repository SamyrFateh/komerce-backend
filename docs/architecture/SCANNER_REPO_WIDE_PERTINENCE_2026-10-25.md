# Komerce — Audit de pertinence du scanner sur tout le dépôt Git

**Date : 25 octobre 2026. État : lecture seule et expérimental. Aucun seed ou reset Railway, aucun merge dans main.**

Référence : [GitHub Actions #40193718068](https://github.com/SamyrFateh/komerce-backend/actions/runs/40193718068), main analysé au SHA **10b6408839890a2a7d700aa449a51dd69bac4184**. Le scanner inventorie les fichiers avec git ls-files indépendamment des cartes métier.

## Couverture mesurée sur main

| Mesure | Résultat |
|---|---:|
| Fichiers Git inventoriés | **4 659** |
| Fichiers UTF-8 lus | 4 454 |
| Fichiers non lus | 205 (201 binaires, 3 encodage, 1 trop volumineux) |
| Extensions de code recensées | 3 619 |
| Sources runtime JS/TS/HTML/Vue réellement passées dans les détecteurs | **1 438** |
| Sources runtime absentes des cartes métier | **624** |
| Chemins déclarés par les cartes métier | 2 692 |
| Chemins déclarés absents du Git courant | 266 |
| Tables de gouvernance | 200 |
| Indices SQL textuels fichier/table/opération | 628 |
| Signaux statiques | **162** |

**Limite importante :** tout Git est inventorié, mais l'analyse métier n'est pas exhaustive. Les SQL (326 fichiers), fichiers Shell/Python/PowerShell, documents, images, bibliothèques externes, SQL dynamique, navigation réelle Chromium, tests et chaînes d'appels ne sont pas tous inspectés sémantiquement. Les chemins de gouvernance manquants ne sont pas 266 bugs.

## Classement des 162 signaux

| Type de signal | Nombre | Interprétation |
|---|---:|---|
| Scripts de recette, génération, maintenance, opérations | **126** | Contexte et gardes à vérifier, pas 126 bugs |
| Parcours administratifs / simulation | 16 | Intentions et autorisations à examiner |
| Dettes cross-owner inscrites au registre | 6 | Déjà connues, pas automatiquement des défauts |
| Occurrences des patterns déjà étalonnés | 7 | Correspondent aux cinq bugs connus et à leurs différents sites |
| Autres écritures SQL runtime à investiguer | **7** | Pistes indépendantes, non certifiées |
| **Total** | **162** | **Aucun nouveau bug certifié par ce balayage** |

## Mesure de pertinence

**5 défauts connus sur 5 sont retrouvés**, sur la branche d'audit et sur le SHA main ; **4 contrôles négatifs sur 4** ne sont pas signalés comme écritures SQL directes. Ces contrôles ont participé à la conception de notre scanner : **5/5 n'est pas un rappel aveugle**, ni 4/4 un taux de spécificité représentatif. Le scanner n'a encore aucun taux général de précision ou de faux négatifs mesurable.

L'échantillon automatique de 15 autres signaux a été relu au niveau du code :

- 2 appartiennent à des chaînes de bugs déjà calibrées (Hub/Sourcing et import Catalogue/Sourcing).
- 1 correspond à une délégation de marge connue.
- 1 correspond à une dette connue de projection des quantités de commande.
- 1 correspond au simulateur, dont la route est administrateur + non-production.
- 10 relèvent de scripts de seed, reset staging, démonstration Stripe ou diagnostic de concurrence, non représentatifs d'une écriture commerciale nominale.

**Aucun bug métier inédit démontré dans ces 15 signaux.** Cette sélection stratifiée n'est pas représentative du dépôt entier. Une revue statique n'atteste pas de la sécurité ou de l'absence d'anomalie de ces chemins.

## Les 7 pistes runtime restantes

| Fichier / SQL | Constat | Statut |
|---|---|---|
| bootstrap/crons.js / economic_snapshots | Purge à 90 jours planifiée chaque jour | Rétention plausible ; vérifier doctrine |
| bootstrap/crons.js / pickup_print_tokens | Supprime les jetons expirés | Fonction maintenance attendue |
| bootstrap/crons.js / pickup_reveal_codes | Supprime les jetons expirés | Fonction maintenance attendue |
| bootstrap/crons.js / revoked_tokens | Supprime les JWT révoqués déjà expirés | Fonction maintenance attendue |
| bootstrap/startup-migrations.js / users | Un mot de passe TRANSITAIRE_PASSWORD configuré réécrit password_hash à chaque exécution de migration via ON CONFLICT | **À challenger** : autorité environnement vs rotation manuelle, non prouvé comme bug |
| routes/admin/delete-order-cascade.js / scans | Suppression des scans d'une commande avec SAVEPOINT par opération | **À challenger** : conservation des preuves et atomicité d'appel |
| routes/admin/users.js / scan_events | Détache scanned_by lors d'un hard-delete ; soft-delete pour comptes avec historique | **À challenger** : conservation des audits, erreurs silencieuses |

L'UPSERT du compte transitaire a été vérifié dans le code du chemin startup ; il peut être **voulu** si l'environnement est l'autorité de mot de passe. Ne pas le qualifier de vulnérabilité sans contrat et vraie preuve. Les fonctions administratives n'ont subi aucun test destructeur sur Railway.

## Évaluation

**Points positifs :** couverture des fichiers hors gouvernance, cinq familles de défauts déjà étalonnées détectées sur main, exclusions de faux indices commentés, rapports machine exploitables et traçabilité par SHA.

**Faiblesses :** le ratio 126/162 de signaux d'outillage révèle beaucoup de bruit. La performance hors échantillon reste **non démontrée** ; les détecteurs ne comprennent pas encore tous les processus P1–P7, les dépendances dynamiques ou les parcours frontend Chromium.

**Suite recommandée :** (1) vérifier les trois pistes opérationnelles restantes à haut risque, avec preuve nominale et déviation réelle ; (2) cartographier les callsites et la portée prod/staging ; (3) analyser les 624 chemins runtime non déclarés et les 266 déclarations obsolètes par domaine ; (4) former un corpus aveugle incluant cas sains et vrais bugs inconnus pour mesurer les erreurs. Ne pas modifier les RESET ni les données de production.

## Artefacts GitHub Actions

- audit-results/repo-wide/main : couverture, toutes les alertes et les indices SQL.
- audit-results/repo-wide/audit : même scan sur la branche expérimentale.
- audit-results/repo-wide/evaluation : rappel sur les cinq calibrations, contrôles négatifs et échantillon de 15 signaux.
- audit-results/repo-wide/triage : classification de tous les 162 signaux et les 7 candidats runtime.

La dernière exécution est visible dans GitHub Actions ; aucune des alertes statiques n'est certifiée BUG_REPRODUCED sans vraie preuve de comportement du service et PostgreSQL.
