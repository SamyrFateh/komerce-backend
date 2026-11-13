# Brief Sonnet ÉCO : corrections avant les E2E G6 (GO du propriétaire, 12/11 à 18h04)

Source : issue #3927, commentaires 6828953843 (décisions A1 à A8, A2-bis, A2-ter) et 6830136391 (liste des trous #1 à #12). **Lis ces deux commentaires**, puis va droit au code concerné. Ne refais pas l'audit.

## Règles communes
- Lis `AGENTS.md` (plan d'attaque, en-têtes `@komerce-arch`, feature 360, dérive de SCHEMA.md). **Une PR par lot**. Fais le correctif **minimal** sur le writer existant, sans second writer ni nouvelle doctrine, et ajoute des tests ciblés qui prouvent le correctif.
- Une migration doit être **additive** et numérotée après la plus haute présente sur `main` au moment du push. Rebase si un autre lot en a pris une. Mets SCHEMA.md à jour.
- Doctrine monétaire : EUR est le pivot. `currency_parities` est l'unique autorité de conversion. `markets.currency` est la devise commerciale (KMF pour KM, XAF pour CM et CG). Aucun taux codé en dur. Les colonnes `*_kmf` ne sont pas renommées.
- **NE FUSIONNE PAS.** Mène chaque PR jusqu'à « Required verdict » vert sur une tête à jour avec `main`, puis arrête-toi. Opus fusionne tout dans un seul créneau, car chaque fusion redéploie le staging.
- Aucune écriture sur le staging, aucun workflow staging, aucun test Chromium sur le staging. Les tests restent unitaires, ou PostgreSQL jetable selon les workflows CI existants.
- Si un correctif exige une décision métier qui n'est pas tranchée dans les deux commentaires, arrête-toi sur ce point, écris-le dans la section `## Reprise` de la PR et passe au suivant.
- Mécanique :
  - `gh pr` est bloqué (GraphQL) : utilise `gh api` REST et vérifie toi-même l'état.
  - Corps de PR avec `## Pourquoi`, `## Quoi`, `## Tests`, `## Reprise`.
  - `npm run pr:preflight` avant chaque push (le hook l'exige).
  - Travaille dans un worktree dédié et symlinke `node_modules` depuis `/home/claude/komerce-backend/node_modules`.
  - N'écris jamais `@nom` en clair dans GitHub.
- Commits terminés par :
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SwgRpiat6KjVtGnaB4GKZi
- Corps de PR terminés par :
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01SwgRpiat6KjVtGnaB4GKZi
- Ne lis, n'affiche ni ne persiste aucun secret.

## Lots
**L1 Sécurité**
- (#1) Garde marché sur `/api/hub/physical-codes/confirm` (`routes/hub.js`, `services/hub-physical-codes.js`). Le périmètre vient de la session. Hors périmètre : 403 et zéro mutation. Réutilise le helper de périmètre marché déjà employé par le Hub, par exemple celui de `HUB_BAG_MARKET_SCOPE_MISMATCH`.
- (#9) `collectByPickupCode` (`services/pickup-collection-service.js`) : un mauvais code incrémente `pickup_secret_attempts` et bloque via `pickup_secret_blocked_until`. Réutilise `setPickupAttemptState` et le seuil de `verifyPickupCode`. Une commande bloquée refuse même le bon code jusqu'à l'échéance. Le compteur est remis à zéro après une remise réussie. Tout se fait dans la même transaction `FOR UPDATE`.

**L2 Preuve de retrait**
- (#2) Une preuve par geste réel de remise, ancrée sur `scans.id` : `subject_type='pickup_handoff'`, idempotence par `(document_type, subject_type, subject_id)`. Elle contient le colis, les `parcel_items` remis et leurs quantités, le relais, l'agent, le mode (code ou exceptionnel) et l'horodatage.
- Émission post-commit chez les appelants de `pickup-collection-recorder` : code 8 caractères et `pickup-exceptional-collection-service`. Les anciens chemins (`routes/orders/status.js`, `verify-qr-collection.js`) passent au même ancrage. Les preuves existantes restent immuables.
- L'accès est contrôlé par propriétaire et par session, comme les autres documents.

**L3 Checkout**
- (#7) Idempotence serveur de `POST /api/orders` sur l'en-tête `Idempotency-Key` déjà envoyé par la boutique (`b-checkout.js`). Le rejeu avec la même clé et le même client renvoie la même commande (200). La même clé avec un corps différent donne 409. Ajoute une contrainte unique additive. Gère la concurrence par la contrainte, pas par une lecture préalable.
- (#8) Changement de prix : le checkout accepte `expected_total_kmf`, ou mieux le total dans la devise du marché si le schéma le permet ; aligne-toi sur `public-cart-quote-service`. S'il diffère du total recalculé, le serveur renvoie 409 `price_changed` avec le nouveau total, et la boutique affiche le nouveau prix et demande une acceptation explicite. Il n'y a jamais de création silencieuse au nouveau prix. Champ facultatif côté serveur pour les anciens clients, mais la boutique l'envoie toujours.

**L4 Documents**
- (#3) Avoir ou reçu partiel après un remboursement de ligne **confirmé** (`item-refund-psp-orchestrator` et `refund-intent-ledger`), via `refund-receipt`. Il porte la ligne, le SKU, la quantité, le montant, la devise encaissée et le payeur réel, et il est lié à la facture d'origine, qui reste immuable. Rien n'est émis en `requested` ni en `failed`. Il est idempotent.
- (#10) Reprise des documents dont l'émission a échoué. Un service de réconciliation idempotent détecte les événements confirmés sans document (paiement confirmé sans facture, remise sans preuve, remboursement confirmé sans avoir) et réémet. Il s'appelle par un job ou une route admin existante. L'échec est tracé, sans faux envoi.

**L5 Vendeurs réels** (décisions A2, A2-bis et A2-ter)
- (#4) Table append-only additive `manual_purchase_executions` (schéma proposé dans #3927, commentaire 6828623498, ajusté par la décision 6828953843).
- Elle porte l'allocation vendeur → `purchase_line` ou variante → quantité et montant, ainsi que le canal et le justificatif.
- Le vendeur (`seller_supplier_id` ≠ `central_hub`, ou `seller_label`) est **obligatoire à la confirmation** de l'achat physique, mais toléré en préparation.
- Le writer est l'extension de `confirmGroupedPurchaseOrder` (`services/purchasing-engagement-service.js`), dans la même transaction, en gardant `MANUAL_PURCHASE_PROOF_REQUIRED`.
- Rapprochement : achats confirmés ↔ total justifié ↔ paiement autorisé (`hub-authorization-service`, `supplier-payment-orchestrator`), **par cumuls et plafonds**, et non par égalité de chaque tranche. Un écart exige un motif et une validation distincte. Les devises de la PO (par exemple AED) et du client sont préservées.
- Ajoute la saisie dans l'écran PO existant (`sourcing-workspace` ou `operations-workspace`).

**L6 SAV et wallet multi-devise** (le plus lourd ; fais d'abord un plan d'attaque dans la PR)
- (#6) Wallet dans la devise du marché. Supprime le refus `REFUND_WALLET_CURRENCY_UNSUPPORTED` (`services/refund-service.js`) en rendant le wallet multi-devise.
  - Un solde par devise et par utilisateur, aucune conversion implicite entre soldes. Un wallet XAF n'est utilisable que sur une commande XAF.
  - `routes/wallet.js` `admin/credit` accepte un montant et une devise au lieu de `amount_kmf` seul, sans casser les appels KMF existants.
  - Le reçu wallet est dans la bonne devise.
- (#5) Compensation SAV après remise : un writer « décision de compensation » rattaché au dossier de retour (`relay-return-request-service` et `relay-product-return-intake-service`).
  - Il exige une décision admin motivée.
  - Il exécute **un** mouvement canonique : crédit wallet du payeur dans la devise du marché (prioritaire), remboursement via le ledger, ou ré-expédition.
  - Le reçu ou l'avoir n'est émis qu'après confirmation. Le produit reste gelé. Il n'y a jamais de compensation automatique à la reprise.
  - Le barème `COMPENSATION_*` de `DOCTRINE_NON_CONFORMITE` sert de valeur par défaut que l'admin valide.

**L7 Petits défauts**
- (#11) Statut « FAILED » d'un sourcing réussi (#3868, recherche fournisseur). Retrouve la cause dans `services/sourcing-workspace.js` et le runtime du run, puis corrige le statut terminal.
- (#12) `notifyOrderCreated` (`services/notifications/order.js`) passe par `suppressForSimulatedOrder` comme les autres émetteurs. Rien d'autre ne change sur WhatsApp, car la production est inchangée par décision A3.

## Rendu
Rapport final court : PR par lot, statut de « Required verdict », points arrêtés faute de décision. Avant de t'arrêter pour quelque raison que ce soit, pousse tout et mets à jour `## Reprise`.
