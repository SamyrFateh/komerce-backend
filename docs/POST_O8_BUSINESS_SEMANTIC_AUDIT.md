# POST-O8 — Business Semantic Audit & E2E Validation

> Audit sémantique des coutures métier modifiées par O7.2/O7.3, avec preuves
> exécutables (failing-proof-first → minimal-fix). Ce document est le livrable
> Phase A ; les résultats E2E exécutés sont dans `docs/POST_O8_E2E_VALIDATION.md`.

## 0. Baseline & périmètre réel de l'environnement d'audit

- **Head de référence attendu** : `44a7bfed` (O8 closure). Le zip fourni ne
  contient **pas** l'historique git (`.git` absent). Conséquence directe :
  **les diffs commit-à-commit `b823e3c7 → f9d6b610 → 44a7bfed` demandés au §4
  ne sont pas reconstructibles**. L'inventaire ci-dessous est donc établi par
  **lecture du code runtime courant confronté à la doctrine** (docs O7.2/O7.3,
  D1 cartographie provider, commentaires `@komerce-arch`), pas par `git diff`.
- **Base de données** : aucun `DATABASE_URL` fourni. Postgres 16 a été installé
  dans le sandbox et le schéma reconstruit à partir de `db/schema.sql` +
  application **tolérante** des migrations `migrations/*.sql` (le `schema.sql`
  livré est en retard sur le code : `inventory_model`, `product_skus`,
  `content_source`, etc. proviennent de migrations postérieures). La
  reconstruction n'est donc **pas byte-identique** à une base réellement
  migrée : un résidu concerne la table `alerts` (voir §résidus).
- **Fournisseurs externes** : AuthKey / Stripe / PayPal réels non configurés →
  restent `NOT_PROVEN_EXTERNAL` par mandat.
- **Playwright / staging** : aucun `BASE_URL` staging, navigateurs non
  provisionnés → BROWSER_E2E non exécuté dans ce sandbox.

## 1. Niveaux de preuve

| Niveau | Sens |
|---|---|
| UNIT | logique isolée, dépendances mockées |
| MOCK_INTEGRATION | plusieurs modules, boundary provider/DB simulée |
| REAL_DB_INTEGRATION | vraie Postgres, lifecycle central réel, boundary provider spied |
| BROWSER_E2E | Playwright réel |
| EXTERNAL_PROVIDER_SMOKE | appel réel au fournisseur |

## 2. Inventaire sémantique des coutures O7 (Phase A)

### FLOW — invoice-ready → AuthKey (Cycle A O7.2)
- **FILES** : `services/invoice-service.js`, `services/authkey-client.js`,
  `services/notifications/{misc,internals,notification-service}.js`.
- **BEFORE (historique, commit `0eb3a5e`)** : message facture routé via template
  WID (`callAuthKey({ wid: WID.invoiceready, bodyValues })`) *quand configuré*.
- **AFTER (O7.2)** : `orders` construit l'URL publique signée puis envoie via
  `notifyText` → `callAuthKeyText` (**texte libre inconditionnel**). `WID.invoiceready`
  reste lu mais **n'est plus consommé**. Tests facture/WID retirés d'`authkey-client.test.js`.
- **DB/LIFECYCLE/EXTERNAL** : lecture invoices/orders ; effet externe = 1 message WhatsApp.
- **MISSING PROOF (avant audit)** : aucun test ne prouvait le routage template quand `AUTHKEY_WID_INVOICE_READY` est configuré.
- **RISK** : message business-initiated hors fenêtre 24 h WhatsApp → un texte libre
  peut être rejeté par le fournisseur ; le lien facture n'arrive jamais.
- **VERDICT initial** : **BROKEN** (preuve rouge Case A). **Corrigé** → SAFE.

### FLOW — PayPal capture + webhook fallback (post-commit)
- **FILES** : `services/payment-paypal.js`, `routes/payments-paypal.js`,
  confronté à `services/payment-stripe.js`, `services/payment-cash-confirm.js`,
  `services/order-payment-confirmation.js`.
- **BEFORE/doctrine** : `order-payment-confirmation.js` documente LOY-01
  « hook fidélité branché … payment-paypal ×2 ». Stripe & cash déclenchent en
  post-commit : loyalty + notification paiement + invoice-ready + purchasing.
- **AFTER (observé)** : `capturePaypalOrder` fait cycle + pickup secret + COMMIT,
  puis **rien** (ni loyalty, ni notif, ni invoice, ni purchasing).
  `_handleCaptureCompleted` (webhook fallback) fait cycle + COMMIT **sans même
  générer le code retrait**.
- **DB/LIFECYCLE** : `confirmPaymentCycle` ne fait QUE status + stock (vérifié) ;
  les effets post-commit sont la responsabilité de l'appelant.
- **RISK** : commande PayPal payée sans confirmation client, sans facture, sans
  fidélité, et **sans déclenchement sourcing/achat fournisseur** (effet métier
  majeur absent).
- **VERDICT initial** : **BROKEN** (3 preuves rouges REAL_DB). **Corrigé** → SAFE.

### FLOW — pickup secret (Cycle B O7.2)
- **FILES** : `services/pickup-secret-service.js` consommé par payment-stripe,
  payment-paypal, cash pickup. Route `routes/pickup-secret.js` délègue au service.
- **VERDICT** : SAFE (génération, stockage hash/salt/last4 sans code clair,
  prouvés REAL_DB pour Stripe & PayPal ; webhook fallback PayPal corrigé pour parité).

### FLOW — loyalty extraction (O7.3)
- **FILES** : `getLoyaltyDiscount`/`recalculateLoyalty` extraits de
  `routes/loyalty.js` vers `services/loyalty-service.js`.
- **VERDICT** : SAFE (contrat identique : no-tier → `{0,null}`, erreur DB
  non-bloquante, `recalculateLoyalty` utilise le client passé).

### FLOW — catalog approval router (O7.3)
- **FILES** : montage déplacé `routes/admin/index.js` → `bootstrap/api-routes.js`.
- **VERDICT** : SAFE côté **routing/guards** (401 anon / 403 client / admin
  atteint le handler ; pas de 404 de montage ni de shadowing). Le chemin
  reject-alert reste `NOT_PROVEN` dans ce sandbox (artefact schéma `alerts`).

### FLOW — purchasing/logistics seams (O7.2 Cycle C)
- **FILES** : `purchasing-trigger-service.js`, `scan-operations.js`,
  `pickup-secret-service.js` (vrais services, plus de faux appels route→route).
- **VERDICT** : SAFE au niveau déclenchement (triggerPurchasing appelé une fois
  pour Stripe/cash/PayPal après correctif) ; couture receive→scan non ré-exécutée
  end-to-end ici (voir résidus).

### FLOW — shared-cart frontend `makeIntlPhoneInput` (O7.3)
- **VERDICT** : NOT_PROVEN_EXTERNAL (BROWSER_E2E non exécuté dans le sandbox).

## 3. Verdicts de synthèse

| Flow | O7 touch | Niveau preuve atteint | Verdict |
|---|---|---|---|
| invoice-ready / AuthKey WID | O7.2 A | MOCK_INTEGRATION (fetch) | **BROKEN → SAFE (fix)** |
| Stripe chain (nominal, replay) | — (voisin) | REAL_DB_INTEGRATION | SAFE |
| Cash chain (cross-relais, nominal, stock-bloqué) | — (voisin) | REAL_DB_INTEGRATION | SAFE |
| PayPal post-commit (capture + webhook) | O7.2 B | REAL_DB_INTEGRATION | **BROKEN → SAFE (fix)** |
| Pickup secret invariants | O7.2 B | REAL_DB_INTEGRATION | SAFE |
| Loyalty extraction | O7.3 | UNIT | SAFE |
| Catalog approval routing/guards | O7.3 | REAL_DB_INTEGRATION | SAFE (routing) |
| Catalog reject-alert insert | O7.3 | — | NOT_PROVEN (artefact `alerts`) |
| Purchasing trigger seam | O7.2 C | REAL_DB_INTEGRATION | SAFE |
| Purchasing receive→scan seam | O7.2 C | — | AT_RISK (non ré-exécuté E2E) |
| Shared-cart phone boundary | O7.3 | — | NOT_PROVEN_EXTERNAL |
| Wallet 100% downstream | — | — | NOT_PROVEN_EXTERNAL (Playwright) |
| AuthKey/Stripe/PayPal external smoke | — | — | NOT_PROVEN_EXTERNAL |

## 4. Corrections appliquées (strictement pilotées par test rouge)

1. `fix(invoice)` — transport `notifyInvoiceReady` (template WID si configuré,
   sinon repli texte libre). `orders` garde la propriété de l'URL publique ;
   `notifications` choisit le transport. **Aucun import notifications→orders réintroduit.**
2. `fix(payments)` — effets post-commit PayPal (loyalty + notif + invoice + purchasing)
   à parité Stripe/cash, + génération code retrait dans le webhook fallback
   (parité PICKUP-5). Fire-and-forget, non-bloquant, gated `!stockBlocked`,
   idempotent sous race capture+webhook.

## 5. Résidus / limites d'environnement

- **Historique git absent** : diffs O7.2→O7.3→O8 non reconstructibles ; audit par lecture code+doctrine.
- **`schema.sql` en retard** sur le code ; DB reconstruite par replay tolérant de migrations.
- **Table `alerts`** : la base reconstruite expose une forme (`type,severity,title,description`)
  sans colonne `source`/`level`/`message`/`payload` attendue par plusieurs
  inserts (catalog reject, stockBlocked/mismatch paiements). → **NOT_PROVEN** pour
  ces chemins d'alerte dans ce sandbox ; à revalider sur base staging correctement migrée.
- **Purchasing receive→scan** : couture O7.2 Cycle C non ré-exécutée end-to-end (AT_RISK).
- **Fournisseurs externes + Playwright staging** : NOT_PROVEN_EXTERNAL.
