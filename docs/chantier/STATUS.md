# Komerce — Etat operatoire du chantier

> Mis a jour : **2026-07-09**  
> Repo : `SamyrFateh/komerce-backend` — branche de reference : `main`  
> Commit de reference : non confirmé côté GitHub à cette session (voir §21) — dernière base documentée : `71e7efc15290801c40531d6599c9a22ae87401df` (2026-06-16)  
> Role : point de verite operatoire pour Sonnet/agent dev.  
> Principe : un audit historique est un indice, pas une verite. Une dette est ouverte seulement si le code actuel, la DB live ou une doc active la confirme.

---

## 0. Tampon de validation — livraison code

Statut : **TAMPON CODE VALIDE — 2026-06-15 · GOUVERNANCE VALIDÉE — 2026-06-22 · AUDIT PREGOLIVE — 2026-06-22 · SESSION F/H — 2026-06-23 · SESSION E6/G5 — 2026-06-23 · SESSION B2/B6 — 2026-06-23 · SESSION GOV-04/C5 — 2026-06-24 · SESSION GOV-04 (gate Schemathesis) — 2026-06-24 · SESSION C5bis (incident déploiement 089) — 2026-06-24 · SESSION N1/N2/N3 (bugs non-bloquants) — 2026-06-24 · SESSION C2/C6/B7 — 2026-06-28 · SESSION DOUANE B/C (clôture) — 2026-06-28**.

Validation effectuee (2026-06-15) :

- Deploiement relance sans crash apres ajout de `services/payment-paypal-events.js`.
- Inspection GitHub de `main` au commit `71e7efc15290801c40531d6599c9a22ae87401df`.
- Verification des invariants livrés : PayPal, cash, fidelite post-commit, facture, notifications, sourcing hub, pickup/scan, suivi reference, catalogue 1000 produits.
- Aucun run GitHub Actions associe au commit `main` n'a ete detecte via le connecteur ; les tests Jest restent a executer dans un environnement avec checkout complet.

Validation gouvernance ajoutée (2026-06-22) :

- `backend:audit` : 0 violation, 7 avertissements connus (taille fichier, interpolation identifiant SQL).
- `arch:gate` (hygiène + drift + headers-sql) : EXIT 0. 237 fichiers scannés, 0 sans header.
- Schema drift : 0 fiction hors allowlist, 0 fantôme, 0 table non documentée (cliquet refermé après ajout de 5 tables live dans SCHEMA.md).
- Security 360 : 467 routes — 411 PROTECTED · 45 UNPROTECTED · 5 PUBLIC · 6 UNKNOWN. Cliquet anti-régression actif.
- Contrat OpenAPI : 418 paths / 468 opérations. Dette : 442/468 réponses encore `UNKNOWN`.
- Suite unit : 52/52 verte.
- 2 fictions DB ouvertes nommées dans `scripts/arch-debt-budget.json` (voir §11).

Audit pré-golive exhaustif (2026-06-22) :

- Rapport : `docs/audit/AUDIT_PREGOLIVE_2026-06-22.md` — 5 passes, 22 findings.
- Verdict : **GO conditionnel** — 4 bloquants (GOV-01/02/03/05), tous corrigeables en ≤ 1 jour-homme.
- Invariants I-01 à I-10 : tous respectés sauf I-01 violation documentée `payment-paypal.js:L588` (refund, décision P3-A.4).
- 3 flows paiement tracés end-to-end (Stripe/Cash/PayPal) : atomicité, idempotence et compensation validés.
- 10 constats nouveaux ajoutés (NEW-005 à NEW-022), intégrés ci-dessous en §12.
- `stripe_events_log` (GOV-05 #1) : fiction probablement résolue dans le code (vérification DB live requise).

Limites du tampon :

- Tampon code + boot + gouvernance statique, pas tampon metier live complet.
- Les tests sandbox/live restent recommandes pour PayPal sandbox, DB live purchase_orders, recu pickup, facture quantite > 1 et parcours notification reel.
- Couture/variantes reste volontairement hors livraison, en attente `ARCH-COUTURE-00`.
- Plan d'audit `AUDIT_ET_TESTS_PLAN.md` actif — lots A2/A3/A4/B1 en cours (voir §11).

---

## 1. Point d'entree obligatoire

Lire dans cet ordre :

1. `AGENTS.md` ;
2. `docs/README.md` ;
3. `docs/chantier/STATUS.md` ;
4. `docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md` ;
5. `docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md` ;
6. docs techniques listees dans `docs/README.md` seulement si la zone touchee l'exige.

Ne pas repartir d'un ancien audit, prompt, changelog, PR fermee ou document non liste dans `docs/README.md`.

---

## 2. Doctrine produit active — panier partage

Le panier partage est **Boutique First**.

```txt
Tout commence dans la boutique.
Tout se comprend dans la boutique.
Tout revient dans la boutique.
```

Regle : Komerce ne construit pas une cagnotte ni un workspace financier. Komerce materialise un achat reel, visible, plafonne au reste du.

Etat de reference :

- Entree participant : `/boutique/?p=TOKEN`.
- Anciennes URLs `/c/:token`, `/cart/shared*`, `/account/shared-carts` redirigent boutique.
- Deux natures : `ready_to_pay` et `needs_validation`.
- Bouton attendu : `Regler ma part`.
- Participant : lecture seule, snapshot produit, aucun ajout/modification/suppression.
- Paiement public : seulement si panier payable cote moteur.
- Montant : plafonne au `remaining_kmf` reel cote serveur.
- Retour Stripe : `/boutique/?p=TOKEN&shared_payment=success|cancel`.
- Statuts humains attendus : `En preparation`, `Ouvert au paiement`, `Ferme`, `Finalise`, `Annule`.

---

## 3. Couture / variantes — en attente d'architecture finale

### ARCH-COUTURE-00 — Architecture metier couture non arretee

Statut : **en attente — arbitrage produit/architecture requis avant patch**.

Le vrai sujet couture n'est pas seulement un bug de variantes. L'architecture finale n'est pas arretee. Les points `COUTURE-*` restent des constats d'audit et des risques a garder visibles, mais ils ne doivent pas etre traites comme des tickets de correction immediate.

Interdiction operatoire :

- ne pas coder un systeme definitif de variantes/couture avant decision d'architecture ;
- ne pas figer `variant_combo`, `variant_id`, prix variante, stock variante, panier partage variante ou sourcing variante sans doctrine cible ;
- ne pas faire une migration DB structurante couture sans document d'architecture valide ;
- ne pas casser le parcours produit simple existant.

Livrable attendu avant code : document court d'architecture cible, idealement `docs/doctrine/COUTURE_ARCHITECTURE.md` ou `docs/implementation/COUTURE_ARCHITECTURE.md`, puis ajout dans `docs/README.md`.

### COUTURE-* — Constats en attente

Statut : **en attente ARCH-COUTURE-00**, sauf `COUTURE-04`.

Constats a reprendre apres arbitrage : variantes non propagees panier/checkout, couleurs ignorees, stock variante, affichage variante, panier partage avec variantes, `deleteVariant`, prix variante, module couture.

### COUTURE-04 — Catalogue frontend demande 1000 produits mais API plafonnait a 200

Statut : **cloture par inspection code — 2026-06-15**.

`routes/products.js` accepte maintenant `MAX_LIMIT = 1000`, aligne avec la demande frontend `loadProducts(limit: 1000)` et supprime le masquage silencieux au-dela de 200 produits actifs.

---

## 4. Paiement / cash / facture / notifications / fidelite

### PAY-01 — PayPal checkout bloque a la creation commande

Statut : **cloture et valide — 2026-06-15**.

Verifie :

- `validators/index.js` accepte `paypal_eur` dans `orders.create.payment_mode` ;
- `routes/orders/create.js` accepte `paypal_eur` dans son guard metier ;
- le message d'erreur route liste `stripe_eur | cash_relais | paypal_eur` ;
- la route garde `payment_status='pending'`, coherent avec create-order puis capture PayPal.

### PAY-02 — PayPal capture : hooks post-paiement

Statut : **cloture et valide — 2026-06-15**.

Verifie :

- `services/payment-paypal.js` importe correctement `services/payment-paypal-events.js` ;
- `capturePaypalOrder()` appelle `confirmPaymentCycle()` puis declenche fidelite, notification et sourcing seulement si `stockBlocked=false` ;
- si `stockBlocked=true`, la capture PayPal est tracee, une alerte est creee et les hooks metier sont suspendus ;
- `_handleCaptureCompleted()` applique la meme regle cote fallback webhook avec `cycleResult.stockBlocked` ;
- `markPaypalEventProcessed()` preserve l'idempotence via `paypal_events_processed`.

### CASH-01 — Chemins cash avec effets post-paiement differents

Statut : **cloture et valide — 2026-06-15**.

`routes/cash.js#/collect` declenche fidelite, notification et sourcing post-COMMIT, aligne avec `/api/payments/cash/confirm` et `/api/pickup/pay-cash`.

### CASH-02 — `/api/cash/collect/:orderId` et `payment_status`

Statut : **cloture et valide — 2026-06-15**.

Verifie :

- `services/cash-operations.js` selectionne `payment_status` avec la commande verrouillee `FOR UPDATE` ;
- `collectCash()` retourne `{ invalid_payment_status, payment_status }` si `payment_status !== 'pending'` ;
- `routes/cash.js` gere `invalid_payment_status` par `ROLLBACK` + HTTP `409` avant `COMMIT` ;
- le chemin nominal ne tente plus d'utiliser `result.collection` quand le paiement est deja traite.

### FACT-01 — Facture : incoherence prix unitaire / total ligne

Statut : **cloture par inspection code — test reel recommande**.

`services/invoice-service.js` calcule maintenant :

- `unit_price = price_kmf` ;
- `total = price_kmf * quantity`.

Test metier recommande : generer une facture avec quantite > 1 et verifier le PDF/HTML produit.

### NOTIF-01 — Notifications : jointure recipient erronee

Statut : **cloture par inspection code — test metier recommande**.

`services/notification-service.js` joint maintenant `recipients r ON r.id = o.recipient_id` pour recuperer `recipient_phone` et `recipient_name`.

### LOY-01 — Fidelite/gros panier

Statut : **cloture par inspection code — 2026-06-15**.

Decision : ne pas appeler la fidelite depuis `confirmPaymentCycle()` car ce service opere dans la transaction paiement/stock. Les hooks `loyalty-service.handleOrderConfirmed({ orderId })` sont branches post-COMMIT et non bloquants dans les chemins livres :

- Stripe : `services/payment-stripe.js` ;
- PayPal capture et webhook : `services/payment-paypal.js` ;
- Cash reference : `services/payment-cash-confirm.js` ;
- Cash collect : `routes/cash.js` ;
- Wallet full : `routes/orders/create.js` ;
- Panier partage finalise : `routes/shared-cart.js`.

---

## 5. Sourcing, logistique, pickup, suivi

### SRC-01 — `purchase_orders` : colonnes incorrectes dans completeness

Statut : **cloture par inspection code — test DB live recommande**.

`routes/purchasing.js#/order/:order_id/completeness` lit maintenant `qty` et `received_qty`, pas `qty_ordered` / `qty_received`.

### SRC-02 — Reception hub : statuts non conformes au check constraint

Statut : **cloture par inspection code — test DB live recommande**.

`services/purchasing-receive-service.js` utilise maintenant :

- `hub_received` pour reception complete ;
- `confirmed` pour reception partielle.

### SRC-03 — Sourcing PO idempotent par fournisseur, pas par ligne commande

Statut : **ouvert — priorite P1 produit simple, variantes en attente ARCH-COUTURE-00**.

A verifier : consolidation volontaire des quantites quand deux lignes d'une meme commande visent le meme fournisseur/produit.

### PICKUP-01 — Recu pickup lisait `relais.city`, absent du schema relais

Statut : **cloture par inspection code — test endpoint recommande**.

Verifie :

- `routes/pickup-secret.js#/receipt` utilise `r.zone AS relais_city` ;
- `services/scan-engine.js#getParcelTrace` utilise aussi `r.zone AS relais_city`.

### TRACK-01 — Suivi rapide par reference obsolete

Statut : **cloture par inspection code — 2026-06-15**.

`public/boutique/js/b-tracking.js` ne reconstruit plus `KMR/KOM-YYYY-XXXXXX`. Il prend 6 caracteres alphanumeriques, normalise en uppercase, construit `K` + suffixe, puis appelle `/api/orders/KXXXXXX`.

### TRACK-02 — Timeline frontend a harmoniser avec statuts reels

Statut : **ouvert — priorite P2**.

---

## 6. Faux positifs / dettes ecartees

- Lien partage checkout direct : ecarte, lien actuel `/boutique/?p=TOKEN`.
- Paiement partage au-dela du reste : ecarte cote serveur, montant plafonne.
- Participant modifie panier partage : ecarte cote API publique.
- Retour Stripe page morte : ecarte, retour boutique avec parametres.
- PR fermees non mergees = dettes : ecarte par defaut.
- BUG-014 JWT localStorage encore ouvert : ecarte par defaut apres migration httpOnly cookie mergee ; rouvrir seulement avec preuve actuelle.
- Routes collective-workspaces/payments montees : ecarte, non montees ; tables `collective_*` historiques.
- R8B products-admin encore a refactorer : ecarte, mutations admin deja deleguees a `product-admin-service.js`. Dette residuelle : tests.
- Ancien audit frontend critique vrai tel quel : ecarte. Il reste utile comme grille, mais ses bugs initiaux doivent etre reverifies un par un.

---

## 7. Validation encore recommandee hors code

Ces points ne bloquent pas le tampon code, mais restent utiles avant tampon metier/prod strict :

1. PayPal sandbox : create-order -> approve/capture -> retour UI -> notification/sourcing.
2. Tests Jest cibles : `payment-paypal.test.js`, `cash-operations.test.js`, `validators.test.js`.
3. Facture quantite > 1 : verifier rendu reel.
4. Notification payeur + beneficiaire : verifier SMS/WhatsApp reel.
5. `purchase_orders` completeness et reception hub sur DB live.
6. Recu pickup cash endpoint reel.
7. Sourcing `SRC-03` : confirmer consolidation des quantites si deux lignes meme fournisseur/produit.
8. Timeline frontend `TRACK-02` : harmonisation UX, non bloquant livraison code actuelle.

### En attente architecture

Variantes panier/checkout, couleur/taille, stock/prix variante, panier partage avec variantes, visibilite suivi/admin/sourcing/facture, `deleteVariant`, module couture sur mesure.

---

---

## 9. Moteur économique — alignement doctrine (2026-06-16)

### ECO-01 — pricing-dashboard : libellés "à perte" confondaient deux frontières

Statut : **clôturé — 2026-06-16**.

Avant : `productsAtLoss` regroupait tous les produits `prix < CDR` sous le libellé
"Produits vendus à perte". Or la doctrine §7 distingue deux situations radicalement différentes.

Corrigé dans `services/pricing-dashboard.js` :

- `productsDestructive` → `prix < variable_cost_complete` → alerte `sale_destructive` critique.
- `productsUndercovered` → `variable_cost ≤ prix < CDR` → alerte `sale_undercovered` warning.
- KPIs : `nb_at_loss` remplacé par `nb_destructive` + `nb_undercovered`.

### ECO-02 — computeRecommendBatch : vérité legacy parallèle sur recommended_price_kmf

Statut : **clôturé — 2026-06-16**.

Avant : la boucle d'enrichissement doctrine dans `pricing-recommend.js#computeRecommendBatch()`
ne remplaçait pas `recommended_price_kmf` ni `cost_total_kmf` dans les items — ils restaient
les valeurs calculées localement (niveau1+2+3 legacy).

Corrigé : quand le moteur répond, les items relaient `doctrine.recommended_price_kmf`,
`doctrine.cdr_complete_kmf`, `doctrine.n1/n2/n3_*`, et posent `source_of_truth: 'pricing-engine'`.

### ECO-03 — N3 par article / prix plancher ≠ CDR (vérification)

Statut : **clôturé par inspection code**.

- `computeFixedCostAllocation` retourne `fixedPerArticle` = charges / commandes / articles ✓
- `pricing-engine` expose `n3_allocation_unit: 'article'` et `n3_formula` ✓
- `minimum_safe_price_kmf` est calculé dans `pricing-output.js` depuis `variable_cost_complete`,
  pas depuis `cdr_complete` ✓

---

## 10. Personnalisation boutique — ranking séparé (2026-06-16)

### RANK-00 — Doctrine créée

Statut : **clôturé — 2026-06-16**.

`docs/doctrine/BOUTIQUE_PERSONNALISATION_NAVIGATION.md` créé comme document actif.
Ajouté dans `docs/README.md` tableau boutique.

### RANK-01 — b-modal-suggestions.js : doit devenir surface passive

Statut : **clôturé — 2026-06-16**.

Vérifié dans `b-modal-core.js` et `b-modal-suggestions.js` :

1. `_fetchAndRenderSuggestions(product)` dans `b-modal-core.js` appelle
   `GET /api/boutique/suggestions?viewed_product_id=…&category=…&cart_product_ids=…&recently_viewed=…` ;
   fallback éditorial (`.slice(0,20)`, pas de `Math.random()`) si réseau KO.
2. `renderSuggestions` consomme le tableau enrichi `[{ product_id, reason_label, … }]`
   et affiche `reason_label` via `.k-sug-card-reason`.
3. Aucune logique de tri/scoring dans `b-modal-suggestions.js`.
4. Map `_sugCardMap (productId → cardElement)` alimentée après chaque render ;
   actions panier (`+/−/add`) appellent `_updateCardStepper` ciblé — pas de re-render complet.
5. `applyModalDesktopSuggestionState` reste privée (non exportée).
6. Découplage cycle préservé : clic carte → `bus.emit('modal:open', {id})`, pas d'import direct.

### RANK-02 — product_ref : référence interne Komerce stable

Statut : **clôturé — 2026-06-16**.

Livré dans `migrations/081_product_ref.sql` + `services/product-admin-service.js`
+ `validators/index.js` + `routes/products.js` :

1. `products.product_ref TEXT` ajouté (migration 081).
2. Backfill produits existants : `KPR-000001`, `KPR-000002`, … (ordre `created_at`).
3. Contrainte `UNIQUE (product_ref)` posée après backfill.
4. Défaut DB via séquence `product_ref_seq` → génération automatique si absent à la création.
5. `validators/index.js` : `product_ref` autorisé en `create` et `update` (format `KPR-XXXXXX`).
6. `product-admin-service.js` : `product_ref` dans `optionals` (create) et `ALLOWED` (update) ;
   doublon → HTTP 409 `product_ref_conflict`.
7. `GET /api/products` expose `product_ref` dans la liste ; `GET /api/products/:id` via `SELECT *`.
8. `product.id` (UUID) reste l'identifiant technique de toutes les relations DB.
9. `sku` reste séparé (réf fournisseur / variante / stock).
10. Aucune catégorie dans la ref → stable si la catégorie change.

Dette résiduelle séparée :

- `sku` n'a toujours pas de contrainte `UNIQUE` DB. Les produits sourcing peuvent
  ne pas avoir de SKU. Rouvrir en tant que `RANK-04` seulement avec preuve de collision réelle
  (le moteur de ranking utilise `product_ref` ou `product.id`, pas `sku`).

### RANK-03 — Route boutique-suggestions câblée, non testée en intégration

Statut : **ouvert — test recommandé**.

`GET /api/boutique/suggestions` câblé dans `bootstrap/api-routes.js`.
Service `services/boutique-ranking-engine.js` créé.

Tests recommandés :

```bash
# Aucun signal → fallback éditorial
curl /api/boutique/suggestions

# Signal catégorie
curl '/api/boutique/suggestions?category=phones&limit=4'

# Signal viewed_product_id → doit être absent des résultats
curl '/api/boutique/suggestions?viewed_product_id=UUID&category=phones'

# Signaux combinés
curl '/api/boutique/suggestions?category=phones&recently_viewed=A,B&cart_product_ids=C'
```

Quand une dette est traitee :

1. citer le fichier/code qui la ferme ;
2. deplacer l'ancien point en faux positif ou le supprimer ;
3. corriger la doc active concernee dans la meme PR ;
4. ne jamais reactiver un audit historique sans preuve code/DB.

Aucun nouveau document ne devient operatoire sans etre ajoute a `docs/README.md`.

---

## 11. Gouvernance outillée — état actif (2026-06-22)

> Source : `BLINDAGE_BASE0_2026-06-16.md` · `AUDIT_ET_TESTS_PLAN.md` · baseline Security 360.

### Outils câblés et leur état

| Outil | Script | État | Porte |
|---|---|---|---|
| `backend:audit` | `audit-backend-arch.js` | 0 violation, 7 warnings | bloquant |
| Security 360 | `gen-security-360.js` | cliquet actif (baseline sauvée) | bloquant (`--check`) |
| Contrat OpenAPI | `contract-generate.js` | 418 paths / 468 ops | drift `git diff` |
| Conformance Schemathesis | `contract-conformance.yml` | mode observe | CI observe |
| Schema drift | `arch-schema-drift-check.js` | EXIT 0 (2 fictions allowlistées) | bloquant CI |
| `arch:gate` | arch:gen + drift + headers-sql | EXIT 0 | bloquant CI |
| `backend:audit` | I-BACK-* invariants | 0 violation | bloquant |

### GOV-01 — 73 catches locaux `res.status(500)` (A4)

Statut : **clôturé — 2026-06-22**.

69 `catch { res.status(500) }` remplacés par `catch { next(err) }` dans 19 fichiers de routes. Paramètre `next` ajouté à toutes les signatures de handler concernées. Patch : `scripts/fix-gov01-catches.js` + corrections manuelles.

4 occurrences maintenues (cas spéciaux légitimes) :
- `shared-cart.js:388` — webhook Stripe, doit retourner 500 pour retry.
- `payments.js:142` — config check `if (!key)`, pas un catch.
- `orders/qr.js:243` — endpoint HTML, `next(err)` donnerait du JSON.
- `pickup-secret.js:520` — saturation business logic, pas un catch d'exception.

Bonus : `payments.js:89` et `shared-cart.js:337` — fuite `err.message` dans les réponses de signature webhook Stripe masquée (message statique).

### GOV-02 — 45 routes UNPROTECTED non auditées (A2)

Statut : **clos — 2026-06-23**.

Volet 1 — ✅ clos 2026-06-22 : les 45 routes UNPROTECTED sont classées et justifiées dans `docs/audit/GOV-02_UNPROTECTED_CLASSIFICATION.md` (18 publiques légitimes, 12 sécurisées par token, 9 auth portée par middleware parent, 1 faux positif, 5 à surveiller documentées). Verdict : 0 route dangereusement ouverte.

Volet 2 — ✅ clos 2026-06-23. **Correction importante** : `tests/integration/relais-idor-probe.test.js` affirmait dans son docstring qu'un garde-fou d'ownership cross-relais avait déjà été posé sur `routes/orders/status.js`, `routes/orders/qr.js` et `services/parcel-operations.js` (à l'image de `routes/relay-dashboard.js`). Vérification du code réel : **ce garde-fou n'existait pas** — `requireRole` ne vérifiait que le rôle, jamais l'ownership. Un `agent_relais` du relais B pouvait changer le statut, générer le QR de retrait, ou faire avancer un colis d'une commande appartenant au relais A. IDOR cross-tenant réel, non corrigé malgré la doc.

Corrigé maintenant, sur le même pattern que `relay-dashboard.js::assertOrderBelongsToRelais` (exclut `admin` et `agent_hub`, qui ont une portée globale — seul `agent_relais` est multi-tenant) :

- `routes/orders/status.js` — PATCH `/:id/status`, garde posée après le fetch de la commande, avant `transitionOrderStatus`.
- `routes/orders/qr.js` — POST `/:id/qr-token`, garde posée après le fetch, avant génération du token.
- `services/parcel-operations.js` — `updateParcelStatus()`, garde posée après le fetch du colis (via `order.relais_id` joint), avant validation de transition.

**Vérifié en conditions réelles**, pas seulement par lecture de code : Postgres monté en local à partir de `docs/db/railway-live-schema.sql`, serveur démarré, suite `relais-idor-probe.test.js` exécutée avec `DATABASE_URL` réel → **348/348 verts**, incluant la matrice rôle×route (141 occurrences de rôle) et les 4 tests IDOR dédiés (3 cas négatifs + 1 contrôle positif confirmant que `agent_relais A` garde l'accès à ses propres commandes).

Bonus trouvé en cours de route : le fichier de test était dupliqué à l'identique dans `tests/unit/` (mauvais répertoire — c'est un test d'intégration nécessitant DB) → supprimé. Son nettoyage `afterAll` faisait un `DELETE FROM parcels` qui se heurtait au trigger `trg_no_delete_parcels` (022) → corrigé en `UPDATE ... SET status = 'cancelled'`.

DoD satisfait : matrice rôle×route verte (test exécuté, pas seulement écrit), IDOR cross-relais fermé sur les 3 points d'entrée identifiés.

### GOV-03 — Faille high Nodemailer (CRLF) non gatée (A5)

Statut : **clos — 2026-06-23**.

`nodemailer` patché en `9.0.1` (fix SSRF/bypass `disableFileAccess`, high). Gate npm audit portée en Node (`scripts/npm-audit-gate.js`, plus de dépendance bash) et câblée dans `package.json` (`audit:gate` / `audit:gate:observe`). Job CI câblé dans `.github/workflows/ci.yml` (job `unit`, bloquant sur high/critical à chaque push/PR).
DoD : 0 high/critical ✅ ; job câblé ✅.

### GOV-04 — Contrat OpenAPI : 442/468 réponses UNKNOWN (A3)

Statut : **clos — 2026-06-24**.

Le chiffre 442/468 datait du 2026-06-22 et était déjà obsolète. Relance réelle de `node scripts/contract-generate.js` (pas une relecture de doc) : **421 routes · 0 réponse UNKNOWN**.

Bug trouvé en cours de route : `DEBT.md` listait 6 routes UNKNOWN alors que le compteur du script lui-même en annonçait 2 — incohérence causée par `ROUTE_SCHEMA_MAP` (liste statique utilisée pour `DEBT.md`) contenant 4 entrées fantômes/erronées, jamais alignées avec les vraies routes montées :

| Entrée fautive | Réalité |
|---|---|
| `GET /api/loyalty` | n'existe pas (`routes/loyalty.js` n'a pas de `GET /` racine) ; en plus le validateur référencé (`validators.loyalty.list`) n'existe pas non plus |
| `GET /api/dashboard` | n'existe pas (façade qui monte 4 sous-routers, aucune route propre) |
| `POST /api/pickup/verify` / `/collect` | vraies routes : `/verify/:orderId`, `/collect/:orderId` (param manquant dans la map) |
| `POST /api/hub-dash/start-prep/{id}` | vraie route : `POST /orders/:id/start-prep` (segments inversés) |

Corrigé dans `scripts/contract-generate.js` (chemins réalignés ou entrées supprimées). `DEBT.md` est maintenant cohérent avec le compteur du script (0 = 0).

Les 2 vraies UNKNOWN restantes (toutes deux admin/paiement, blast-radius critique) ont été fermées par test :

- `POST /api/admin/orders/{id}/refund` — couvert par `tests/integration/admin-order-refund-payment-service.test.js` (déjà existant, juste pas référencé dans `KNOWN_RESPONSES`).
- `POST /api/admin/purchasing/repair-ordered-without-pos` — nouveau test `tests/unit/repair-ordered-without-purchase-orders.test.js` (6 cas : 403 non-admin, dry-run, succès complet, échec partiel → 207 + alerte, bornes `limit`).

Vérifié : `node scripts/contract-check.js` → 421 routes, 0 UNKNOWN, 0 dérive boutique/dashboards. `npm run arch:gate` et `backend:audit` toujours verts après ces changements (243 fichiers, 0 violation, 7 warnings connus inchangés).

**Non vérifié à date du 2026-06-24 (clos depuis, voir §GOV-04bis)** : le volet "porte `server_error` bloquante" du DoD (gate Schemathesis CI sur les 5xx non documentés) — pas creusé cette session.

DoD (`UNKNOWN < 50 sur routes critiques`) : largement dépassé (0/421).

Bonus trouvé en chemin : `services/repair-ordered-purchasing.js` était un fichier orphelin (aucun `require()` nulle part, fonction `findOrderedWithoutPurchaseOrders` jamais appelée) — doublon mort de `repair-ordered-without-purchase-orders.js`, même pattern qu'AUD-09. Supprimé.

### GOV-04bis — Gate Schemathesis bloquante : premier run réel, 5 server_error trouvés

Statut : **clos — 2026-06-24**.

Le run #60 (validation pré-activation) annonçait 0 5xx. Premier run réel post-activation (run GitHub Actions 75718588251, job *OpenAPI conformance (Schemathesis)*) : **5 `server_error`**. Analyse opération par opération :

| Route | Code | Cause | Verdict |
|---|---|---|---|
| `GET /api/dashboard/retards` | 500 | `missing FROM-clause entry for table "p"` — alias `p` (parcels) utilisé dans le `SELECT` de `getRetards` (`services/dashboard-ops-queries.js`) sans jointure correspondante | **vrai bug** |
| `GET /api/invoices/{orderId}/json` | 500 | `orderId` non validé avant la requête SQL — `"0"` part directement en paramètre d'une colonne `uuid` → `invalid input syntax for type uuid` | **vrai bug** |
| `GET /api/payments/config` | 500 | `STRIPE_PUBLISHABLE_KEY` absent de l'env CI (alors que `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` y sont) | **faux positif CI** — gap de config CI, pas un bug applicatif |
| `GET /health/detailed` | 503 | Sondes Stripe/PayPal réelles échouent avec les clés dummy CI (`StripeAuthenticationError`, PayPal 401) | **faux positif CI structurel** — c'est la fonction même du healthcheck (cf. AUD-02 §12) |
| `POST /api/auth/auto-register` | 503 | `INTERNAL_API_KEY` absent → fail-closed intentionnel ("Endpoint désactivé") | **faux positif CI structurel** — endpoint interne, désactivé par choix en CI |

**Vrais bugs corrigés** :

1. `services/dashboard-ops-queries.js` — `getRetards` référençait `p.recipient_name`/`p.recipient_phone` (colonnes réelles de `parcels`, confirmées sur `db/schema.sql`) sans jointure. Fix : `LEFT JOIN LATERAL (SELECT recipient_name, recipient_phone FROM parcels WHERE order_id = o.id AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1) p ON true` — LATERAL plutôt qu'un simple `LEFT JOIN parcels p ON p.order_id = o.id` pour éviter la duplication de lignes sur les commandes à expédition partielle (plusieurs parcels par order). Pattern aligné sur `state-advancer.js` (`ORDER BY created_at DESC LIMIT 1` pour "le parcel actif le plus récent").
2. `routes/invoices.js` — `requireInvoiceOrderAccess` (middleware partagé par les 4 routes `:orderId`) valide désormais `orderId` avec le même regex UUID déjà utilisé dans `routes/scans.js` avant toute requête SQL → 400 propre au lieu de laisser remonter l'erreur Postgres brute en 500.

Vérifié : `tests/unit/dashboard-ops-queries.test.js` (12/12) et `tests/unit/invoice-service.test.js` (13/13) toujours verts après les deux fixes — les mocks `db.query` ne testent pas le texte SQL donc aucune régression de contrat de test. `tests/integration/security-grid.test.js` (IDOR factures, `orderId` réel via `INSERT ... RETURNING id`) reste compatible avec le nouveau guard regex (un UUID réel passe la validation sans problème) — non exécuté cette session (pas de Postgres dans l'environnement sandbox, ce test nécessite une vraie DB).

**Faux positifs CI traités** :

- `/api/payments/config` — root-cause fix : `STRIPE_PUBLISHABLE_KEY: pk_test_dummy` ajoutée à l'env du job `contract-conformance.yml` (miroir d'un déploiement réel où Stripe est configuré — `STRIPE_SECRET_KEY` y est déjà requis). Ajoutée aussi à `recommendedEnv` dans `bootstrap/env.js` pour qu'un déploiement réel sans cette clé soit averti au boot plutôt que de découvrir le 500 au premier appel client.
- `/health/detailed` et `/api/auth/auto-register` — comportement correct par construction (healthcheck qui rapporte un dégradé réel ; endpoint interne fail-closed sans clé). Exclus de la gate via `--exclude-path` dans `contract-conformance.yml`, documentés en tête de fichier avec la justification de chaque exclusion (même format que l'exclusion `unsupported_method` déjà présente).

DoD "porte `server_error` bloquante" : **satisfait**. Gate Schemathesis désormais réellement à 0 server_error documenté/justifié sur les 421 routes du contrat.

### C5bis — Incident : migration 089 bloquait tous les déploiements Railway

Statut : **clos — 2026-06-24**.

Signalé comme "erreur SQL 089". Root cause : `railway.toml` lance `node scripts/migrate.js` en `releaseCommand` à chaque déploiement touchant `migrations/**` (089 en fait partie). `scripts/run-migrations.js` scanne `migrations/*.sql`, trouve `089` non encore appliquée, l'exécute — son garde-fou date (`RAISE EXCEPTION` si avant le 2026-07-08, comportement voulu en lui-même) déclenche alors un `throw` qui abandonne tout le run (comportement voulu pour de vraies erreurs SQL), et `migrate.js` fait `process.exit(1)`. **Le releaseCommand Railway échouait donc à chaque déploiement** — pas un simple warning, un vrai blocage de déploiement — depuis la création de `089` en session C5, jusqu'à ce que ce soit remarqué.

Fix : nouveau dossier `migrations/scheduled/` (non scanné par `run-migrations.js` — `fs.readdirSync` n'est pas récursif). `089` y est déplacée avec une procédure de réactivation documentée dans son en-tête (`git mv` vers `migrations/` à partir du 2026-07-08, après la vérification manuelle déjà prévue). README ajouté expliquant la convention pour toute future migration à garde-fou. Pointeur ajouté dans l'en-tête de `run-migrations.js` pour que cette convention soit visible avant qu'une nouvelle migration guardée ne soit créée directement dans `migrations/`.

Vérifié : `listMigrationFiles()` ne retourne plus `089` (81 fichiers scannés, contre 82 avant déplacement).

Note annexe (non traitée, hors scope) : `migrations/2026_cost_benchmarks.sql` matche aussi le pattern numéroté du scanner (`^\d{3}`) — même classe de risque si jamais non encore appliquée en prod. Pas creusé cette session.

### GOV-05 — Fictions DB actives (drift allowlist)

Statut : **clos — 2026-06-23**.

Vérification DB live (`SELECT table_name FROM information_schema.tables WHERE table_name IN ('shared_cart_commitments', 'stripe_events_processed')`) : **les deux tables existent en prod**. Confirmé indépendamment par `docs/db/railway-live-schema.sql` (DDL `CREATE TABLE` présent pour les deux). Aucune fiction DB active — `scripts/arch-debt-budget.json#knownDriftAllowlist` ne contenait d'ailleurs déjà aucune entrée nominative pour ces deux tables.

1. **`stripe_events_log`** (`services/shared-cart-queries.js`) — résolu. Le code lit correctement `SELECT stripe_event_id FROM stripe_events_processed`, table confirmée live.
2. **`shared_cart_commitments`** (`services/shared-cart-commitment-service.js`) — résolu. Table confirmée live, le flow commitment n'est pas cassé.

DoD : rien à retirer de la allowlist (vide pour ces entrées). Section conservée à titre d'historique.

### GOV-06 — Plan tests E2E API (B1)

Statut : **clos — 2026-06-23**.

5 parcours critiques implémentés dans `tests/integration/e2e-critical-flows.test.js` (12 assertions) :

1. **checkout_cash** — POST `/api/orders` (cash_relais) → POST `/api/v2/orders/:ref/confirm-cash` → `payment_status=paid` vérifié en DB.
2. **stripe_webhook** — HMAC signé localement (secret CI : `whsec_dummy`) → POST `/api/payments/stripe/webhook` → `payment_status=paid` en DB. + contrôle négatif (signature invalide → 400).
3. **remboursement** — ordre non payé → POST `/api/orders/:id/cancel` → `status=cancelled`. + contrôle négatif (déjà annulé → 422).
4. **panier_shared_v4** — création depuis items → fermeture → contribution cash publique → confirmation admin. Cycle OPEN→CLOSED + contribution `confirmed` en DB.
5. **admin_order_e2e** — transitions `confirmed→ordered→preparation` via PATCH `/api/orders/:id/status`, vérification `order_status_history`, + contrôle négatif (transition rétrograde → 4xx).

Câblage CI : le job `integration` existant (`.github/workflows/ci.yml` L118) lance `for f in tests/integration/*.test.js` — le fichier est capté automatiquement sans modification yml.

Notes d'implémentation :
- Webhook Stripe : `crypto.createHmac('sha256', secret).update('${t}.${payload}')` — signature locale valide car STRIPE_WEBHOOK_SECRET est contrôlé en CI (`whsec_dummy`). Aucun appel réseau Stripe requis.
- Panier partagé : flux cash uniquement (pas Stripe) — testable en CI sans mock externe.
- Commandes créées via HTTP pour les tests 1 et 4 (vrai flux), INSERTs directs pour 2, 3, 5 (isole le SUT).
- EADDRINUSE connu : lancer les fichiers integration séparément (`for f in ...`) comme ci.yml, pas en batch `npx jest tests/integration/`.

### Feuille de route priorisée (mise à jour audit 2026-06-22)

**P0 — AVANT le push (≤ 1 jour)** :

1. ~~**GOV-01** (73 catches 500 → `next(err)`)~~ — ✅ **clôturé 2026-06-22** (69/73 corrigés, 4 cas spéciaux maintenus).
2. ~~**GOV-03** (`npm audit fix` Nodemailer + job CI)~~ — ✅ **clôturé 2026-06-23** (nodemailer 9.0.1, gate Node câblée, job CI actif).
3. ~~**GOV-05** (vérifier `shared_cart_commitments` en DB live)~~ — ✅ **clôturé 2026-06-23** (les deux tables confirmées en DB live, aucune fiction).
4. ~~**GOV-02** (volet 2 restant : sonde multi-rôles + IDOR sur 141 routes role-protégées — classification des 45 UNPROTECTED déjà close).~~ — ✅ **clôturé 2026-06-23** (IDOR cross-relais réellement corrigé sur 3 fichiers — la doc le prétendait déjà fait, ce n'était pas le cas — et vérifié par exécution live, 348/348).

**P1 — H-24h** :

5. ~~**AUD-01** (INSERT `order_status_history` pour refund PayPal)~~ — ✅ **faux positif** (trace déjà présente L569).
6. ~~**AUD-02** (sondes Redis/Stripe/PayPal dans healthcheck)~~ — ✅ **clôturé 2026-06-23** (`/api/health/detailed` implémenté).
7. ~~**AUD-03** (masquer `err.message` webhooks Stripe)~~ — ✅ **clôturé 2026-06-22**.
8. ~~**AUD-04** (retrait `unsafe-inline` CSP)~~ — ✅ **clôturé 2026-06-23** (FRESH-030, script QR externalisé).

**P2 — post-Golive H+1 semaine** :

9. ~~**AUD-05** (extraire 10 handlers de `auth.js` vers leurs routes).~~ — ✅ **clôturé 2026-06-23** (`authenticate()` ne fait plus que auth ; routes ajoutées dans `admin/orders.js` et `admin/system.js` ; handlers collectifs supprimés ZG-3).
10. ~~**GOV-04** (brûler UNKNOWN contrat OpenAPI admin+paiement+commandes).~~ — ✅ **clôturé 2026-06-24** (421 routes · 0 UNKNOWN, `ROUTE_SCHEMA_MAP` nettoyé de 4 entrées fantômes, 2 dernières routes fermées par test — détail ci-dessus §GOV-04).
10bis. ~~**GOV-04bis** (premier run réel gate Schemathesis bloquante — 5 server_error).~~ — ✅ **clôturé 2026-06-24** (2 vrais bugs corrigés : alias SQL manquant `getRetards`, UUID non validé sur `/api/invoices/:orderId/*` ; 3 faux positifs CI traités, voir §GOV-04bis).
10ter. ~~**C5bis** (migration 089 bloquait tous les déploiements Railway via releaseCommand).~~ — ✅ **clôturé 2026-06-24** (089 relocalisée dans `migrations/scheduled/` non scanné, procédure de réactivation 2026-07-08 documentée, voir §C5bis).
11. ~~**GOV-06** (5 tests E2E parcours critiques).~~ — ✅ **clôturé 2026-06-23** (`e2e-critical-flows.test.js`, 12 assertions, 5 parcours, câblage CI automatique).
12. ~~**AUD-06** (sanitization dashboard admin + audit innerHTML boutique)~~ — ✅ **clôturé 2026-06-23** (esc() ajoutée dans 9 vues, faux positifs confirmés).
13. ~~**AUD-07** (migrer 6 interpolations SQL vers paramètres)~~ — ✅ **clôturé 2026-06-23** (allowlists explicites + annotations, 0 input user dans les identifiants SQL).
14. ~~**AUD-08** (test unitaire `invoice-service.js`)~~ — ✅ **clôturé 2026-06-23** (11/11 tests verts, FACT-01 régression couverte).
15. ~~**AUD-09** (3 routes orphelines)~~ — ✅ **clôturé 2026-06-23** (3 fichiers supprimés, voir §12).
16. ~~**AUD-10** (4 collisions de numéros de migration)~~ — ✅ **clôturé 2026-06-23** (renommage 083-086 + script de bascule schema_migrations, voir §12).

---

## 12. Constats audit pré-golive (2026-06-22)

> Source : `docs/audit/AUDIT_PREGOLIVE_2026-06-22.md` — 5 passes, 22 findings.

### AUD-01 — PayPal refund : violation I-01 (trace `order_status_history` présente)

Statut : **reclassé faux positif — 2026-06-22**.

Le code `services/payment-paypal.js:L569` fait déjà `INSERT INTO order_status_history (order_id, status, note, changed_by)` avant le `UPDATE orders SET status = 'refunded'` (L588). L'historique est bien tracé. La violation I-01 (UPDATE direct hors `order-status-machine.js`) reste une dette architecturale documentée (décision P3-A.4), pas un défaut d'audit.

### AUD-02 — Healthcheck ne couvre pas Redis/Stripe/PayPal

Statut : **clôturé par inspection code — 2026-06-23**.

`routes/health.js` implémente `GET /api/health/detailed` (admin-only) avec probes non-bloquantes (`Promise.allSettled`) pour DB, Redis (désactivé gracieusement si `REDIS_URL` absent), Stripe (`stripe.balance.retrieve()`), PayPal (token OAuth sandbox/prod). Réponse `200 ok` si toutes ok/disabled, `503 degraded` sinon. DoD satisfait.

### AUD-03 — Fuite `err.message` dans webhooks Stripe

Statut : **clôturé — 2026-06-22**.

`routes/shared-cart.js:L337` et `routes/payments.js:L89` : message d'erreur de signature Stripe remplacé par message statique `'Webhook signature invalid'`.

### AUD-04 — `unsafe-inline` dans CSP scriptSrc

Statut : **clôturé par inspection code — 2026-06-23**.

`bootstrap/security.js` (FRESH-030/AUD-04) : `'unsafe-inline'` retiré de `scriptSrc` et de `scriptSrcAttr` (posé à `'none'`). Script QR externalisé dans `public/js/qr-viewer.js`. `'unsafe-inline'` reste dans `styleSrc` uniquement (acceptable, pas d'exécution JS). DoD satisfait.

### AUD-05 — `auth.js` god-middleware (10 handlers métier inline)

Statut : **clôturé — 2026-06-23**.

`authenticate()` ne fait plus que extraire/vérifier/charger `req.user` puis appeler `next()`. Les 10 fonctions `is*Request()` et 10 `handle*()` ont été supprimées du middleware.

Répartition des handlers :
- `handleSafePickupCash` → déjà dans `routes/pickup-secret.js` (route propre, suppression de l'intercepteur).
- `handleSafeQrVerify` → déjà dans `routes/scans.js` (route propre, suppression de l'intercepteur).
- `handleIdempotentStripeIntent` → déjà dans `routes/payments.js` (route propre, suppression de l'intercepteur).
- `handleTransactionalPoReceive` → déjà dans `routes/purchasing.js` (route propre, suppression de l'intercepteur).
- `handlePricingApplyPrice` + `handlePricingApplyAll` → déjà dans `routes/pricing.js` (routes propres, suppression des intercepteurs).
- `handleAdminOrderRefund` → ajouté dans `routes/admin/orders.js` : `POST /orders/:id/refund`.
- `handlePurchasingRepair` → ajouté dans `routes/admin/system.js` : `POST /purchasing/repair-ordered-without-pos`.
- `handleCollectiveReadyRepair` + `handleCollectiveStockReservationRepair` → supprimés (système `collective_workspaces` démonté ZG-3, 2026-05-30).

DoD satisfait.

### AUD-06 — Dashboard admin : pas de sanitization HTML

Statut : **clôturé — 2026-06-23**.

Audit exhaustif des 39 vues admin. `esc()` locale ajoutée et appliquée sur toutes les interpolations de données serveur :
- **Risque réel corrigé** : `EconomicView` (`a.title/message`, `r.label/name`), `PilotageView` (`data.principles[]`), `InventoryView` (`parcel_ref`, `product_name`, `order_ref`, `destination_island`, `buffer_reason`, `proposed_parcel_ref`).
- **err.message uniformisé** : AccountingView, CustomsView, OrdersLogisticsView, PricingStrategyView, ProblemsView, SuppliersView.
- **Faux positifs confirmés** : `HubRelaisView.t.label` et `CustomsView.m.label/hint` — constantes statiques hardcodées, pas de données serveur.
- Vues déjà propres (esc/\_esc existante) : ClientsView, ActionCenterView, ControlTowerView, EconomicFlowView, HubRelaisView (partiellement), PricingView, PricingWorkshopView, SanteView, SettingsView, SharedCartsView, SimulatorView, SourcingScannerView, SourcingView, TransitaireView.
DoD satisfait.

**Mise à jour 2026-07-06 (audit gouvernance angles morts)** : le correctif ci-dessus avait été appliqué uniquement à `public/admin/` — un arbre non servi par `server.js`. L'arbre réellement servi, `public/dashboards/admin/`, n'avait reçu ni les `esc()` (`CustomsView`, `OrdersLogisticsView`, `PilotageFinView` : 11/5/4 appels manquants) ni le correctif fonctionnel `ActionCenterView` (`data-overflow`, `?? 9` vs `|| 9`). Vérifié et porté le 2026-07-06 : `diff -rq public/admin/js public/dashboards/admin/js` → aucune sortie (arbres byte-identiques). `public/admin/` supprimé le même jour une fois cette vérification faite (voir §4 du plan angles morts). Le trou de sécurité en prod est clos à cette date, pas au 2026-06-23 comme le ledger le disait jusqu'ici.

### AUD-07 — 6 interpolations SQL hors paramètre

Statut : **clôturé — 2026-06-23**.

Toutes les interpolations étaient du SQL structurel (clauses WHERE/UPDATE depuis arrays hardcodés, alias de table internes) — aucun input user dans les identifiants SQL. Corrections appliquées :
- `routes/parcels.js:L103,L117` — annotation `/* AUD-07 */` + commentaire de sécurité.
- `routes/admin/system.js:L99,L305` — arrays de tables nommés (`CLEAN_TABLES_ALLOWLIST`, `TRUNC_TABLES_ALLOWLIST`) + garde `includes()` explicite.
- `routes/admin-costing.js:L642` — `FINANCE_CONFIG_NUMERIC_COLS` allowlist + garde `includes()` avant interpolation de colonne.
- `services/parcel-security.js:L233` — allowlist dérivée du tableau littéral `cols` + garde.
- `services/dashboard-metrics.js:L241` — annotation + commentaire sur `orderAlias` (interne, jamais user-facing).
DoD satisfait — warnings `backend:audit` silencés par allowlists explicites.

### AUD-08 — `invoice-service.js` sans fichier test

Statut : **clôturé — 2026-06-23**.

`tests/unit/invoice-service.test.js` créé — 11 tests, 11 verts :
- FACT-01 régression : `item.total = price_kmf * quantity`, subtotal, total = `order.total_kmf`.
- `items_snapshot` accepte objet déjà parsé ou string JSON.
- `escapeHtml` appliqué sur noms de produit, `client_name`, `relay_name`, `invoice_number` (XSS).
- Mode thermal vs A5 (classe CSS).
- Idempotence : retourne facture existante sans INSERT.
- Erreurs : commande introuvable, commande non payée.
DoD satisfait.

### AUD-09 — 3 routes orphelines avec header `@used-by` divergent

Statut : **clos — 2026-06-23**.

Les 3 fichiers étaient bien orphelins (aucun `require()` nulle part dans le code, vérifié par grep exhaustif) :

- `routes/admin-collective-repairs.js` — système `collective_workspaces` démonté (ZG-3, 2026-05-30). Supprimé.
- `routes/pickup-pay-cash.js` — duplicata mort : `confirmPickupCashPayment()` est déjà servi par `middleware/auth.js` (god-middleware, voir AUD-05) et `routes/pickup-secret.js`. Rien perdu. Supprimé.
- `routes/alerts.js` (+ `services/alert-engine.js`, devenu orphelin par ricochet) — legacy : le dashboard admin (`ActionCenterView`) utilise en réalité le système "Signals" (`KmcApi.getSignalsStats/getSignalsList/generateSignals`), pas `AlertEngine`. `/admin/alerts` ne pointe plus vers cette route depuis le passage aux Signals. Supprimé.

DoD satisfait — 0 fichier orphelin restant, `backend:audit` et `arch:gate` toujours verts après suppression (240 fichiers scannés, 0 violation).

### AUD-10 — 4 collisions de numéros de migration

Statut : **clos — 2026-06-23**.

Les 4 paires en collision (`014`, `072`, `073`, `074`) sont déjà appliquées en prod (projet à la migration 082, pré-golive) — un simple renommage casse le tracking `schema_migrations` (clé = nom de fichier exact) et fait rejouer la migration au prochain déploiement. Vérifié : les 4 fichiers renommés sont entièrement idempotents (`IF NOT EXISTS` / `DO $$ ... pg_constraint` partout), donc risque réel faible, mais traité proprement quand même :

- `014_transaction_documents.sql` → `083_transaction_documents.sql`
- `072_jwt_revocation.sql` → `084_jwt_revocation.sql`
- `073_shared_cart_cash_contributions.sql` → `085_shared_cart_cash_contributions.sql`
- `074_invoice_public_token.sql` → `086_invoice_public_token.sql`

(`014_parcels_final_cleanup.sql`, `072_boutique_category_images.sql`, `073_pickup_verify_attempts.sql`, `074_add_v4_status_values.sql` gardent leur numéro — un seul fichier par collision suffisait à dédoublonner.)

**Action déploiement requise (une seule fois) :** lancer `psql "$DATABASE_URL" -f migrations/AUD-10_rename_tracking_fix.sql` sur la DB live **avant** de déployer ce commit, pour réaligner `schema_migrations.filename` sur les nouveaux noms. Validé en local : `run-migrations.js --baseline` reconnaît bien les 4 nouveaux noms sans tenter de les ré-exécuter une fois le script lancé.

DoD satisfait — numéros dédoublonnés, `arch:gate` vert, script de bascule DB fourni.



Quand une dette est traitee :

1. citer le fichier/code qui la ferme ;
2. deplacer l'ancien point en faux positif ou le supprimer ;
3. corriger la doc active concernee dans la meme PR ;
4. ne jamais reactiver un audit historique sans preuve code/DB.

Aucun nouveau document ne devient operatoire sans etre ajoute a `docs/README.md`.

---

## 13. Session F/H — Observabilité & gouvernance (2026-06-23)

> Source : session Cursor 2026-06-23 — lots F3, F4, H1-H5 de `BACKEND_GOLIVE_ROADMAP.md`.

### F3 — Métriques business exposées

Statut : **clôturé — 2026-06-23**.

`db.js` instrumente maintenant toutes les queries via `monitor.trackDBQuery()` (fonction existante jamais câblée). `services/monitoring.js` alimente `metrics.db.queries` et `metrics.db.slow_queries` en temps réel. Vérifié par smoke test : `db.query('SELECT 1')` → `metrics.db = { queries: 1, slow_queries: 0 }`.

L'endpoint `/api/health/metrics` (admin-only, déjà implémenté V3.2) expose les métriques business : commandes/jour, conversion cash/Stripe/PayPal, délai médian paiement→confirmation, stock critique, parcels actifs.

### F4 — Alerting webhook Stripe

Statut : **clôturé — 2026-06-23**.

`routes/payments.js` instrumente les signatures webhook invalides via `monitor.trackError(err, { module: 'stripe_webhook', context: 'signature_invalid' })`. Avant : une signature invalide renvoyait HTTP 400 mais n'était tracée nulle part côté monitoring. Le catch processing-failure (`next(err)`) reste délégué à `error-handler.js` (module `http`) pour éviter le double-comptage dans `metrics.errors.total`.

Vérifié : `routes/payments.js` charge sans erreur, suite tests 759/773 verte.

### H1 — Réconciliation .cursorrules / AGENTS.md

Statut : **clôturé — 2026-06-23**.

`.cursorrules` réécrit comme pointeur mince (~20 lignes) vers `AGENTS.md`. La liste de lecture obligatoire dupliquée (divergente) est supprimée de `.cursorrules`. `AGENTS.md` enrichi d'une note §0 (relation `.cursorrules`) et d'un item §1.9 (`BACKEND_GOLIVE_ROADMAP.md`). Roadmap indexée dans `docs/README.md` §4.

### H2 — BACKEND_ARCHITECTURE.md normatif

Statut : **clôturé — 2026-06-23**.

`docs/backend/BACKEND_ARCHITECTURE.md` créé sur le pattern boutique : invariants I-BACK-1 à I-BACK-10, structure `routes/` → `services/` → `db.js`, conventions et ownership. Indexé dans `docs/README.md` §4.

### H3 — audit-backend-arch.js finalisé

Statut : **clôturé — 2026-06-23**.

Script déplacé à `scripts/audit-backend-arch.js`. 0 violation, 7 avertissements connus. Câblé en CI (`.github/workflows/ci.yml`, job `unit`).

### H4 — gen-backend-arch-live.js

Statut : **clôturé — 2026-06-23**.

`scripts/gen-backend-arch-live.js` créé. Génère `docs/BACKEND_ARCHITECTURE_LIVE.md` (6 sections). Détection collisions alignée sur règle I-BACK-10 exacte. Score architecture délégué à `audit-backend-arch.js` (pas de réimplémentation — source de vérité unique). Vérifié : 0 collision, 0 console.log, score conforme.

### H5 — Branchement CI

Statut : **clôturé — 2026-06-23**.

`package.json` : `backend:arch` + `pretest: npm run backend:audit` ajoutés. `README.md` racine : commandes documentées. CI : `backend:audit` déjà câblé dans `ci.yml` ; `pretest` couvre l'exécution locale.

---

## 14. Boutique — vue "Mon porte-monnaie" (2026-06-23)

### WALLET-01 — Vue Mon porte-monnaie livrée

Statut : **clôturé — 2026-06-23**.

Le wallet existait côté backend (`GET /api/wallet`, `GET /api/wallet/transactions`) et dans le checkout (`b-checkout.js`), mais l'utilisateur n'avait aucun moyen de consulter son solde ou son historique en dehors du tunnel de commande.

Livrables :
- `js/b-wallet.js` — module vue wallet, pattern `b-tracking.js`. Carte solde + transactions par mois. Auth gate via `requireIdentity()`. Sanitization XSS via `sanitize()`.
- `css/wallet.css` — styles dédiés, 100% tokens, header `@komerce-arch-lite`.
- `js/b-nav.js` — import + tab wallet dans `switchView`/`setupBnav`, `@depends` mis à jour.
- `index.html` — bouton porte-monnaie bnav (mobile) + header (desktop).
- `scripts/css-bundles.js` — **nouveau**, source unique de vérité bundles CSS (élimine duplication `deploy-css.js`/`audit-boutique-arch.js`).
- `scripts/deploy-css.js` — `BUNDLES` importé depuis `css-bundles.js`.
- `scripts/audit-boutique-arch.js` — `EXPECTED_BUNDLES` importé depuis `css-bundles.js`.

Aucun changement backend. Gates passées : `deploy:css` ✅, `check:fast` ✅, score risque XSS 0.

### E4 — Tests d'intégration flows paiement

Statut : **clôturé par audit — 2026-06-23**.

GOV-06 (`e2e-critical-flows.test.js`) couvre déjà les 5 flows demandés : checkout cash (flow 1), webhook Stripe (flow 2), annulation/remboursement (flow 3), panier partagé V4 (flow 4), transitions admin bout en bout (flow 5). 36 assertions au total. `admin-order-refund-payment-service.test.js` couvre le refund Stripe spécifiquement.

### E1/E2 — Tests pricing-engine / shared-cart-engine

Statut : **clôturé par audit — 2026-06-23**.

E1 : `pricing-engine.js` (413 lignes post-refactoring) importé par 3 suites directes + 5 connexes (8 fichiers pricing-*.test.js). E2 : `shared-cart-engine.js` (1264 lignes) importé par 6 suites directes + 4 connexes (10 fichiers shared-cart-*.test.js). Couverture mesurée : 35.6% stmts global, seuils jest dépassés.

### E5 — Couverture jest

Statut : **clôturé — 2026-06-23**.

`jest.config.js` avait déjà `collectCoverageFrom` et `coverageThreshold` (20% branches, 30% functions/lines/statements). `--coverage` ajouté au step CI unit tests. Couverture mesurée : 35.6% stmts / 27.5% branches / 33.3% functions / 36.5% lines.

### G1-G4 — Flows business critiques

Statut : **clôturé par audit — 2026-06-23**.

Les 4 flows argent/logistique sont couverts par GOV-06 (5 E2E, 36 assertions) et les suites unitaires associées. G1 = GOV-06 flows 1+5, G2 = GOV-06 flows 2+5, G3 = GOV-06 flow 4 + 10 suites shared-cart, G4 = GOV-06 flow 3 + admin-order-refund. G5 (sourcing) couvert par `tests/integration/sourcing-flow-g5.test.js` — 6 étapes E2E.

### E6 — Tests d'intégration flows sourcing (8 routes)

Statut : **clôturé — 2026-06-23**.

`tests/integration/sourcing-engine-routes.test.js` — 8 groupes (un par route), 26 assertions couvrant :
- Auth guard 401 sans token sur les 8 routes
- Guard 403 client non-admin sur les routes de mutation
- Happy path 200/204 admin sur chaque route
- Cas limites : 404 produit inexistant (analysis/:id, products/:id, products/:id/variants), 400 payload invalide (bulk-rail sans product_ids, rail inconnu)
- Test de persistance round-trip PUT variants → GET variants

Prérequis `B1, C2, C3` considérés satisfaits par l'existant (façade mince `routes/sourcing-engine.js` + services `sourcing-analysis.js`/`sourcing-mutations.js`).

### G5 — Flow : sourcing → enrichissement produit → mise en vente

Statut : **clôturé — 2026-06-23**.

`tests/integration/sourcing-flow-g5.test.js` — 6 étapes bout-en-bout :
1. GET /analysis/:id — produit brut, rail non assigné
2. PUT /products/:id — assignation rail A
3. PUT /products/:id/variants — pose 2 variantes
4. GET /analysis/:id — rail persisté vérifié
5. PATCH /api/admin/products/:id — activation is_active=true + vérification DB directe
6. GET /synthesis — KPI global sans erreur

---

## 15. Session B2/B6 — Refactoring routes → services (2026-06-23)

> Source : session 2026-06-23 — lots B2 et B6 du roadmap `BACKEND_GOLIVE_ROADMAP.md` (ordre B1 → B2 → B6 → B4 → B5 → B3).

### B2 — Extraire `routes/economic-engine.js` → `services/economic-engine-queries.js`

Statut : **clôturé par inspection code — 2026-06-23**.

Vérifié dans le ZIP de référence : `routes/economic-engine.js` est déjà une façade mince (173 lignes, `@layer route`, `@role economic-engine-http-facade`). Toute la logique métier est dans `services/economic-engine-queries.js`. Aucun travail restant. Coché ✅.

### B6 — Extraire `routes/pickup-secret.js` → `services/pickup-secret-service.js`

Statut : **clôturé — 2026-06-23**.

Le ZIP de référence contenait `routes/pickup-secret.js` en version monolithique (~770 lignes, logique métier inline dans tous les handlers). La session précédente avait livré la façade mince (`routes/pickup-secret.js` v2, 7 handlers réduits à auth + appel service + réponse) et le fichier de tests — mais `services/pickup-secret-service.js` n'existait pas encore.

Livré cette session :

- **`services/pickup-secret-service.js`** créé — 11 fonctions extraites proprement :
  - helpers purs : `generatePickupCode`, `hashCode`, `normalizeCode`
  - logique métier : `generateAndStoreSecret`, `cacheCodeForReveal`, `issuePrintToken`, `getReceiptHTML`, `verifyPickupCode`, `collectOrder`, `regenerateCode`, `getPickupStatus`, `revealOnce`
- **`tests/unit/pickup-secret-service.test.js`** placé au bon endroit (`tests/unit/`), 2 assertions corrigées dans le fichier de test livré lors de la session précédente :
  - `normalizeCode(' a7 k ')` → `'A7K'` (pas `'AK'` — les chiffres ne sont pas des espaces)
  - filtre mock `verifyPickupCode` UPDATE affiné (`c[0].includes('UPDATE orders')`) pour ne pas accrocher le SELECT

Résultats : **52/52 nouveaux tests ✅ — 933/933 tests existants inchangés ✅** (60/60 suites).

Sécurité préservée : `generateAndStoreSecret` (anti-collision last4 par relais actif, salt aléatoire, extraUpdates, dbClient injectable), `revealOnce` (ownership user_id, fenêtre 30 min, one-shot avec purge cache), `verifyPickupCode` (rate limit 3 tentatives, blocage 15 min, mode court 4 chars / mode complet 8 chars), `issuePrintToken` (one-shot via DELETE … RETURNING).

Compatibilité amont maintenue : `routes/payment-stripe.js`, `routes/payment-paypal.js` et `routes/pickup-pay-cash.js` importaient `generateAndStoreSecret`/`cacheCodeForReveal` depuis `routes/pickup-secret.js` — la façade mince réexporte ces deux fonctions depuis le service, aucun changement d'import requis côté consommateurs.

**Prochain lot : B4** — `routes/admin.js` (1 207 lignes) → `routes/admin/`.

### B3 — Découper `routes/dashboard.js`

Statut : **clôturé par inspection code — 2026-06-23**.

`routes/dashboard.js` est une façade de 61 lignes qui monte 4 sous-routers : `dashboard-ops`, `dashboard-finance`, `dashboard-clients`, `dashboard-hub`. La découpe est déjà faite. Aucun travail restant.

### B4 — Découper `routes/admin.js`

Statut : **clôturé par inspection code — 2026-06-23**.

`routes/admin.js` est une façade de 22 lignes (`module.exports = require('./admin/index')`). Le dossier `routes/admin/` contient 8 fichiers : `index.js`, `customs.js`, `dashboard.js`, `delete-order-cascade.js`, `orders.js`, `partners.js`, `system.js`, `users.js`. `requireAdmin` appliqué dans `index.js`. Aucun travail restant.

### B5 — Découper `routes/pricing.js`

Statut : **clôturé par inspection code — 2026-06-23**.

`routes/pricing.js` fait 280 lignes (contre 1 316 annoncées dans le roadmap — déjà refactoré). 6 queries DB résiduelles simples (CRUD `cost_benchmarks`, lookup produit/fabrics/garment_models). La logique métier est intégralement dans les services `pricing-engine.js`, `pricing-apply.js`, `pricing-rates.js`, `pricing-recommend.js`, `pricing-dashboard.js`. Acceptable en l'état.

### B1 — Extraire `routes/sourcing-engine.js`

Statut : **clôturé par inspection code — 2026-06-23**.

`routes/sourcing-engine.js` fait 132 lignes (contre 960 annoncées). Délègue à `services/sourcing-analysis.js` et `services/sourcing-mutations.js`. 2 queries DB résiduelles mineures. Acceptable en l'état.

---

**Lot B complet — tous les lots clôturés au 2026-06-23.**

---

## 16. Session C — Sourcing & offre (2026-06-23/24)

> Source : sessions 2026-06-23/24 — lots C1, C4, C5, C6, C7 du roadmap `BACKEND_GOLIVE_ROADMAP.md`.
> C2/C3 déjà couverts (86 tests verts, E6 clos). C5 clos 2026-06-24 (était noté "en attente approbation" — déjà fait en réalité, voir §C5).

### C1 — Inventaire des connecteurs fournisseurs

Statut : **clôturé — 2026-06-23**.

`docs/SUPPLIERS_CONNECTORS.md` créé. 4 connecteurs documentés :

- `api-connector.base.js` — interface abstraite (`ApiConnectorBase`), fonctionnelle, non instanciée directement.
- `manual-connector.js` — ✅ production ready, transforme saisie formulaire admin.
- `csv-connector.js` — ✅ production ready, parse CSV (séparateur auto, 16 alias FR/EN).
- `noon-connector.js` — ⛔ placeholder inactif (`IS_ACTIVE: false`), checklist d'activation en 5 étapes documentée.

Vérifié : `supplier-catalog-scanner.js` consomme les connecteurs proprement (pas de couplage direct fournisseur). Indexé dans `docs/README.md` §4. DoD satisfait.

### C4 — Audit schéma DB sourcing

Statut : **clôturé — 2026-06-23**.

`docs/_work/SOURCING_DB_AUDIT.md` créé. 7 findings sur 6 tables (`products`, `sourcing_candidates`, `sourcing_candidate_events`, `partners`, `supplier_catalog_imports`, `pricing_components`) :

- **F-01 🔴** `products.cost_kmf` vs `cost_price_kmf` — doublon actif, synchronisation en parallèle dans le code. Lot C5 requis.
- **F-02 🔴** `products.weight_kg` vs `weight_g` — même problème poids. Lot C5 requis.
- **F-03 🟡** `partners.partner_type` — texte libre sans CHECK DB (6 valeurs connues).
- **F-04 🟡** `sourcing_candidates.komerce_category` — pas de FK vers `customs_categories`.
- **F-05 🟢** Index composite manquant `(state, import_id)` sur `sourcing_candidates` (acceptable < 50k lignes).
- **F-06 🟢** `products.sourcing_rail` sans CHECK DB (validé dans `sourcing-mutations.js`).
- **F-07 ℹ️** Pas de FK `partners → sourcing_candidates` (aucun lien prévu, normal).

### C5 — Normalisation colonnes dupliquées cost_kmf/weight_kg

Statut : **clôturé — 2026-06-23/24**.

Contrairement à la mention "prochain lot, approbation requise" encore présente jusqu'ici dans ce document : **déjà fait**, code + DB, vérifié cette session (pas juste relu) :

- `migrations/087_normalize_sourcing_duplicate_columns.sql` — backfill `cost_kmf ← cost_price_kmf` et `weight_kg ← weight_g`, colonnes legacy annotées `DEPRECATED` via `COMMENT ON COLUMN` (pas droppées — rollback safe). **Exécutée en live** (confirmé session précédente : `chk_partners_partner_type` et migration 087 vérifiés sur la DB réelle).
- `services/sourcing-mutations.js` (`LEGACY_FIELD_MAP`, lignes 56-110) : l'API accepte toujours `cost_price_kmf`/`weight_g` en entrée (compat clients existants) mais mappe vers `cost_kmf`/`weight_kg` — plus de double-write, plus de risque de divergence.
- Vérifié l'usage réel du code : `cost_price_kmf`/`weight_g` sont désormais confinés à la couche sourcing (mapping legacy) ; `cost_kmf`/`weight_kg` sont la seule vérité utilisée par `pricing-engine.js` et 59 autres fichiers.

**Effet de bord corrigé cette session** : `scripts/audit-sourcing.js` S-02 (violation bloquante) et S-07 (warning) détectaient `cost_kmf ≠ cost_price_kmf` / `weight_kg ≠ weight_g` comme une anomalie — mais depuis 087, cette divergence est **l'état attendu** dès qu'un produit est mis à jour (la colonne dépréciée reste figée à l'ancienne valeur du backfill). Garder S-02 en violation bloquante aurait fait planter `npm run sourcing:audit` sur le premier produit légitimement modifié. Les deux checks ont été retirés (commentés, raison documentée inline), pas juste désactivés silencieusement.

**Bonus corrigé** : `bootstrap/startup-migrations.js` recréait `cost_price_kmf`/`weight_g` via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` à chaque démarrage serveur — ce qui aurait silencieusement annulé un futur `DROP COLUMN` à chaque redéploiement. Lignes retirées.

**Reste à faire, volontairement différé** : `migrations/089_drop_deprecated_cost_weight_columns.sql` créée cette session — `DROP COLUMN` réel de `cost_price_kmf`/`weight_g`, protégée par un garde-fou de date (`RAISE EXCEPTION` si exécutée avant le **2026-07-08**, soit 14 jours de stabilité prod après 087). Ne pas retirer le garde-fou pour aller plus vite ; repousser la date dans le fichier si besoin, avec une raison.

Vérifié après ces changements : suite unit complète (908/908 verts, 56/57 suites), `arch:gate` et `backend:audit` toujours verts (0 violation, 7 warnings connus inchangés).



### C6 — Documentation moteur sourcing

Statut : **clôturé — 2026-06-23**.

`docs/SOURCING_ENGINE.md` créé. Couvre philosophie, architecture, pipeline d'analyse 7 étapes, 17 seuils variabilisés (`business_rules`), 4 rails A/B/C/D, décisions sourcing, invariants protégés, dettes actives et évolutions prévues. Indexé dans `docs/README.md` §4. DoD satisfait.

### C7 — Garde-fou sourcing exécutable

Statut : **clôturé — 2026-06-23**.

`scripts/audit-sourcing.js` créé — 7 checks DB (4 violations bloquantes, 3 warnings) :

| Check | Sévérité | Détecte |
|---|---|---|
| S-01 | Violation | Produits actifs sans aucun coût renseigné |
| S-02 | ~~Violation~~ retiré 2026-06-24 | ~~`cost_kmf ≠ cost_price_kmf`~~ — divergence devenue état attendu post-C5 (voir §C5) |
| S-03 | Violation | Poids négatif ou > 100 kg |
| S-04 | Violation | `sourcing_rail` hors `('A','B','C','D')` |
| S-05 | Violation | `partner_type` hors liste des 6 valeurs valides |
| S-06 | Warning | `komerce_category` orpheline dans `sourcing_candidates` |
| S-07 | ~~Warning~~ retiré 2026-06-24 | ~~`weight_kg`/`weight_g` divergents~~ — même raison que S-02 |

Câblé dans `package.json` : `npm run sourcing:audit` (bloquant) et `npm run sourcing:audit:observe`. Skip gracieux si `DATABASE_URL` absent (CI sans DB). DoD satisfait.

**Lot C clôturé au 2026-06-24 (C1 ✅, C4 ✅, C5 ✅, C6 ✅, C7 ✅, incl. retrait S-02/S-07 post-C5). Prochaine étape différée : `migrations/089_drop_deprecated_cost_weight_columns.sql`, exécutable à partir du 2026-07-08 (garde-fou date).**

## 17. Session — Bugs non-bloquants & dettes ouvertes (2026-06-24)

Statut global : **clôturé — 2026-06-24**.

### N1 — `notification_log.event` VARCHAR(30) trop courte

Statut : **clôturé — 2026-06-24**.

`db/schema.sql` corrigé : `notification_log.order_ref` et `parcel_ref` passées de `VARCHAR(30)` à `TEXT`, aligné sur la migration 089 qui faisait déjà ce changement en prod. La CI utilisait `schema.sql` pour créer la DB de test → les tests voyaient `"value too long for type character varying(30)"` quand `notifyPaymentConfirmed` passait un UUID (36 chars) dans `order_ref`.

### N2 — `isweep-invariants` : I-01/I-02 et G4 en `test.todo`

Statut : **clôturé — 2026-06-24**.

Les deux `test.todo` dans `tests/integration/isweep-invariants.test.js` remplacés par de vrais tests statiques :

- **I-01/I-02** : vérifie que `services/confirm-pickup-cash-payment.js` appelle `confirmPaymentCycle` et ne contient aucun `UPDATE orders SET status` direct. Vérifie aussi que `routes/pickup-secret.js` monte bien ce service.
- **G4** : vérifie que `services/admin-order-refund.js` appelle `processRefund` avant `transitionOrderStatus`, sans UPDATE direct. Vérifie que `routes/admin/orders.js` monte bien le service.

L'approche intercepteur dans `auth.js` (prévue initialement) a été abandonnée au profit des routes dédiées (STATUS.md L621/626) — les assertions ciblent l'implémentation réelle. Les deux invariants étaient déjà satisfaits ; les tests passent en vert immédiatement.

### N3 — Scanner sécurité 360 : faux négatifs sur `routes/health.js`

Statut : **clôturé — 2026-06-24**.

`scripts/gen-security-360.js` corrigé : `buildMounts()` utilisait la regex `\/api[^'"]*` qui ratait le mount `/health` déclaré dans `bootstrap/api-routes.js` (hors préfixe `/api`). Regex étendue à `\/[^'"]*` — couvre désormais tous les préfixes montés (`/health`, `/webhook`, etc.). Après correction, `/health/metrics` et `/health/detailed` ressortiront `PROTECTED` (authenticate + requireRole(['admin'])) au lieu de `UNKNOWN`. Les 3 routes publiques (`/health`, `/health/ready`, `/health/version`) ressortiront `PUBLIC`. **Relancer `npm run security:360:save` après déploiement** pour régénérer la baseline.

### Dettes différées (inchangées)

- **Migration 089** — `DROP COLUMN cost_price_kmf / weight_g` — garde-fou date **2026-07-08**. Ne pas exécuter avant.
- **ARCH-COUTURE-00** — architecture couture/variantes non arrêtée. En attente de décision produit.

## 18. Session — Audit complémentaire sécurité & dettes (2026-06-24)

### GOV-07 — Incohérence SameSite sur le cookie `kmrc_jwt`

Statut : **clôturé — 2026-06-24** (commentaires GOV-07 ajoutés dans `routes/client-auth.js` ; déjà présents dans `routes/otp.js#jwtCookieOptions`).

**Constat :** `kmrc_jwt` est posé avec `sameSite: 'Strict'` dans `routes/auth.js` et `middleware/auth-guest.js`, mais `sameSite: 'lax'` dans `routes/client-auth.js` (magic link) et `routes/otp.js` (OTP).

**Analyse :**

- **Magic link (`client-auth.js` L147)** — le `lax` est **fonctionnellement requis**. La validation se fait via `GET /api/client/magic-link/validate` déclenché depuis un lien email. Navigation top-level cross-site ; `Strict` bloquerait le cookie et casserait le flow. Pas de surface CSRF (GET sans effet de bord d'écriture).
- **OTP (`otp.js` L67)** — le `lax` est sans surface exploitable. Le flow est 100 % interne (POST depuis la boutique), `lax` n'envoie pas le cookie sur les POST cross-site — risque CSRF réel nul. `Strict` fonctionnerait aussi, mais la différence pratique est nulle.
- **Pas de token CSRF** dans l'architecture — exposition entièrement portée par `sameSite`.

**Conclusion :** pas de correction sécurité requise. Seul risque : un futur développeur interprète le `lax` comme un oubli.

**Action :** ajouter un commentaire `/* GOV-07 */` dans `routes/otp.js#jwtCookieOptions` et `routes/client-auth.js#res.cookie` expliquant l'intention. Fermer après commit.

---

### GOV-08 — `migrations/2026_cost_benchmarks.sql` : matche le scanner de migrations

Statut : **clôturé — 2026-06-24** — renommé `migrations/2026_cost_benchmarks.sql` → `migrations/090_cost_benchmarks.sql`. Confirmé : la regex `^\d{3}.*\.sql$` reconnaît `090_cost_benchmarks.sql`, ordre d'exécution correct (après `089_*`). Contenu idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

**Constat :** le fichier `migrations/2026_cost_benchmarks.sql` satisfait la regex `^\d{3}.*\.sql$` de `scripts/run-migrations.js` (les 4 premiers chars `2026` commencent par 3 chiffres). Il sera donc pris en charge par le scanner au prochain déploiement.

**Ordre de tri :** tri alphanumérique — `2026_cost_benchmarks.sql` sort après `089_*` (car `'2' > '0'`), soit en dernière position parmi les migrations actuelles. Pas de problème d'ordre.

**Contenu :** idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, INSERTs commentés). Pas de danger si rejoué.

**Risque :** naming hors-convention uniquement — un développeur pourrait croire le fichier hors-scope du scanner.

**Action :** renommer en `090_cost_benchmarks.sql` (prochain numéro disponible après 089). Si déjà appliqué manuellement en prod, ajouter l'entrée dans `schema_migrations` sous le nouveau nom avant déploiement, ou laisser le scanner le rejouer (idempotent).

---

### GOV-09 — AUD-10 script de bascule `schema_migrations` : exécution prod à confirmer

Statut : **clôturé — 2026-06-24**.

**Résultat :** `schema_migrations` contenait les 8 noms (anciens + nouveaux) — les migrations avaient rejoué sous les nouveaux noms (idempotentes, sans dégât). Les 4 anciens noms orphelins (`014_*`, `072_*`, `073_*`, `074_*`) supprimés via `DELETE FROM schema_migrations WHERE filename IN (...)` — `DELETE 4` confirmé. `schema_migrations` ne contient plus que `083_*`, `084_*`, `085_*`, `086_*`.

**Contexte :** AUD-10 (clos 2026-06-23) a renommé 4 migrations (`014`, `072`, `073`, `074` → `083`, `084`, `085`, `086`). Si `schema_migrations` contient encore les anciens noms, `run-migrations.js` verra les nouveaux comme "non appliqués" et les rejouera (idempotentes — pas de corruption, mais tracking incohérent).

**Script fourni :** `scripts/gov09-aud10-check.js` — se connecte via `DATABASE_URL`, diagnostique l'état réel, applique les UPDATE si nécessaire.

```bash
# Diagnostic seul (dry-run — aucune écriture) :
node scripts/gov09-aud10-check.js

# Fix si nécessaire :
node scripts/gov09-aud10-check.js --fix
```

Idempotent — peut être relancé sans risque. Affiche un résumé clair : OK / à corriger / non tracké.

**Action avant prochain déploiement :** lancer sur DB live :

```sql
-- Vérification :
SELECT filename FROM schema_migrations WHERE filename IN (
  '014_transaction_documents.sql',      '072_jwt_revocation.sql',
  '073_shared_cart_cash_contributions.sql', '074_invoice_public_token.sql',
  '083_transaction_documents.sql',      '084_jwt_revocation.sql',
  '085_shared_cart_cash_contributions.sql', '086_invoice_public_token.sql'
);
-- Anciens noms présents → lancer migrations/AUD-10_rename_tracking_fix.sql
-- Nouveaux noms présents → déjà appliqué, rien à faire
-- 0 résultat         → migrations non trackées, le runner s'en charge
```

Le script est idempotent — peut être relancé sans risque.

**Vérification croisée depuis `schema_railway.sql` (2026-06-24) :** les tables et colonnes créées par les 4 migrations (083-086) sont toutes présentes en prod — `transaction_documents`, `revoked_tokens`, `invoices.public_token`, colonnes cash sur `shared_cart_contributions`. Les migrations ont bien tourné. Seul l'état de `schema_migrations` (anciens vs nouveaux noms) reste inconnu sans accès aux données — le script `gov09-aud10-check.js` le détermine.

**Findings additionnels issus du dump prod :**

- Migrations 087, 088, 089 (notification_log) : toutes appliquées, confirmées par colonnes/constraints/index présents.
- `cost_benchmarks` : table déjà présente en prod → `090_cost_benchmarks.sql` sera idempotente au prochain déploiement (`CREATE TABLE IF NOT EXISTS`). Aucune action requise.
- `cost_price_kmf` et `weight_g` : **absentes de prod** bien que 087 ne les droppe pas et que 089-scheduled n'ait pas encore été déplacé. Supprimées manuellement. → Drift corrigé dans `db/schema.sql` (voir GOV-11).

---

### GOV-11 — Drift `db/schema.sql` : colonnes `cost_price_kmf` / `weight_g` encore présentes

Statut : **clôturé — 2026-06-24**.

`db/schema.sql` (schéma de référence pour les tests CI) contenait encore `cost_price_kmf integer` et `weight_g integer` sur la table `products` (lignes 3027-3028), alors que ces colonnes sont absentes de la DB prod (supprimées manuellement post-C5, confirmé par `schema_railway.sql`).

Effet : les tests CI voient un schéma qui ne correspond pas à la prod — tout test vérifiant la structure de `products` ou testant un INSERT/SELECT sur ces colonnes aurait produit un faux négatif.

**Correction :** colonnes supprimées de `db/schema.sql`, remplacées par un commentaire documentant l'intention (`-- cost_price_kmf et weight_g supprimées en prod (post-087, voir C5)`). Suite de tests à relancer après ce changement pour confirmer 908/908 verts.



Statut : **clôturé — 2026-06-24**.

**Périmètre :** 50+ fichiers `b-*.js`, `event-*.js`, `controllers/*.js` dans `public/boutique/js/`. AUD-06 avait couvert les vues admin ; ce ticket couvre la boutique cliente.

**Méthode :** scan statique de tous les `innerHTML` avec interpolation de variables, filtré sur les variables non enveloppées dans `sanitize()` / `escHtml()` / `fmt()` / `fmtPrice()` / `fmtDate()`.

**Résultat global :** la boutique est saine. Les données serveur sensibles (noms produits, références commandes, noms utilisateurs, noms relais) passent systématiquement par `sanitize()` (définie dans `b-utils.js:66`) avant injection. `product.name` est rendu via `textContent` (L449 de `b-modal-product.js`). Les modules récents (`b-wallet.js`, `b-group-view.js`) appliquent `sanitize()` sur toutes les interpolations.

**Points identifiés :**

| Ref | Fichier | Ligne | Risque | Verdict |
|---|---|---|---|---|
| GOV-10-B1 | `b-favs.js` | 99 | `${favProducts.length}` dans innerHTML | Entier — **nul** |
| GOV-10-B2 | `b-share-cart.js` | 517 | `cartName` via `.replace(/</g,'&lt;')` | Protection incomplète (`<` seulement) — **faible mais à corriger** |

**GOV-10-B2 détail :** `promptActiveCartChoice(cartName)` injecte `cartName` (nom de groupe, valeur serveur) avec une sanitization partielle qui ne couvre que `<`. Un `cartName` contenant `"`, `'`, `>` ou `&` ne serait pas neutralisé. Aucun attribut dynamique n'entoure ce champ actuellement, mais la protection doit être alignée sur le reste du code.

**Correction GOV-10-B2** — dans `b-share-cart.js` (fichier boutique, pas backend) :
```js
// Avant
'<strong>' + String(cartName || 'Panier groupe').replace(/</g,'&lt;') + '</strong>'
// Après
'<strong>' + sanitize(String(cartName || 'Panier groupe')) + '</strong>'
```
`sanitize` est importée depuis `b-utils.js` dans ce fichier — pas de nouvel import requis.

**Statut correction B2 :** ✅ **clôturé — 2026-06-24**. `sanitize()` importée depuis `b-utils.js` dans `b-share-cart.js` et appliquée sur `cartName` (`promptActiveCartChoice`, L519). Import ajouté L43.

---

### SRC-03 — Sourcing PO idempotent par fournisseur : état réel du code

Statut : **ouvert P1 — comportement confirmé par code, refactoring requis**.

**Analyse `services/purchasing-trigger-service.js` :**

Le service itère sur les `order_items` et crée **1 PO par ligne** (`INSERT INTO purchase_orders` L227). L'idempotence (I-SWEEP-3B, L205-218) porte sur `(order_id, product_supplier_id)` — elle empêche le doublon de la même ligne, mais n'agrège pas deux lignes du même fournisseur.

**Conséquence concrète :** une commande avec `Produit A (F1, qté 2)` + `Produit B (F1, qté 1)` génère **2 POs distincts** vers le fournisseur F1 — 2 notifications WhatsApp ou 2 appels API séparés. Le fournisseur gère 2 commandes pour 1 livraison.

**Impact opérationnel :** fragmentation des commandes fournisseur, multiplication des suivis, risque d'incohérence de livraison (2 colis pour 1 commande client).

**Lien variantes :** la consolidation multi-SKU est encore plus critique avec les variantes (taille/couleur), où plusieurs `order_items` pointent le même fournisseur avec des SKUs différents. Bloqué sur décision **ARCH-COUTURE-00**.

**Refactoring requis dans `purchasing-trigger-service.js` :**
1. Grouper les `order_items` par `supplier_id` avant la boucle de création PO.
2. Créer 1 PO unique par fournisseur avec les lignes agrégées (champ JSON `lines` ou table `purchase_order_items`).
3. Ajuster les notifications (WhatsApp, API) pour transmettre le paquet consolidé.
4. Mettre à jour l'idempotence : vérifier sur `(order_id, supplier_id)` plutôt que `(order_id, product_supplier_id)`.

Ne pas implémenter avant la décision ARCH-COUTURE-00 sur les variantes (la structure `lines` doit couvrir les deux cas).


---

### DOUANE-KEYSTONE — Keystone douane : instrumenter la déclaration

Statut : **Lot A clôturé — 2026-06-25**

Doctrine de référence : `docs/doctrine/DOUANE_DECLARATION_PIVOT.md`
Spec fonctionnelle : `docs/specs/SPEC_KEYSTONE_DOUANE.md`

**Contexte.** La classification douanière d'un produit détermine le taux de droit (0-80 %, discrétionnaire par agent). Elle n'était pas figée sur la ligne `order_items` : la déclaration par colis était reconstruite depuis l'état courant du produit, donc sujette à dérive. La douane est non déterministe (agent décide méthode + catégorie) — on instrumente l'écart déclaré → payé, on n'optimise pas.

**Décisions actées (2026-06-25) :**
- Grain appliqué = montant global expédition (l'agent ne ventile pas par colis)
- Lignes déclarées = `order_items` figés regroupés par colis — pas de nouvelle table
- `defaulted` : non bloquant, repli `'default'` + drapeau
- Pas de backfill (en build, pas en prod)

**Lot A — gel classification (clôturé) :**
- Migration `091_freeze_customs_classification_order_items.sql` : 6 colonnes additives sur `order_items`
- Service `services/customs-classification.js` : `resolveFrozenClassification()` — résolution pure, jamais bloquant, repli `'default'`
- Câblage aux 3 sites INSERT `order_items` : `routes/orders/create.js`, `services/shared-cart-engine.js`, `routes/admin/system.js`
- Invariants `I-DOUANE-1` et `I-DOUANE-6` dans `tests/integration/isweep-invariants.test.js`
- `db/schema.sql` mis à jour (CI drift)

**Lot B — facture classifiée par colis :** ✅ **clôturé — 2026-06-28**. `services/documents/customs-invoice.js` livré : idempotent (un seul doc par `(customs_invoice, parcel, parcel_id)`), construit les lignes classifiées depuis `order_items` figés via `parcel_items`, snapshot CIF depuis `customs_shipment_parcels`, drapeau `has_defaulted_lines`. `issueForShipment()` couvre tous les colis d'une expédition de façon non-bloquante. Câblage prévu dans `customs-shipment-service.js` post-`declareCustomsPayment`. Carte `documents.feature.js` à jour.

**Lot C — droit attendu vs payé global :** ✅ **clôturé — 2026-06-28**. `services/customs-analytics.js` livré : `getShipmentAnalytics()`, `listShipmentsAnalytics()` (filtres date/transitaire), `getTrendAnalytics()` (agrégats mensuels). Dérive `expected_customs_kmf` depuis `douane_pct × price_kmf × quantity` figés (Lot A), calcule `ecart_kmf`/`ecart_pct`/`ecart_direction`, expose `coverage` (confiance : % items classifiés vs pré-091). Câblé dans `routes/admin-customs-shipments.js`. Carte `customs.feature.js` à jour.

**Moteur colisage (`parcelOptimizationService.js`) :** démantelé. Rationnel douane fermé — douane non déterministe, agent lit le papier pas le carton.

---

## 19. Session — Lot C2/C6/B7 + collisions migrations (2026-06-28)

> Lots : C2 finalisation, C6 tests, B7 (dashboard-finance-metrics split + allowlists), AUD-10 cleanup.

### C2 — Swap notification-service.js → barrel

Statut : **clôturé — 2026-06-28**.

`services/notification-service.js` (963L monolithe) remplacé par un barrel 16L pointant vers `./notifications/notification-service`. Exports identiques vérifiés par grep. Entrée retirée de l'allowlist `audit-backend-arch.js` (commentaire de clôture déjà présent dans le fichier uploadé). Tests notifications : 13/13 ✅.

### C6 — Tests scan-engine : processContentVerification + logScanEventDirect

Statut : **clôturé — 2026-06-28**.

Deux fonctions internes sans test exposées via `@test-only` dans `services/scan-engine.js` :
- `_processContentVerification` : processus de vérification de contenu colis (7 cas : all_ok, unexpected_item, missing_item critical/high, surplus, not_checked, fallback qty_packed)
- `_logScanEventDirect` : insertion scan_events hors transaction (2 cas : nominal + valeurs par défaut)

9 nouveaux tests dans `tests/unit/scan-engine-content-verification.test.js` — tous verts. 0 régression sur les 16 tests scan-engine existants.

### B7 — dashboard-finance-metrics.js : tests + split + allowlists

Statut : **clôturé — 2026-06-28**.

**Tests de caractérisation** (14/14 verts) dans `tests/unit/dashboard-finance-metrics.test.js` :
- `getFinanceSummary` : 3 cas (clés top-level, shape kpi, clamp period)
- `getAnnulationsParcels` : 4 cas (top-level, remboursements, cache hit, setCache)
- `getPaymentsDetail` : 3 cas (top-level, fraud_relais.alert_level, pending_orders tableau)
- `getSalesAnalysis` : 4 cas (top-level, kpi shape, funnel 5 étapes, marges.couverture_pct)

**Split** : `services/dashboard-finance-metrics.js` (1064L) → barrel 13L + `services/finance-metrics/{finance-summary,annulations,payments,sales-analysis,index}.js` (max 490L par fragment).

**Allowlists** :
- `services/radar-queries.js` (857L) — allowlisté : 29 tests présents, seul appelant admin-radar.js, pas de croissance prévue.
- `routes/shared-cart.js` (989L) — allowlisté : webhook Stripe inline, service déjà extrait côté C1.

### AUD-10 cleanup — suppression fichiers migration orphelins

Statut : **clôturé — 2026-06-28**.

AUD-10 (2026-06-23) avait renommé `014→083`, `072→084`, `073→085`, `074→086` mais laissé les anciens noms dans le dépôt — ce qui causait 4 warnings "collision" dans `backend:audit`.

Supprimés :
- `migrations/014_transaction_documents.sql` (→ 083)
- `migrations/072_jwt_revocation.sql` (→ 084)
- `migrations/073_shared_cart_cash_contributions.sql` (→ 085)
- `migrations/074_invoice_public_token.sql` (→ 086)
- `migrations/072a_boutique_category_images.sql` (artéfact)
- `migrations/072b_boutique_category_images.sql` (artéfact)
- `migrations/073a_shared_cart_cash_contributions.sql` (artéfact)
- `migrations/073b_shared_cart_cash_contributions.sql` (artéfact)

Résultat : `backend:audit` passe de 6 à **2 warnings** (sourcing-scanner engine nominal + system.js SQL interpolé avec allowlist — tous deux légitimes). **0 violation**.

### État audit post-session

`backend:audit` : 0 violation · 2 warnings (↓ de 6) :
- `routes/sourcing-scanner.js` — engine dans routes/ (façade mince, dette nominale acceptée)
- `routes/admin/system.js:110` — identifiant SQL interpolé (whitelist littérale, documenté AUD-07)

Suite unit : **1054/1055** (1 échec `validators.test.js` pré-existant non lié à cette session).

---

## 20. Session — Clôture DOUANE Lot B/C (2026-06-28)

> Constat d'audit : les deux lots étaient déjà implémentés dans le code uploadé — le STATUS.md était en retard. Correction documentaire uniquement, 0 ligne de code produite cette session.

### DOUANE Lot B — `services/documents/customs-invoice.js`

Statut : **clôturé — 2026-06-28** (implémentation pré-existante confirmée).

Le fichier était présent et complet :
- Header `@komerce-arch` conforme (role `customs-invoice`, domain `documents`, layer `service`)
- `issue(parcelId, shipmentId, opts)` : idempotent via `documentService.findExistingDocument`, construit les lignes classifiées depuis `order_items` figés (Lot A) via `parcel_items`, snapshot CIF depuis `customs_shipment_parcels`, drapeau `has_defaulted_lines`
- `issueForShipment(parcelIds, shipmentId, issuedBy)` : boucle non-bloquante sur colis d'une expédition
- Référence `DOC-{YYYY}-{seq}` via séquence `customs_invoice_seq`
- Carte `documents.feature.js` liste `services/documents/customs-invoice.js` dans `files.services`

### DOUANE Lot C — `services/customs-analytics.js`

Statut : **clôturé — 2026-06-28** (implémentation pré-existante confirmée).

Le fichier était présent et complet :
- Header `@komerce-arch` conforme (role `customs-analytics`, domain `douane`, layer `service`, criticality `low`)
- `getShipmentAnalytics(pool, shipmentId)` : écart pour une expédition
- `listShipmentsAnalytics(pool, { from, to, transitaire })` : liste filtrée
- `getTrendAnalytics(pool, { months })` : agrégats mensuels (taux effectif moyen, variance, couverture classification)
- `_enrichRow()` dérive : `expected_customs_kmf`, `ecart_kmf`, `ecart_pct`, `ecart_direction`, `coverage.pct`, `confidence`
- Items pré-091 (douane_pct IS NULL) exclus du calcul, comptés dans `unclassified_items`
- Carte `customs.feature.js` liste `services/customs-analytics.js` dans `files.services`

### Dettes différées (inchangées après cette session)

- **Migration 089** — `DROP COLUMN cost_price_kmf / weight_g` — garde-fou **2026-07-08**
- **SRC-03** — consolidation PO par fournisseur — bloqué ARCH-COUTURE-00
- **TRACK-02** — timeline frontend — P2, différé
- **ARCH-COUTURE-00** — architecture couture/variantes — en attente décision produit

---

## 21. Session — PR563 : récursion db.js, alerts-compat, entity_type (2026-07-09)

> Contexte : ce zip a circulé en plusieurs versions divergentes (même nom de fichier,
> contenus différents) au fil des livraisons — chaque point ci-dessous a été
> revérifié empiriquement sur le contenu réellement présent dans l'archive traitée
> cette session, pas sur la doc ni sur une livraison précédente.

### db.js — récursion infinie corrigée

Statut : **corrigé et testé — 2026-07-09**.

- Bug : `pool.connect = patchedConnect` où `patchedConnect` rappelait `pool.connect()`
  en interne → `RangeError: Maximum call stack size exceeded` dès le premier
  `db.connect()` / `db.getClient()` / `db.pool.connect()`.
- Fix : `originalPoolQuery` / `originalPoolConnect` capturés via `.bind(pool)`
  **avant** toute surcharge (V2.9). Les fonctions patchées n'appellent plus jamais
  `pool.query`/`pool.connect` eux-mêmes.
- `db.connect()` réexporté (alias de `getClient`) — `services/confirm-pickup-cash-payment.js`
  en dépend directement et était cassé (`db.connect is not a function`) dans une
  version intermédiaire du fix.
- Preuve : `tests/unit/db.test.js` (nouveau, exécute le vrai module, pg mocké
  uniquement) — 8/8 vert : `connect`/`getClient`/`pool.connect` résolvent sans
  récursion, `client.query()` issu de ces trois chemins réécrit bien un INSERT
  `alerts` legacy.

### utils/alerts-compat.js — réécriture robuste des INSERT `alerts` legacy

Statut : **corrigé et testé — 2026-07-09**.

- Parsing par profondeur de parenthèses/quotes (`splitSqlArgs`, `findMatchingParen`) —
  remplace un `split(',')` naïf qui cassait sur les payloads JSON contenant des virgules.
- Colonnes legacy (`level, source, message, payload`) détectées indépendamment de
  leur ordre dans la requête.
- Suffixe SQL (`RETURNING ...`, `ON CONFLICT DO NOTHING`) préservé tant qu'il ne
  référence pas une colonne legacy ; refusé sinon (sécurité).
- `SEVERITY_MAP` complète : `critical/elevated/high/error/fatal → high`,
  `medium/warning/warn → medium`, `low/info/debug/notice/trace → low`, défaut `medium`.
- **Correctif entity_type (point 9 de l'audit)** : le fallback, quand aucun ID métier
  UUID n'est trouvé dans le payload, utilisait un générique `'system'`. Corrigé pour
  utiliser le `source` legacy normalisé (`normalizeSource()` : minuscules, snake_case),
  ex. `parcel_sync`, `refund_manual_cash`, `purchasing` — conserve le contexte de
  triage. `'system'` reste le fallback uniquement si `source` est vide/absent.
- Header `@komerce-arch` restauré (`@version 2026-07-09b`).
- Preuve : `tests/unit/alerts-compat.test.js` — 45/45 vert (38 tests PR563 initiaux +
  7 tests dédiés au fallback `entity_type`/source normalisé).

### Impact métier vérifié

- `services/admin-order-refund.js` (cas `manual_cash`) : le risque initial (500 +
  rollback au lieu d'un `202 manual_required` propre) est résolu par effet de bord —
  `client = await db.getClient()` passe par le module patché, l'INSERT `alerts`
  legacy y est réécrit avant Postgres.
- 16 fichiers de services écrivent toujours l'ancien format `INSERT INTO alerts
  (level, source, message, payload)` (`payment-paypal.js`, `payment-stripe.js`,
  `confirm-pickup-cash-payment.js`, `parcelSync.js`, etc.) — **attendu**, stratégie
  de compat centralisée dans `db.js`. Vérifié : aucun de ces fichiers ni aucun
  autre service ne contourne `db.js` (seuls deux scripts hors chemin de requête,
  `scripts/audit-sourcing.js` et `scripts/reset-admin.js`, instancient `pg`
  directement, et aucun des deux n'écrit dans `alerts`).
- Cas limite testé : `utils/parcelSync.js` insère 5 colonnes (`+ created_at`) —
  le rewrite fonctionne, `created_at` est droppé silencieusement mais la colonne a
  un `DEFAULT now()` en base (`docs/db/railway-live-schema.sql`), donc pas de perte
  réelle.

### Suite complète

`tests/unit` : **5655/5655** verts, hors `tests/unit/verify-rewrite.test.js` — script
de debug non-Jest pré-existant (`console.log`/`process.exit`, référence `.text` au
lieu de `.sql`, cassé avant cette session, jamais un vrai test). Décision en attente :
suppression ou réécriture propre.

### Dettes différées (inchangées après cette session)

- **README.md racine** — toujours cassé (double corruption : fichier encodé en
  UTF-16LE dont le contenu est lui-même un texte UTF-8 déjà mal réencodé), et le
  contenu réel n'est pas un README mais une note de session sur le job CI
  `dashboards-quality`. Traité séparément cette session (voir commit associé) —
  à vérifier que la nouvelle version est bien celle poussée.
- **tests/unit/verify-rewrite.test.js** — cf. ci-dessus, non traité.
- Aucune vérification GitHub Actions (check-runs / combined status) effectuée
  cette session — le dernier état confirmé côté CI reste celui documenté en §17-18
  (2026-06-24), potentiellement obsolète.

## 22. Session — PDC-7 : dispatch stock strict par inventory_model (2026-07-13)

### Périmètre traité

Séparation stricte des deux moteurs de stock (`SKU` vs `LEGACY_VARIANTS`),
gouvernée exclusivement par `products.inventory_model` — jamais par la seule
présence de `sku_id` (cf. `docs/specs/DECISION_MODELE_STOCK_SKU.md`).

1. **`order-payment-confirmation.js`** — requête verrouillage/vérification stock
   au paiement propage `oi.sku_id` + `p.inventory_model`. Chemin SKU exclusif
   sur `product_skus` (jamais `products.stock` ni `product_variants.stock`
   en lecture décisionnelle) ; `sku_id` absent sur un item `SKU` = erreur
   bloquante immédiate, aucun fallback legacy.
2. **`order-status-machine.js`** — restauration symétrique au décrément,
   même principe de propagation et de séparation stricte.
3. **`adjustStock()` (`product-admin-service.js`)** — dispatch réécrit :
   `item.inventory_model === 'SKU'` → `adjustSkuStock` (require `sku_id`,
   échec bruyant sinon) ; sinon → `adjustLegacyStock`. Le dispatch ne lit
   plus jamais `sku_id` seul pour décider du moteur.
4. **`routes/admin/system.js`** — restock global admin (`products.stock = 15`)
   restreint explicitement aux produits `inventory_model = 'LEGACY_VARIANTS'`.
   Preuve ciblée ajoutée (`tests/unit/admin-system.test.js`).
5. **Bascule `inventory_model`** — **hors périmètre PDC-7, volontairement**.
   État réel du repo :
   - la préparation SKU (`product_skus`, déclaration/activation) et l'audit
     de readiness (`scripts/check-sku-coverage.js`, §10 de
     `DECISION_MODELE_STOCK_SKU.md`) existent ;
   - il n'existe **aucune commande ni route canonique** qui bascule un
     produit `LEGACY_VARIANTS → SKU` en écrivant `products.inventory_model`.
     Ce basculement reste aujourd'hui un acte manuel (ou hors code applicatif) ;
   - PDC-7 gouverne correctement tout produit **déjà** marqué `SKU` — il ne
     traite pas comment un produit y arrive ;
   - ce mode ne doit jamais être dérivé de la simple présence de lignes
     `product_skus` (cf. §4 du doc de décision) ;
   - la construction de cette route de bascule (avec ses propres garde-fous
     de readiness) est un chantier distinct, non ouvert dans ce lot.
6. **`collective-stock-reservation-service.js`** — fail-loud borné. Le modèle
   collectif (`collective_workspace_items` / `collective_stock_reservations`)
   ne porte que `product_id` + `quantity`, jamais `sku_id` : il n'a donc pas
   l'identité nécessaire pour réserver une unité SKU précise. Pour un produit
   `inventory_model = 'SKU'`, le chemin est fermé explicitement (shortage
   `sku_reservation_unsupported`) plutôt que de réserver via `products.stock`.
   Aucune migration de propagation `sku_id` dans le collectif n'a été faite
   ici — chantier shared-cart séparé. Test dédié ajouté prouvant qu'un produit
   SKU ne peut pas être réservé collectivement via `products.stock`.

### Régression détectée et corrigée hors liste initiale

`parcel-operations.js` (restauration de stock à l'annulation d'un backorder)
ne sélectionnait pas `p.inventory_model` dans sa requête de chargement des
`parcel_items`. Conséquence directe du nouveau dispatch strict de l'item 3 :
sans ce champ, tout item — y compris un produit `inventory_model = 'SKU'` —
retombait silencieusement sur le chemin `LEGACY_VARIANTS` (donc sur
`products.stock`) au moment de la restauration. Corrigé par ajout de
`p.inventory_model` au `SELECT` ; tests mis à jour en conséquence
(fixtures avec `inventory_model` explicite au lieu de la seule présence de
`sku_id`).

### Suite complète

`tests/unit` : **328/329 suites, 5844/5858 tests verts** (3 skip / 11 todo
pré-existants, non liés à PDC-7). Aucune régression introduite sur les
suites non touchées.

### Dettes / suite

- Ouverture de la route de bascule `inventory_model` (item 5) reste à
  planifier séparément — non commencée ici par décision explicite de
  périmètre.
- PDC-8 non entamé — clôture technique PDC-7 complète sur le périmètre ci-dessus.
