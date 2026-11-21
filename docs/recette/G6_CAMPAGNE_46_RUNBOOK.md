# Campagne G6 des 46 scénarios : runbook de lancement

Ce document permet à **n'importe quel agent** (GPT, Opus, Sonnet) ou au propriétaire de rejouer la campagne seul, sur le même SHA, et de comparer ses résultats.

- Source métier unique : `docs/recette/G6_PRE_STRESS_BUSINESS_SCENARIOS.json`.
- Suivi : issue #4550 et `docs/chantier/STATUS.md`.

## 1. Règles non négociables
- **Staging uniquement**, sans production, sans PSP réel et sans fournisseur réel.
- **Gestes humains dans Chromium**, depuis l'écran du rôle concerné.
- **API** : seulement pour une réponse externe sans écran (fournisseur simulé, webhook PSP simulé) et pour une sonde négative signalée `API_PROBE_NO_SCREEN_GESTURE`.
- **PG** en lecture seule, comme oracle. Seule exception : les fixtures d'identité.
- **Un écran manquant est un FAIL** (`SCREEN_MISSING_*`), jamais un contournement.
- **Lancement** : seul le propriétaire du dépôt peut lancer un run, en ouvrant une issue dont le titre est exact (gardes propriétaire, SHA et identité Railway).

## 2. Lancer un scénario
Ouvrir une issue intitulée :

`[staging-op] g6-dynamic-fresh-full-<ID>-<MARCHÉ>`

- `<ID>` : M01, M02, M03, M06, ou N01 à N40.
- `<MARCHÉ>` : KM, CM ou CG.

Exemple : `[staging-op] g6-dynamic-fresh-full-N23-CM`.

| Rôle | Fichier |
|---|---|
| Workflow | `.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml` |
| Orchestrateur | `scripts/recette/g6-dynamic-buyer-cash.js` |
| Séquences | `scripts/recette/canonical/stage-registry.js` |

En fresh, M01 sur CM ou CG est catalogué M04 ou M05.

### Contraintes d'enchaînement, apprises en campagne
1. **Un seul run à la fois.** Le workflow n'a qu'un groupe de concurrence (`komerce-g6-canonical-real-transaction`). Un run *en attente* est remplacé par le suivant et finit `cancelled`, sans job. Attendre la fin d'un run avant d'ouvrir l'issue suivante.
2. **Un run `cancelled` sans aucun job** (annulation à vide par GitHub) se relance par `POST /actions/runs/<id>/rerun`.
3. **Pas de fusion sur `main` pendant un run.** Le run s'arrête alors sur `G6_DYNAMIC_STAGING_SHA_DRIFT`. Attendre que le SHA servi (`/health/version`) égale `main`.
4. **N23** verrouille l'agent relais E2E pendant 15 minutes. Attendre au moins 16 minutes avant tout autre scénario qui utilise le relais.
5. **N13** laisse un reliquat fournisseur ouvert, qui se regroupe avec la commande suivante du même SKU. Lancer `g6-cleanup-recette-apply` avant de rejouer M01, N14 ou toute chaîne import sur le même marché.
6. Les scénarios négatifs laissent des commandes ouvertes. Nettoyer en fin de lot (§ 4).

Le script `scripts/recette/ops/g6-run-scenario.sh` fait l'équivalent : il ouvre l'issue, attend la fin du run, relance une annulation à vide, puis extrait le verdict.

## 3. Prérequis de données (à vérifier avant tout run)

| Besoin | Commande (titre d'issue) | Remarque |
|---|---|---|
| Sonde en lecture seule | `[staging-op] g6-prereq-probe-<MK>` | Sources par fournisseur, stock local exposé, second relais (N21/N22). Rend `M03_READY` ou `M03_MISSING:<quoi>`. |
| Stock local (M02, N04, N09, N21 à N24, N29) | `[staging-op] g6-local-stock-declare-<MK>` | Écran W3 du `market_operator` : +10 unités, puis « Exposer ». Ne prend **jamais** KPR-000165 (produit M01) et masque son stock local s'il est exposé. |
| Produit central Hub (M03, M06, N34) | `[staging-op] g6-central-hub-product-<MK>` | **Bloqué** à la certification Catalogue : écran d'image et doctrine du contrat source en attente de GPT. |
| Comptes E2E | `staging-e2e-provision.yml` | Confirmation `PROVISION-STAGING-E2E`. |
| Remise à zéro de l'activité | `staging-reset.yml` (scope `activity`) | Confirmation `RESET-STAGING-BUSINESS-DATA`. Préserve catalogue, prix et médias, puis reprovisionne les comptes E2E. Uniquement sur GO du propriétaire. |

## 4. Nettoyage
1. `[staging-op] g6-cleanup-recette` : plan, en lecture seule.
2. `[staging-op] g6-cleanup-recette-apply` : gestes écran.
   - Classes A et B : brouillon écarté, ligne puis commande annulées.
   - Classe C : PO de recette annulé.
   - Classe D payée et disponible : **vraie remise au comptoir** (`handover_relay`).

Ce que le nettoyage ne sait pas encore clore (`SCREEN_MISSING`, écrans demandés à GPT) :
- commande dont le sac est dans une KOM-BOX figée (« Solder la recette (KOM-BOX figée) ») ;
- incident d'écart de réception N20 ;
- expédition N16 remise au transitaire.

## 5. Lire un verdict
L'artefact du run contient `test-results/` :
- `g6-dynamic-buyer-cash/report.json`, le verdict global ;
- `g6-negative-<ids>/report.json` : `attempts`, `probes`, `gaps`, `ux_signal`, `steps_reached` ;
- les traces, captures et le journal réseau de chaque étape.

| Verdict | Sens |
|---|---|
| `G6_<ID>_..._PASS` | Conforme, prouvé en PG. |
| `PRODUCT_GAP_<ID>` | **Défaut produit réel**, à corriger côté produit. |
| `SCREEN_MISSING_*` | Écran absent, compté FAIL. |
| `PREREQ_MISSING_*` | Donnée de test manquante (§ 3). |
| `BLOCKED` ou `NOT_PROVEN` | Le runner n'a pas conclu. Lire `err` et `child_error` avant toute conclusion. |

## 6. Dernier état connu côté Opus (21/11, 11h)

| Statut | Scénarios |
|---|---|
| **PASS sur KM, CM et CG** | M01 (M04, M05), M02, N04, N07, N09, N11, N12, N13, N14, N16, N17, N20, N23, N24, N29, N33 ; N28 (KM et CG, CM en cours) |
| **PRODUCT_GAP** (à corriger côté produit) | N15 : expédition vide créée en 201 (#4550, commentaire 7059719837). N21, N22, N32 : `GET /api/orders/:id` et `:ref` divulguent la commande d'autrui à un client et à un agent relais (commentaires 7057245307 et 7061005484). **Priorité 1.** |
| **Montés, à jouer** | N18, N19 (corrigés par #4922), N25, N26a, N26b, N27, N30, N31, N35, N36, N37, N38, N39F1, N39F2, N39F3, N40 |
| **Montés ou en fin de montage (lot G5A)** | N08, N10 (#4918) ; N01, N02, N03, N05, N06 |
| **Bloqués par le produit** | M03, M06, N34 : le produit central Hub ne peut pas être certifié par l'écran (image et contrat source, #4550) |

**Verdicts prévisibles d'après le code**, à confirmer par un run :
- `SCREEN_MISSING` : N26a (remboursement de ligne), N26b (décision de compensation), N27 (annulation de reliquat), N39F1 si le bouton Annuler est absent.
- `PRODUCT_GAP` : N39F2 (pas de « demande admin » après engagement), N40 (prix fournisseur à +10 % accepté), N30 (commandes de recette comptées dans les KPI, **arbitrage du propriétaire**).
- `NOT_PROVEN` partiel, documenté dans le rapport : N38 (panne post-commit non injectable), N35 (plancher et N3 non persistés), N31 (jambe remboursement), N10 (doublon signé : pas de secret PSP).

**Pour reprendre** : jouer la ligne « Montés, à jouer » scénario par scénario sur KM, puis CM, puis CG, en respectant le § 2. Faire le nettoyage (§ 4) en fin de série. Après les correctifs produit, rejouer N15, N21, N22 et N32.

Le détail des runs et des PR est dans #4550 (synthèses de lots) et dans STATUS.md.

## 7. Porte de préparation des 46 scénarios (audit du 21/11, 15 h 52 Paris)

**Séparer impérativement trois états :** `DISPATCH_WIRED` (titre propriétaire routé vers le bon scénario), `PREREQ_READY` (fixture et SHA staging vérifiés), puis `CHROMIUM_PG_PASS` (gestes et oracles réellement observés). Le premier ne prouve jamais les deux derniers.

- **Matrice : 46 IDs métier**, exactement M01–M06 et N01–N40. La validation automatisée `tests/unit/g6-46-workflow-dispatch-readiness.test.js` contrôle la matrice contre le workflow et le sélecteur réellement transmis au runner, évitant notamment un titre accepté qui lance silencieusement `M01`.
- **44/46 IDs ont un lancement technique explicite après la correction N39** (PR G6-readiness à fusionner après CI). M04 = M01/CM et M05 = M01/CG ; N26 exige N26a **et** N26b ; N39 exige N39F1, F2 **et** F3 ; N03 et N05 ont chacun une sous-branche supplémentaire à jouer lorsque la fixture correspond.
- **2/46 ne sont pas techniquement raccordés** : **M06** et **N34** ; les deux dépendent du produit Fournisseur central Hub que l'on doit créer, illustrer, certifier et publier par écran, sans SKU/SOI ni vendeur inventés. Un clic direct sur un alias M01 n'est pas une substitution admissible à ces objectifs.
- **M03** est *routé* mais son exécution exige le panier mixte à trois sources, dont la source Hub ; conserver `PREREQ_MISSING` sans cette preuve.
- **Sécurité P0 à corriger et recertifier** : N21/N22 (droit du relais), N32 (confidentialité de commandes client et marché). **Métier P0** : N15 (expédition vide malgré sac/carton incomplet). Ces cas peuvent être joués pour diagnostiquer ; ils ne peuvent être comptés PASS tant que le comportement et le rejeu ne sont pas conformes.
- **Autres limitations déjà identifiées** : N26a/N26b/N27 et N39F1/F2 (écran ou décision manquants selon runbook) ; N10 doublon signé sans secret PSP ; N30 arbitrage de KPI ; N31/N35/N38 preuve partielle. Il faut noter `SCREEN_MISSING`, `PRODUCT_GAP` ou `NOT_PROVEN`, **jamais** les camoufler par un test API.
- **G5A** : N01/N02/N03/N05/N06 intégrés par #4959 et N08/N10 par #4918 ; **CI verte ≠ runs staging certifiés**. N06 est isolé : modification du prix actif puis restauration contrôlée par l'écran, contrôle de concurrence ; un échec de restauration est un STOP avec réparation manuelle avant le scénario suivant.

**Séquence de GO** : 1) toutes les PR correctives fusionnées et `Required verdict` vert, 2) vérifier `/health/version`, identité PG et absence de run concurrent, 3) lancer les trois probes `g6-prereq-probe-{KM,CM,CG}` **par le propriétaire** pour inventaire lecture seule, 4) démarrer un seul scénario à la fois (marché KM, puis CM, puis CG) avec preuve exportée et tableau de verdicts dans #4550, 5) réévaluer la porte après chaque correction. Ne jamais déclencher un reset, une suspension de marché ou un changement de prix sans les protections et autorisations prévues.

**Environnement :** l'accès du connecteur Railway dans cette session ne montre pas le service staging canonique derrière `komerce-backend-production.up.railway.app`. L'état déployé exact et les secrets ne sont donc pas attestés par cet audit de dépôt. Il faut une preuve du workflow owner-only avant de conclure `PREREQ_READY`.


## 8. Compatibilité fournisseur central Hub après #4920 (21/11)

**#4920 est fusionnée dans main** (catalogue, ImageKit, contrat source V2 `central_hub_manual`) avec CI/Chromium **locaux**. Ce changement lève une barrière de code, pas une preuve de disponibilité de la source 3/3 sur Railway staging.

Le workflow owner-only `[staging-op] g6-central-hub-product-{KM|CM|CG}` prépare **uniquement une fixture source** depuis les écrans, sans valider à lui seul M03/M06/N34 :
1. **Import manuel** : le fournisseur central est choisi par l'écran ; le JSON contient le nom du produit, poids/dimensions/coût, **jamais `supplier_product_id`, `sellable_units` ni une identité de vendeur inventée**. La reprise PG cherche le candidat exact par nom, fournisseur système et contrat V2 valide.
2. **Photographie canonique** : le produit est encore inactif ; l'admin ouvre son dossier Catalogue et utilise le nouveau champ `[data-catalog-media-upload-file]`, puis le bouton `Téléverser l'image`. Le serveur transfère vers ImageKit et inscrit le média canonique, sans injection directe d'URL dans SQL/API. À chaque étape, une seule mutation par geste et un nouvel état PG.
3. **Fixture réelle indispensable** : une photo ou illustration fidèle du **coffret de tournevis G6** doit être ajoutée au dépôt par le propriétaire avec les droits nécessaires. Deux variables GitHub Actions **non secrètes** doivent ensuite être renseignées : `G6_CENTRAL_MEDIA_IMAGE_FILE` (chemin relatif au dépôt, même SHA que le run) et `G6_CENTRAL_MEDIA_IMAGE_SHA256` (somme SHA-256 en 64 hex). Si l'image n'est pas présente/épinglée/valide, `PREREQ_MISSING_CANONICAL_PRODUCT_IMAGE` : **aucun nouveau candidat n'est importé**. N'utiliser ni screenshot d'écran ni image générique trompeuse.
4. **Suite normale** : données éditoriales FR, classement, approbation Catalogue, prix du marché `LOCAL_ACTIVE`, exposition, relecture PG de la vérité physique/SKU. La source central Hub n'a pas de *SKU vendeur* ; le checkout doit toutefois prouver sa propre voie de sélection du produit, sans créer un SKU fournisseur fictif pour satisfaire artificiellement le harnais.
5. **Reprobes** : après une exécution réussie du workflow produit et la stabilisation du SHA Railway, rejouer séquentiellement `g6-prereq-probe-KM`, puis CM, puis CG (PG read only) ; exiger `M03_READY` et la preuve d'un `source_key='central_hub'` **effectivement importable**. Les runs précédents KM #44916869049, CM #44917011664, CG #44917097696 montrent seulement 2 sources import et aucun produit central.

**Porte globale inchangée : 44/46 dispatchs déclarés et vérifiés automatiquement**, mais **M06 et N34 sont NOT_BOUND**. La fixture Hub rendra possible l'écriture de leurs tests dédiés (chaîne M06 multi-acteurs avec justificatif d'achat + N34a/N34b sans dette fournisseur fictive) ; elle ne constitue pas ces tests à elle seule. Les verdicts P0 N15/N21/N22/N32, et les limites N10/N26/N27/N30/N31/N35/N38/N39/N40 restent à traiter comme indiqué au §6/7.

**Protocole de lancement** : pas de reset automatique, pas de mutation du prix N06 en parallèle, pas de fusion `main` en cours de run. Deux niveaux de preuves distincts : CI locale / préflight pour la préparation, puis staging Chromium + PostgreSQL avant le `PASS` métier.

