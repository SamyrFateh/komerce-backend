# Komerce — Réactualisation ciblée de l'audit fonctionnel « 3D » (10 novembre 2026)

> **Nature :** contre-revue documentaire en lecture du dépôt, **sans refonte de l'architecture « colis-first »**.  
> **Base inspectée :** `main` @ `af094725c9320ca53598b74dad05a93936961bc3` (10/11/2026).  
> **Origine historique :** synthèse communiquée par le propriétaire de l'audit Opus du 11/06/2026, addendum §11 de `AUDIT_KOMERCE_3D.md`. Le fichier source exact n'a **pas été retrouvé** dans l'arbre de `main` au SHA ci-dessus, ni dans les historiques interrogés des chemins racine, `docs/` et `docs/audits/`. On réévalue les constats transmis ; **on ne prétend pas avoir relu l'original**.  
> **Méthode :** lecture statique des routes, services, migrations, tests et documents cités ci-dessous. **Présence de code ≠ preuve d'usage réel, de couverture UI complète ou de certification staging.** L'audit Chromium full staging est suivi dans #3787. Depuis le contrôle initial, son run #42896580140 a terminé **SUCCESS** sur le SHA audité, avec **12 passed / 30 skipped**, **0 finding**, 103 routes et 282 clics. Les 30 skipped ne doivent pas être comptés comme exécutés ; cette navigation en lecture seule ne démontre pas à elle seule les mutations SAV, uploads ou atomicité PostgreSQL.

## 1. Principe directeur

Le circuit existant — **sourcing → produit publié → achat client → commande → approvisionnement/réception Hub si import → colis → Relais → remise → litige/SAV/finance** — reste la colonne vertébrale. Les évolutions proposées **réutilisent les autorités existantes** (orders, order_items, disputes, wallet/refund, catalog, inventory). Pas de seconde machine d'état des colis, pas de seconde table « retours » concurrente, pas de second moteur financier.

## 2. Matrice « manque de juin → réalité constatée dans le code »

| Constat juin | État au 10/11/2026 | Preuves et nuance | Action proportionnée |
| --- | --- | --- | --- |
| Retour / réclamation client : aucun flux | **PARTIELLEMENT COUVERT** | `services/relay-return-request-service.js`, `routes/relay-dashboard.js`, migrations `399_relay_product_return_requests.sql` et `401_relay_product_return_intake.sql` : demande liée à une ligne commandée, quantité, motif (dont `damaged`), reprise physique. `services/dispute-mutation-service.js` conserve `disputes` comme propriétaire ; `routes/market-delegation-client-case.js` est un backoffice autorisé par `client.case.handle`. `services/refund-service.js` et l'orchestration des remboursements existent. Ce n'est **pas** la preuve d'un bouton de déclaration autonome depuis la Boutique. | Ajouter, lorsque prioritaire, une entrée **« Signaler un problème »** sur commande remise, avec contrôle serveur de propriétaire, ligne et quantité ; réutiliser le litige canonique et le workflow Relais/marché. |
| Codes promo / parrainage absents | **FIDÉLITÉ EXISTANTE ; COUPON/PARRAINAGE NON IDENTIFIÉS** | `routes/loyalty.js` : paliers, remises, progression. `services/loyalty-service.js` : récompenses et notifications ; `routes/orders/create.js` renvoie `discount_pct`, `discount_kmf`, `loyalty_label`. Pas de trajet `coupon_code` / `referral_code` démontré à la validation checkout dans le périmètre inspecté. | Distinguer fidélité **déjà construite** et parrainage **facultatif**. Prévoir un code campagne plafonné et anti-abus **seulement après** certification du prix et du paiement ; ne pas réécrire les remises fidélité. |
| Avis acheteurs : pas de vrais avis | **NON IDENTIFIÉS** | `migrations/296_catalog_media_visual_fr_reviews.sql` crée une revue **humaine de textes dans les images du catalogue**, **pas** une table d'avis d'acheteurs. Aucune preuve retrouvée d'avis certifiés rattachés à commande remise. | Plus tard : avis « achat vérifié » rattaché à `order_item` remis, modération, publication séparée, aucune note fictive. |
| Alertes rupture / réassort | **RUPTURES COUVERTES EN PILOTAGE ; RÉASSORT CLIENT NON ÉTABLI** | `services/radar-alerts/commerce-signals.js` expose `checkLowStock`, `checkStockOut` ; `services/radar-queries.js` les appelle. Le constat de juin limité à `alert-engine.js` n'épuise plus la surface. Aucune souscription client au retour en stock certifiée par cette revue. | Afficher la rupture de façon claire, expliquer « indisponible » et éventuellement un opt-in de notification réassort **après** validation de la vérité stock / publication marché. |
| Analytique client : LTV / cohortes / réachat | **DÉJÀ LARGEMENT COUVERT EN CODE** | `services/client-360.js` et `services/client-index.js` calculent LTV, panier moyen, récence, fréquence/segments. `services/finance-metrics/sales-analysis.js` calcule des cohortes à six mois et un entonnoir de commandes. La disponibilité réelle de chaque écran selon le rôle reste distincte. | Valoriser ces indicateurs dans Client 360 / Pilotage, avec périmètre marché, exclusion des simulations et cohérence multi-devises. Éviter un nouveau pipeline analytics. |
| Recherche Boutique basique | **SUFFISANT POUR DÉMARRER, QUALITÉ À OBSERVER** | Audit de juin : recherche `ILIKE`; aucune nécessité de moteur externe démontrée ici. | Mesurer recherches sans résultat, variantes de noms, orthographe, synonymes ; optimiser seulement selon usage réel. |
| i18n (FR seul) | **AMÉLIORATION OPTIONNELLE** | Aucune couverture multilingue de bout en bout certifiée dans cette revue ; certaines données/catalogues disposent de traductions de contenu, ce qui ne prouve pas une UI multilingue. | Conserver FR au lancement ; ajouter ensuite une couche de libellés/localisation ciblée par marché, sans réarchitecture. |
| Fidélisation (non pointée dans la synthèse de juin) | **ACQUIS À NE PAS DUPLIQUER** | Paliers/remises `routes/loyalty.js` ; cadeaux et notification via `services/loyalty-service.js`. | Vérifier affichage réel client et cohérence des règles de remise, plutôt que refaire un module. |

### Une règle de preuve

**Quatre niveaux distincts :** (1) code identifié ; (2) test unitaire/intégration vert ; (3) route et comportement sur staging ; (4) parcours Chromium utilisateur complet. Ne pas assimiler les deux premiers aux deux derniers.

## 3. Revue des risques techniques R13 / R14 / R15

### R13 — Persistance des images : **OUVERT, priorité avant go-live**

- **Risque encore prouvé dans l'arbre courant :** `middleware/upload.js` utilise `multer.diskStorage` vers `public/uploads/products/` et porte toujours `TODO #387` « stockage objet persistant ».
- **Routes actives repérées :** `routes/products.js` : `POST /:id/image` et `POST /:id/images` appellent ce middleware et enregistrent des URL locales commençant par `/uploads/products/`. Cela ne garantit pas la survie des images aux redéploiements Railway.
- **Nuance provider :** Cloudinary **et** ImageKit existent déjà pour le showcase/certaines chaînes d'import : `scripts/showcase-media-mirror.js`. Le sélecteur `scripts/showcase-media-provider.js` a **`DEFAULT_MEDIA_PROVIDER = 'imagekit'`**, Cloudinary est une option. La présence de Cloudinary **ne prouve donc pas** la migration de **toutes** les routes produits.
- **Correctif minimal :** remplacer les sorties locales de ces routes par une URL HTTPS persistante via le provider canonique choisi, conserver les validations de fichier existantes, journaliser provenance/erreurs, empêcher l'écriture de nouvelles URL `/uploads/products/`, traiter les anciennes références sans suppression aveugle.
- **Preuve exigible :** vrai upload image → URL persistante retrouvée depuis l'API et Boutique → redéploiement/restart → URL toujours disponible. Tests refus de format, taille, suppression de temporaire et panne du provider. Ne pas insérer de secrets en frontend.

### R14 — Transactions de colis / inventaire : **PARTIELLEMENT CORRIGÉ, risque résiduel ciblé**

- **Corrigé dans `inventory-service.js` :** `receiveItem` et `scanIntoParcel` font chacun `BEGIN` / `COMMIT` / `ROLLBACK` sur un seul client PostgreSQL ; la mutation colis passe par le service canonique et l'affectation vérifie l'existence réelle du lien.
- **Encore à examiner/corriger dans `auto-parcel.js` :** `distributeAll()` appelle `distributeOrder(order.id)` sans lui fournir de transaction ; `distributeOrder` utilise alors le pool `db`. `assignLane` peut créer `parcels` puis insérer plusieurs `parcel_items` sans transaction englobante, et incrémente `assigned` même lorsque `ON CONFLICT DO NOTHING` n'insère aucune ligne.
- **Correctif minimal :** une transaction **par commande** (et non pour tout le batch), verrou/contrainte/idempotence selon auteur canonique de l'affectation ; `assigned` basé sur `rowCount` ou `RETURNING` effectif. Conserver les deux circuits local/import et la composition mono-marché existants. Ne jamais faire dire « succès » à une mutation partielle.
- **Preuves exigibles :** échec au 2e article → rollback complet du nouvel ensemble ; double exécution/concurrence → aucun lien doublé, aucun compteur fictif ; import pas encore reçu → aucun colis import prématuré ; cas local nominal toujours passant ; PostgreSQL réel + Chromium opérations si UI affectée.

### R15 — Dette du ticket #387 : **OUVERT, suivi sans refonte**

L'[issue #387](https://github.com/SamyrFateh/komerce-backend/issues/387) reste **ouverte** au dernier contrôle. Elle centralise notamment :
1. `middleware/upload.js` (recoupe R13) ;
2. `routes/orders/detail.js` : authentification optionnelle de lecture ;
3. `utils/parcelSync.js` : alerting/monitoring des échecs ;
4. `routes/pickup-secret.js` : tokens d'impression mémoire / environnement multi-instance ;
5. `routes/pricing-strategy.js` : dimensions produit plutôt que volume par défaut pour CDR.

**Recommandation :** vérifier chaque TODO sur `main`, supprimer les commentaires réellement obsolètes, qualifier les autres par impact. R15 n'est ni un « unique bug » ni une raison d'engager une refonte.

## 4. Ordre recommandé — sans changement fondamental de cap

| Horizon | Action | Résultat concret / critère de sortie |
| --- | --- | --- |
| **P0 avant commercialisation** | R13 upload images persistantes, R14 `auto-parcel` atomique, audit des TODO #387 pouvant affecter la sécurité/fiabilité | Tests PostgreSQL / HTTP + parcours Chromium ciblés ; aucune perte d'image au redeploy ; distribution idempotente et sans demi-écriture |
| **P1 confiance / service client** | Rendre les litiges et retours **déjà présents** accessibles à l'acheteur après remise, si cette entrée manque | Une demande client autorisée, visible Relais/responsable marché, avec preuves, refus des doublons et statuts cohérents, sans double remboursement |
| **P1 pilotage** | Réutiliser LTV/cohortes/Radar ; améliorer le suivi de la résolution des réclamations et ruptures | KPI avec propriétaire, périmètre marché, fréquence de rafraîchissement et exclusions recette explicités |
| **P2 croissance** | Campagnes/codes parrainage ; avis vérifiés après retrait de la commande | Une campagne limitée, auditable, anti-fraude ; avis non fictifs rattachés à des achats remis |
| **P3 optimisation** | Recherches sans résultat, synonymes, préférences de langues | Décision fondée sur données d'usage et marchés ouverts, pas sur spéculation technique |

**Pas de réarchitecture** : conserver Node/PostgreSQL, l'autorité `disputes` pour retours, le moteur wallet/refund pour argent, l'autorité catalogue pour publication, les transitions colis existantes et les dashboards courants. Tout nouveau parcours = raccordement aux services canoniques + vérification multi-rôle/multi-marché.

## 5. Sources directes du dépôt (SHA audité)

- [Retour au Relais](../../services/relay-return-request-service.js), [écriture litige canonique](../../services/dispute-mutation-service.js), [migration 399](../../migrations/399_relay_product_return_requests.sql), [gestion des dossiers marché](../../routes/market-delegation-client-case.js).
- [Fidélité API](../../routes/loyalty.js), [fidélité service](../../services/loyalty-service.js), [création de commande](../../routes/orders/create.js).
- [Client 360](../../services/client-360.js), [index clients](../../services/client-index.js), [ventes/cohortes](../../services/finance-metrics/sales-analysis.js).
- [Signaux commerce](../../services/radar-alerts/commerce-signals.js), [agrégateur Radar](../../services/radar-queries.js).
- [Migration revue media éditoriale](../../migrations/296_catalog_media_visual_fr_reviews.sql).
- [Upload temporaire](../../middleware/upload.js), [routes image produits](../../routes/products.js), [providers médias showcase](../../scripts/showcase-media-provider.js).
- [Auto parcel](../../services/auto-parcel.js), [inventaire](../../services/inventory-service.js), [TODO #387](https://github.com/SamyrFateh/komerce-backend/issues/387).
- [Audit E2E existant](./KOMERCE_E2E_CERTIFICATION_GAP.md), [suivi certification réelle staging #3787](https://github.com/SamyrFateh/komerce-backend/issues/3787).

## 6. Limites de la réactualisation

- L'original `AUDIT_KOMERCE_3D.md` n'a pas été retrouvé ; le périmètre historique est celui de la synthèse du propriétaire.
- Aucun lancement de test, aucune écriture en base, aucun upload réel, aucune manipulation Railway commerciale ni test de navigateur n'a été exécuté pour **cette** revue documentaire.
- La migration SQL existe dans Git mais son application dans chaque environnement n'a pas été certifiée ici.
- Le run Chromium staging [#42896580140](https://github.com/SamyrFateh/komerce-backend/actions/runs/42896580140) a conclu SUCCESS : SHA `af094725` égal à `/health/version`, 12 tests passés, 30 ignorés, 7 profils/run, 103 routes, 282 clics, 0 finding, 665 lignes de matrice. Il établit une preuve de navigation **en lecture seule**, et ne valide ni les retours clients écrits ni la persistance des images ni les transactions `auto-parcel`.
- Une fonctionnalité « en code » peut rester non exposée selon les rôles et les écrans. Les points notés « non identifié » signifient **non prouvé par les chemins inspectés**, pas preuve formelle d'absence globale.
- Ne fusionner cette PR documentaire sur `main` **qu'après** la campagne Chromium #3787 afin de ne pas casser sa parité SHA pendant son exécution.
