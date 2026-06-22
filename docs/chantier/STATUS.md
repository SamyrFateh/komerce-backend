# Komerce — Etat operatoire du chantier

> Mis a jour : **2026-06-22**  
> Repo : `SamyrFateh/komerce-backend` — branche de reference : `main`  
> Commit de reference : `71e7efc15290801c40531d6599c9a22ae87401df` (base) — gouvernance ajoutée post-2026-06-16  
> Role : point de verite operatoire pour Sonnet/agent dev.  
> Principe : un audit historique est un indice, pas une verite. Une dette est ouverte seulement si le code actuel, la DB live ou une doc active la confirme.

---

## 0. Tampon de validation — livraison code

Statut : **TAMPON CODE VALIDE — 2026-06-15 · GOUVERNANCE VALIDÉE — 2026-06-22 · AUDIT PREGOLIVE — 2026-06-22**.

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

Statut : **partiellement clos — classification faite, sonde IDOR restante**.

Volet 1 — ✅ **clos 2026-06-22** : les 45 routes UNPROTECTED sont classées et justifiées dans `docs/audit/GOV-02_UNPROTECTED_CLASSIFICATION.md` (18 publiques légitimes, 12 sécurisées par token, 9 auth portée par middleware parent, 1 faux positif, 5 à surveiller documentées). Verdict : 0 route dangereusement ouverte.

Volet 2 — **ouvert** : 141 routes role-protégées (agent_hub 87 · agent_relais 50 · agent_transitaire 4) ne sont couvertes que par analyse statique, pas de sonde runtime. Actions restantes : sonde multi-rôles + audit IDOR (ressource user A inaccessible par user B).
DoD restant : matrice rôle×route verte CI.

### GOV-03 — Faille high Nodemailer (CRLF) non gatée (A5)

Statut : **clos — 2026-06-23**.

`nodemailer` patché en `9.0.1` (fix SSRF/bypass `disableFileAccess`, high). Gate npm audit portée en Node (`scripts/npm-audit-gate.js`, plus de dépendance bash) et câblée dans `package.json` (`audit:gate` / `audit:gate:observe`). Job CI câblé dans `.github/workflows/ci.yml` (job `unit`, bloquant sur high/critical à chaque push/PR).
DoD : 0 high/critical ✅ ; job câblé ✅.

### GOV-04 — Contrat OpenAPI : 442/468 réponses UNKNOWN (A3)

Statut : **ouvert — itératif**.

La conformance Schemathesis ne peut pas valider les corps de réponse. Brûler les UNKNOWN par priorité blast-radius (admin + paiement + commandes).
DoD : UNKNOWN < 50 sur routes critiques ; porte `server_error` bloquante.

### GOV-05 — Fictions DB actives (drift allowlist)

Statut : **clos — 2026-06-23**.

Vérification DB live (`SELECT table_name FROM information_schema.tables WHERE table_name IN ('shared_cart_commitments', 'stripe_events_processed')`) : **les deux tables existent en prod**. Confirmé indépendamment par `docs/db/railway-live-schema.sql` (DDL `CREATE TABLE` présent pour les deux). Aucune fiction DB active — `scripts/arch-debt-budget.json#knownDriftAllowlist` ne contenait d'ailleurs déjà aucune entrée nominative pour ces deux tables.

1. **`stripe_events_log`** (`services/shared-cart-queries.js`) — résolu. Le code lit correctement `SELECT stripe_event_id FROM stripe_events_processed`, table confirmée live.
2. **`shared_cart_commitments`** (`services/shared-cart-commitment-service.js`) — résolu. Table confirmée live, le flow commitment n'est pas cassé.

DoD : rien à retirer de la allowlist (vide pour ces entrées). Section conservée à titre d'historique.

### GOV-06 — Plan tests E2E API (B1)

Statut : **ouvert — infra déjà en place**.

Parcours critiques à couvrir : checkout cash, checkout Stripe/PayPal webhook, remboursement, panier partagé V4 cycle complet, admin commande bout en bout.
Infra : harness `tests/integration/test-harness/seed-helpers.js`, Postgres jetable CI, `ci-probe-token.js`.
DoD : ≥ 5 parcours critiques verts CI ; job `e2e` câblé.

### Feuille de route priorisée (mise à jour audit 2026-06-22)

**P0 — AVANT le push (≤ 1 jour)** :

1. ~~**GOV-01** (73 catches 500 → `next(err)`)~~ — ✅ **clôturé 2026-06-22** (69/73 corrigés, 4 cas spéciaux maintenus).
2. ~~**GOV-03** (`npm audit fix` Nodemailer + job CI)~~ — ✅ **clôturé 2026-06-23** (nodemailer 9.0.1, gate Node câblée, job CI actif).
3. ~~**GOV-05** (vérifier `shared_cart_commitments` en DB live)~~ — ✅ **clôturé 2026-06-23** (les deux tables confirmées en DB live, aucune fiction).
4. **GOV-02** (volet 2 restant : sonde multi-rôles + IDOR sur 141 routes role-protégées — classification des 45 UNPROTECTED déjà close).

**P1 — H-24h** :

5. ~~**AUD-01** (INSERT `order_status_history` pour refund PayPal)~~ — ✅ **faux positif** (trace déjà présente L569).
6. ~~**AUD-02** (sondes Redis/Stripe/PayPal dans healthcheck)~~ — ✅ **clôturé 2026-06-23** (`/api/health/detailed` implémenté).
7. ~~**AUD-03** (masquer `err.message` webhooks Stripe)~~ — ✅ **clôturé 2026-06-22**.
8. ~~**AUD-04** (retrait `unsafe-inline` CSP)~~ — ✅ **clôturé 2026-06-23** (FRESH-030, script QR externalisé).

**P2 — post-Golive H+1 semaine** :

9. **AUD-05** (extraire 10 handlers de `auth.js` vers leurs routes).
10. **GOV-04** (brûler UNKNOWN contrat OpenAPI admin+paiement+commandes).
11. **GOV-06** (5 tests E2E parcours critiques).
12. ~~**AUD-06** (sanitization dashboard admin + audit innerHTML boutique)~~ — ✅ **clôturé 2026-06-23** (esc() ajoutée dans 9 vues, faux positifs confirmés).
13. ~~**AUD-07** (migrer 6 interpolations SQL vers paramètres)~~ — ✅ **clôturé 2026-06-23** (allowlists explicites + annotations, 0 input user dans les identifiants SQL).
14. ~~**AUD-08** (test unitaire `invoice-service.js`)~~ — ✅ **clôturé 2026-06-23** (11/11 tests verts, FACT-01 régression couverte).

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

Statut : **ouvert — priorité P2 (dette architecturale)**.

`middleware/auth.js` contient 10 fonctions `is*Request()` + 10 `handle*()`. Le middleware intercepte les requêtes après auth et exécute la logique métier avant le routeur Express.
Risque : regex de route-matching fragile, middlewares de route contournés, testabilité réduite.
DoD : `authenticate()` ne fait que extraire/vérifier/charger user/next.

### AUD-06 — Dashboard admin : pas de sanitization HTML

Statut : **clôturé — 2026-06-23**.

Audit exhaustif des 39 vues admin. `esc()` locale ajoutée et appliquée sur toutes les interpolations de données serveur :
- **Risque réel corrigé** : `EconomicView` (`a.title/message`, `r.label/name`), `PilotageView` (`data.principles[]`), `InventoryView` (`parcel_ref`, `product_name`, `order_ref`, `destination_island`, `buffer_reason`, `proposed_parcel_ref`).
- **err.message uniformisé** : AccountingView, CustomsView, OrdersLogisticsView, PricingStrategyView, ProblemsView, SuppliersView.
- **Faux positifs confirmés** : `HubRelaisView.t.label` et `CustomsView.m.label/hint` — constantes statiques hardcodées, pas de données serveur.
- Vues déjà propres (esc/\_esc existante) : ClientsView, ActionCenterView, ControlTowerView, EconomicFlowView, HubRelaisView (partiellement), PricingView, PricingWorkshopView, SanteView, SettingsView, SharedCartsView, SimulatorView, SourcingScannerView, SourcingView, TransitaireView.
DoD satisfait.

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

Statut : **ouvert — priorité P2 (hygiène)**.

`routes/admin-collective-repairs.js`, `routes/pickup-pay-cash.js`, `routes/alerts.js` déclarent `@used-by bootstrap/api-routes.js` mais ne sont montés nulle part.
DoD : fichiers supprimés ou header corrigé.

### AUD-10 — 4 collisions de numéros de migration

Statut : **ouvert — priorité P2 (hygiène)**.

Numéros dupliqués : `014`, `072`, `073`, `074`. Risque faible si `deploy-all.sql` gère l'ordre.
DoD : numéros dédoublonnés.



Quand une dette est traitee :

1. citer le fichier/code qui la ferme ;
2. deplacer l'ancien point en faux positif ou le supprimer ;
3. corriger la doc active concernee dans la meme PR ;
4. ne jamais reactiver un audit historique sans preuve code/DB.

Aucun nouveau document ne devient operatoire sans etre ajoute a `docs/README.md`.
