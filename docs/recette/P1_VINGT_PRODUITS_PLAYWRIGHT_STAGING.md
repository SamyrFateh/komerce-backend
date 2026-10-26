# Komerce P1 — campagne de 20 produits réels dans le staging Railway

> **Périmètre actualisé le 26/10/2026 : DESKTOP UNIQUEMENT (1440 × 900).** Le propriétaire reporte la certification mobile, y compris la boutique mobile. Les captures 390 px antérieures sont historiques et ne comptent pas pour le GO. Les suites Chromium P1 et canonical n’exécutent plus de projet mobile. `launch-p1-twenty.ps1 -Device mobile` renvoie volontairement `MOBILE_CERTIFICATION_DEFERRED_USE_DESKTOP_ONLY`. La certification future du mobile fera l’objet d’une campagne distincte. Les API et règles métier restent identiques.

**But** : 20 identités fournisseur distinctes → Sourcing certifié → Raffinerie / SKU → brouillon Catalogue → fiche et publication globale approuvées → décision commerciale du marché KM, prix **LOCAL_ACTIVE** → exposition **ENABLED** → 20 cartes exactes dans la boutique. Les **mêmes** 20 références traversent chaque frontière, sans second moteur métier.

**Périmètre** : staging Railway uniquement, `KM` d'abord. Pas de RESET, seed SQL fictif, changement direct d'état, paiement, commande, ordre d'achat fournisseur ni changement de règles de gate.

## Baseline réelle établie le 26/10

Audit source [run #40305346670](https://github.com/SamyrFateh/komerce-backend/actions/runs/40305346670), lot AliExpress `KIR-000009` :

| Source / éligibilité | Observé |
| --- | ---: |
| Identités fournisseur importées | 20 |
| Décisions actuellement certifiées TEST | 13 |
| Déjà liées au Catalogue | 9 |
| Encore promouvables | 4 |
| À conserver WATCH | 6 |
| EXCLUDED (ne jamais forcer) | 1 |
| Ready annoncé au moment du run | 12 |
| Ready recalculé après décision tracée | 13 |

La différence `12 → 13` est historique et doit rester visible. Les 20 sources importées **ne sont pas 20 produits publiables**. Le `KIR-000011` a zéro candidat promotable dans cet audit. Il faudra re-sourcer des références supplémentaires si nécessaire (au moins les 7 manquantes si aucune des six WATCH ne devient légitimement éligible).

## Matrice des six étapes Playwright

| Étape | Acteur | Écran réel | Preuve nominale / action humaine |
| --- | --- | --- | --- |
| 01 Sourcing | sourcing E2E, autorité globale | `/admin/workspaces/sourcing` | Cohorte source, décision et preuves; import fournisseur via source enregistrée; promotion uniquement si admissible |
| 02 Raffinerie | sourcing E2E | `/admin/import-runtime` | Import run, état du traitement, SKU et contrats d'origine |
| 03 Catalogue global | admin E2E, autorité catalogue | `/admin/workspaces/catalog` | 20 liens traçables, français vérifié, validation humaine de chaque fiche |
| 04 Catalogue marché KM | market_operator E2E | `/dashboards/canonical/market-catalog.html?market=KM` | Désignation des 20 produits dans la décision pays, sans exposer les exclus |
| 05 Prix local | market_operator E2E | `/admin/workspaces/pricing?market=KM` | Prix KMF local non destructeur, décision explicite, activation LOCAL_ACTIVE |
| 06 Boutique | anonyme | `/boutique/?market=KM` | API `/api/products?market=KM` et les **mêmes 20 IDs** dans les cartes desktop/mobile |

Le code de l'étape marché appelle déjà le service canonique via **Valider produit → Prix local → Activer prix**, sans réécrire les transitions dans Playwright.

### Première passe automatique (aucune écriture)

Créer depuis le propriétaire GitHub une issue portant exactement ce titre :

`[staging-op] p1-twenty-readonly`

Le workflow `.github/workflows/staging-p1-twenty-real-products.yml` :

1. épingle `/health/version` et l'environnement, y compris l'équivalence de runtime prouvée en cas de SKIPPED ;
2. vérifie l'empreinte de la DB Railway staging et ouvre une transaction `BEGIN READ ONLY` ;
3. sélectionne vingt candidats **distincts**, calcule les droits et les états pour chaque produit;
4. confronte les 20 identités à l'API boutique réelle;
5. lance **12 scénarios Playwright** (6 étapes × desktop/mobile), avec captures et raisons d'échec;
6. conserve `cohort.json` et les preuves dans les artifacts Actions.

Le premier run est **censé être NO GO**, tant que les 20 références n'ont pas terminé le processus. Il ne doit jamais les rendre visibles juste pour passer le test.

### Après un nouveau sourcing

Par défaut, l'inventaire part du run `KIR-000009`. Lorsque de vrais nouveaux candidats ont été importés via Sourcing, renseigner au job de recette la liste exacte :

`P1_TWENTY_SOURCE_RUNS=KIR-000009,KIR-000012`

Le registre examine les deux cohortes, choisit **vingt identités fournisseur distinctes** en privilégiant celles avec preuve positive, et laisse les WATCH/EXCLUDED bloquées. Les comptes historiques de chaque run restent immuables. Ne jamais créer un KIR fictif.

## Mode interactif Windows, sur le vrai staging

Prérequis : Node.js, Git, Playwright, `git pull --ff-only`, `npm ci`, `npx playwright install chromium`. Depuis `D:\komerce-backend` :

```powershell
# Inspection STRICTEMENT en lecture seule
.\scripts\recette\launch-p1-twenty.ps1 -Stage sourcing -Mode inspect
.\scripts\recette\launch-p1-twenty.ps1 -Stage raffinerie -Mode inspect
.\scripts\recette\launch-p1-twenty.ps1 -Stage catalogue -Mode inspect
.\scripts\recette\launch-p1-twenty.ps1 -Stage marche -Mode inspect
.\scripts\recette\launch-p1-twenty.ps1 -Stage prix -Mode inspect
.\scripts\recette\launch-p1-twenty.ps1 -Stage boutique -Device desktop -Mode inspect
```

Playwright Inspector s'ouvre sur le véritable écran et s'arrête à `page.pause()`. Les secrets sont saisis masqués ou lus des variables de **processus** et restaurés en fin de script ; rien n'est écrit en .env ou Git.

Quand le propriétaire de la décision a vérifié chaque fiche et son prix :

```powershell
# EXPLICITEMENT MODIFIANT, limité à ce propriétaire métier / KM
.\scripts\recette\launch-p1-twenty.ps1 -Stage sourcing -Mode curate
.\scripts\recette\launch-p1-twenty.ps1 -Stage catalogue -Mode curate
.\scripts\recette\launch-p1-twenty.ps1 -Stage marche -Mode curate
.\scripts\recette\launch-p1-twenty.ps1 -Stage prix -Mode curate
```

Le lanceur exige alors l'accusé de consentement `YES_P1_20_KM_HUMAN_DECISIONS` et expose **uniquement les opérations HTTP P1 canoniques** propres au rôle et à l'écran choisi. Tous les `POST/PUT/PATCH/DELETE` hors liste (commandes, paiement, suppression, wallet, marché CM/CG) restent bloqués. Les APIs backend réévaluent autorisations et règles commerciales.

**Aucun prix n'est inventé par le script :** l'humain utilise l'écran et les propositions métier disponibles, puis confirme la décision. Après chaque lot de gestes, relancer l'audit sans écriture pour confirmer ce qui a vraiment changé.

### Registre de 20 références

Depuis l'artifact du workflow, placer le fichier `cohort.json` dans `test-results/staging-p1-20/cohort.json` pour comparer les mêmes identités en local. **Ce fichier est une preuve de contexte** et ne contient aucun mot de passe. Les dossiers `test-results/` ne sont pas versionnés ; les captures peuvent contenir des données staging, ne pas les coller dans une issue publique.

Chaque entrée comporte : `candidate_ref`, `supplier_product_id`, `source_run_ref`, `product_ref`, `product_id`, statut source, exposition KM, prix local, présence API, et `gate.blockers[]`.

### Conditions de GO

- 20 identités fournisseur et 20 produits globaux distincts avec filiation prouvée.
- 20 décisions source certifiées, fiches globales approuvées et actives.
- 20 prix locaux **LOCAL_ACTIVE** et expositions **ENABLED** vérifiées par autorité KM.
- Exactement les mêmes vingt `product_id` dans l'API du marché et les cartes de la boutique desktop. La boutique peut contenir d'autres produits : ils ne remplacent pas ceux du manifeste.
- État vide nominal et produit bloqué non exposé conservés en tests négatifs.
- Aucune commande ni fournisseur réellement engagé.
- Validation humaine des décisions et publication de l'artefact attendu/observé; sinon **NO GO ou NON COUVERT**, jamais « 20 produits » fictifs.

Réfs : [campagne #2988](https://github.com/SamyrFateh/komerce-backend/issues/2988), [catalogue vide #2985](https://github.com/SamyrFateh/komerce-backend/issues/2985), `docs/recette/STAGING_CANON_LIFECYCLE.md`.
