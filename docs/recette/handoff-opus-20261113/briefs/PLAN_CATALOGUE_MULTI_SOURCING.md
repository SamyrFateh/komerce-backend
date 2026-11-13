# PLAN — catalogue multi-sources KM / CM / CG (phase A, lecture seule, 13/11/2026)

Base lue : `origin/main` @ 255e5a7 (sans checkout). Staging lu en GET public uniquement (`/api/health` : v10.6.1, env staging). Aucune écriture.

## 1. État constaté du staging
- `GET /api/products?market=KM` : 3 produits (KPR-000099/100/101, vêtements). CM : 0. CG : 0.
- Connecteurs fournisseurs : non lus (GET authentifié `/api/admin/sourcing-workspace/sources/catalog` = rôle sourcing/admin, identifiants réservés à la phase B). Variables présentes (noms seuls, selon le brief) : CJ_API_KEY, ALIEXPRESS_*, EBAY_*, ALLEGRO_SANDBOX_*.
- À relever en tout début de phase B (GET) : `/sources/catalog`, `/catalog-suppliers`, produits catalogue déjà importés/curés (chantier catalogue ~500) et leur fournisseur.

## 2. Chaîne métier et rôles (par geste)
| # | Geste | Endpoint / écran | Rôle |
|---|---|---|---|
| 1 | Import fournisseur réel (CJ/AliExpress/eBay/Allegro) ou réutilisation de produits déjà curés | Workspace Sourcing, `POST /api/admin/sourcing-workspace/imports` (+ `/sources/:ref/import-now`, candidats `/candidates/:ref/promote`) | `sourcing` ou `admin` + autorité globale sourcing (`requireSourcingGlobalAuthority`) |
| 2 | Produit manuel porté par le Fournisseur central Hub | Écran Sourcing « Import manuel » → `POST .../imports` avec `source_type:'manual'`, `supplier_id` = fournisseur `system_key='central_hub'` (listé par `GET .../catalog-suppliers`, présélectionné par l'UI ; créé à la volée par `ensureCentralHubSupplier`). Corps = tableau JSON d'items. | `sourcing` / `admin` |
| 3 | Catégorie boutique / promotion candidat → catalogue | `/candidates/:ref/confirm-boutique-category`, `/promote` | `sourcing` / `admin` |
| 4 | Brouillon de prix marché (moteur économique, plancher) | `POST /api/admin/pricing-workspace/market/:code/products/:ref/local-price` (`price-preview` avant) | CM/CG : responsable pays (`claude-par-cm/cg-market-operator`, capability `pricing.decide`) ; KM : compte `claude-par-market-operator` (creds.json), admin en dernier recours si la doctrine l'exige ; admin accepté seulement via `requireCatalogPriceCapability` (rôle admin vérifié en base) |
| 5 | Activation LOCAL_ACTIVE + exposition ENABLED | `.../local-price/activate` (exige `pricing.activate` + `catalog.expose`) : pose l'exposition ENABLED dans la même route via `marketDelegationCatalog.setExposure`. Lecture préalable `.../activation-preview`. Alt. exposition seule : `PUT /api/market-delegation/markets/:code/catalog/exposure/:productId` | idem étape 4 |
| 6 | Stock local vendable | Writer canonique W3 (en cours, autre agent, après fusion) : `POST /api/markets/:code/local-stock/receipts`, `location` liée au relais `CLAUDE-PAR Relais <code>`, justificatif obligatoire, + route d'exposition. Ne JAMAIS utiliser `setLocalStock` en script. | responsable pays du marché ou admin |
| 7 | Vérification | `GET /api/products?market=<code>` (≥4 produits) ; `/api/local-stock/availability?product_id=&market=` | public |

Visibilité publique (`publicCatalogVisibilitySql`) exige : produit actif et disponible, sans `catalog_product_sale_holds` ouvert, `product_ref` hors préfixes exclus, image canonique non synthétique, unité vendable, revue visuelle FR des médias sourcés (`catalog_media_visual_fr_reviews` pour tout candidat `imported_to_catalog`), **plus** exposition ENABLED et `product_market_price_drafts.status='LOCAL_ACTIVE'` pour le marché. Les produits manuels doivent donc avoir une image https et une unité vendable valides dès l'import.

## 3. Risques / blocages prévisibles
- **R1 (bloquant probable)** : `setLocalStock` / `setLocalStockExposure` (services/local-stock-service.js) ne sont appelés par aucune route ni écran sur main ; seuls des scripts (`scripts/recette/rct1`, `apply-manual-discovery-content.js`) et des INSERT de tests les utilisent. `/api/local-stock` n'expose que `availability` et `checkout-preview` (GET). De plus `local_stock` est clé `(product_id, market_id, location)` avec `location` texte (défaut `KM_MAIN`) : il n'est **pas rattaché au relais** `CLAUDE-PAR Relais <code>`. Le brief « stock local dans le relais » n'a donc pas de writer canonique côté UI/HTTP. Aucune insertion SQL permise : décision Opus requise (ajouter un writer gouverné, ou autoriser l'usage d'un script canonique `setLocalStock` côté serveur, ou clarifier la source de vérité). Rapporter sans corriger.
- R2 : exposition `local_stock.commercial_exposure` (défaut non vérifié) distincte de `product_market_exposure` ; `isStockExposable` exige ENABLED + quantité disponible.
- R3 : plancher du moteur économique peut bloquer l'activation d'un prix (CM/CG tarifs transport RECETTE provisoires) : noter en constat, ne pas contourner.
- R4 : le rôle `admin` n'a le droit de décider un prix pays que par la dérogation « catalogue pays » ; pour CM/CG préférer le responsable pays. Vérifier que `claude-par-cm/cg-market-operator` détiennent `pricing.decide`, `pricing.activate`, `catalog.expose` (sinon blocage droits, 2 essais max).
- R5 : un redéploiement staging (fusions W1/W2) peut interrompre une session ; attendre « GO phase B ».
- R6 : produits manuels sans image/visuel FR valides resteront invisibles malgré LOCAL_ACTIVE.
- R7 : `local-relay-receipt` et retrait (M02/M03) dépendent d'un relais `CLAUDE-PAR Relais <code>` actif avec agent ; ne toucher aucun relais préexistant.

## 4. Séquence cible phase B (par marché ; 4 produits ≥ 3 sources dont 1 manuel Hub)
1. GET d'état (sources, fournisseurs, produits curés réutilisables) ; choisir 3 produits de vrais fournisseurs distincts (réutiliser l'existant curé en priorité) + 1 produit manuel Hub. Même jeu de 4 produits possible pour KM, CM, CG (prix par marché).
2. Sourcing : import (ou réutilisation) + manuel Hub ; marqueur `CLAUDE-PAR-20261113` dans `notes`/description autorisés ; promotion au catalogue.
3. Pour chaque marché : price-preview → local-price (brouillon) → activation-preview → activate (LOCAL_ACTIVE + ENABLED) par le responsable pays.
4. Stock local : selon décision Opus sur R1.
5. Preuves : Playwright 1440 px, un contexte par rôle, `recordVideo`, sous `scratchpad/catalogue-ms/` ; `rapport.json` par marché ; commentaire #3927 (REST `gh api`, tableau marché × produit × source × prix × stock × preuve).

## 5. Objets à créer (marqueur `CLAUDE-PAR-20261113`)
Par marché : 4 prix `LOCAL_ACTIVE` + 4 expositions ENABLED (produits partagés) ; ≥1 fiche manuelle Hub (produit partagé, créée une seule fois) ; lignes `local_stock` selon R1. Aucun produit, prix, stock ou relais existant n'est modifié ; aucun corridor ouvert.

## 6. Questions pour Opus avant GO phase B
1. R1 : quel writer canonique pour le stock local ? (aucun n'existe en HTTP/UI)
2. Lien stock ↔ relais `CLAUDE-PAR Relais <code>` : `local_stock.location` suffit-il (M02/M03) ?
3. Admin accepté pour le prix KM, ou agent KM dédié ?

## 7. Réponses d'Opus (reçues après la phase A) — plan mis à jour
- R1/Q1/Q2 résolus : stock local via le writer W3 (`POST /api/markets/:code/local-stock/receipts`, location liée au relais, justificatif obligatoire, route d'exposition), uniquement après sa fusion. `setLocalStock` en script interdit. Phase B étape 4 dépend de cette fusion ; en attendre l'annonce.
- Q3 résolu : prix KM par `claude-par-market-operator` (creds.json) ; admin seulement en dernier recours.
- **Pas de GO phase B** à ce stade (attente fusions W1, W2, W3).

### Critères de visibilité publique à valider produit par produit (avant/après activation)
1. Image canonique **https** réelle (non synthétique) ;
2. unité vendable valide (`sellableCatalogUnitSql`) ;
3. revue visuelle FR des médias (`catalog_media_visual_fr_reviews`) pour tout candidat `imported_to_catalog` ;
4. aucun blocage de vente ouvert (`catalog_product_sale_holds`) ;
5. produit actif/disponible, `product_ref` hors préfixes exclus ; puis exposition ENABLED + prix LOCAL_ACTIVE du marché.

### Produits manuels Hub : parcours à prévoir
- Fournir dans le JSON d'import une **vraie image https** (photo réelle, sobre, revendable, URL stable ; pas de placeholder) et l'unité vendable.
- Après import : passer la **revue visuelle FR** des médias dans le workspace Sourcing/Catalogue (geste canonique, rôle sourcing/admin), puis catégorie boutique et promotion.
- Contrôle : le produit apparaît dans `GET /api/products?market=<code>` seulement après les 5 critères ; sinon noter la cause (données, droits, interface, backend), 2 essais max.

## 8. Journal phase B (13/11, staging fa1bf8d16) — ARRÊT sur un blocage de gouvernance
Chemin d'API réel : `/api/admin/workspaces/sourcing|pricing` (pas `/api/admin/sourcing-workspace`). Journal détaillé : `scratchpad/catalogue-ms/journal.log`, scripts `lib.js`, `w1.js`.
Faits (GET) : seuls 3 vrais produits catalogue visibles (KPR-000099/100/101, CJ, KM seulement) ; le reste du catalogue = fixtures E2E-HUB-V1 (non touchées). Allegro : discovery/import désactivés, identifiants absents du coffre (inutilisable) ; eBay : source non créée ; AliExpress et CJ : prêts. Sources réelles retenues : CJ + AliExpress + Fournisseur central Hub (manuel).
Écritures faites : `POST sources/api:aliexpress/import-now` -> run KIR-000016 : 19 acceptés, 18 produits `candidate` créés (+1 rejeté) ; `POST sources/api:cj/import-now` -> HTTP 500 `sourcing_catalogue_handoff_failed` mais 14 produits catalogués, 1 bloqué (BOUTIQUE_TAXONOMY_UNRESOLVED). Créés ce jour après 02:17 UTC (file `/api/admin/catalog/approval-queue`, `queue-new.json`). Import-now ne permet pas de poser le marqueur CLAUDE-PAR-20261113 ; identification par date/run. Aucun produit/prix/stock existant modifié.
Blocage : ces produits sont `lifecycle_status=candidate`, contenu `connector_raw`. Publication (`POST /catalog/approval-queue/:id/approve`) exige (1) fiche FR éditoriale (`french_editorial_not_ready`, `publication_guard:enrichment_required`, parfois `description_missing`, `decision_not_accepted`), aucune route HTTP d'enrichissement trouvée (seulement `override` avec champs) ; (2) revue visuelle FR HUMAINE image par image (`POST .../media/:mediaId/visual-fr-review`, `execution_mode:'HUMAN'`, 5 à 31 images/produit ; le mode AUTOMATED_STAGING est réservé aux candidats de décision TEST). Je n'ai PAS enregistré de revue : c'est une attestation humaine, décision requise.
Produits les moins lourds (images) : 3b019c55 skipping rope CJ (6), e55399f4 gourde CJ (7), ee0c6e12 support téléphone AliExpress (8), b7f9165c coque Samsung AliExpress (7).

## 9. Journal phase B (suite) — état 13/11 ~07h50
Branche `cert/claude-par-catalog` (poussée) : workflows push+paths `claude-par-catalog-{media-dump,visual-review,visibility-diag}.yml`, verdicts versionnés `scripts/recette/claude-par/catalog-visual-verdicts.json`.
Fait : revues AUTOMATED_STAGING (run 43380615867) de 19 images APPROUVÉES (a16c7ade 6, 91c94beb 13) ; fiches FR par `override` ; publication ; mapping `product_suppliers` (admin, `POST /api/purchasing/suppliers/:id/map`) ; prix + exposition KM/CM/CG ; GET public : KM 5, CM 2, CG 2.
Défauts consignés (non corrigés) : (D1) `POST /sources/api:cj/import-now` -> 500 `sourcing_catalogue_handoff_failed` alors que 14 produits catalogués ; (D2) `recordVisualFrReview` : `option_values:null` -> JSON 'null' ≠ COALESCE('{}') -> 409 SOURCE_MEDIA_CHANGED_DURING_REVIEW pour tout média sans variante (contournement : `{}`) ; (D3) produit publié sans aucune ligne `product_suppliers` = invisible (sellableCatalogUnitSql/skuSourceResolvedSql) sans aucun message ; la promotion/approbation ne crée pas le mapping ; (D4) `import-now` AliExpress/CJ crée des candidats auto `imported_to_catalog` (18+14) sans marqueur possible.
Rejets d'images : voir `rejected_products` dans le JSON de verdicts (AliExpress : aucun des 11 candidats TEST n'a un jeu d'images conforme).
