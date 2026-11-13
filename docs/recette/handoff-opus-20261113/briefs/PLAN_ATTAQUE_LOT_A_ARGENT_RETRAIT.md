# Plan d'attaque — Lot A « Argent & retrait » (revue 2026-11-10, `main` @ d6ba5d7)

> Exécutant : Sonnet. Règles : `AGENTS.md` (§0 carte-first, §1 plan d'attaque, §4 `npm run pr:preflight`, §8). Une PR par correctif, merge autonome CI verte.
> Économie de tokens : `node scripts/agent-context.js --impact <fichier>` avant chaque correctif, aucune lecture hors périmètre.

## A1 — Crédit wallet admin idempotent
- **Constat** : `routes/wallet.js:258` → `idempotencyKey: \`admin_${user_id}_${Date.now()}\`` : double-clic / retry = double crédit ; la branche « déjà créé (idempotent) » est inatteignable.
- **Correctif** : clé fournie par l'appelant (header `Idempotency-Key` ou `body.idempotency_key`), **obligatoire** (400 sinon), préfixée `admin_credit:`. `amount_kmf` : entier positif, plafond explicite (validator Joi, pas de constante métier en dur → lire la limite depuis la config existante si elle existe, sinon la poser en config).
- **Dashboard appelant** : générer la clé une fois par ouverture du formulaire (`crypto.randomUUID()`), la réutiliser sur retry.
- **Tests** : même clé ×2 → un seul mouvement ledger, 2ᵉ réponse `idempotent` ; sans clé → 400 ; montant non entier → 400.

## A2 — Révélation du code de retrait réellement one-shot
- **Constat** : `services/pickup-secret-access-service.js` `revealOnce` : check `pickup_secret_revealed_at` puis `Promise.all([mark, DELETE])` → deux requêtes concurrentes obtiennent le code. Si `user_id` et `pickup_code_recipient_user_id` sont nuls, le contrôle destinataire est sauté.
- **Correctif** : transaction unique : `UPDATE orders SET pickup_secret_revealed_at = NOW() WHERE id = $1 AND pickup_secret_revealed_at IS NULL RETURNING …` (0 ligne → 410) puis `DELETE FROM pickup_reveal_codes WHERE order_id = $1 AND expires_at > NOW() RETURNING code` (0 ligne → ROLLBACK + 410). Passer par le writer canonique de `markPickupSecretRevealed` (lui donner l'executor + la garde `IS NULL`), pas de SQL parallèle. Destinataire absent → 403, jamais d'accès ouvert.
- **Tests** : 2 appels concurrents → exactement un 200 ; commande sans destinataire → 403 ; trace de révélation conservée.

## A3 — Plus jamais de suppression de wallet
- **Constat** : `routes/admin/users.js:610-611` supprime `wallet_transactions` puis `wallets` pour un utilisateur sans commande ni scope ; viole §8 « Wallet : jamais supprimer ».
- **Correctif** : si l'utilisateur a un wallet avec ≥ 1 mouvement → chemin `anonymizeUser` (soft delete) comme pour les commandes. Hard delete uniquement si aucun wallet ou wallet vide sans mouvement ; retirer les deux `DELETE FROM wallet*` de la liste.
- **Tests** : user avec crédit admin sans commande → anonymisé, ledger intact ; user sans wallet → hard delete inchangé.
- Ne pas toucher `routes/admin/system.js` (reset/seed déjà gardés hors prod).

## A4 — Identité runtime : `KOMERCE_ENV`, pas `NODE_ENV`
- **Constat** : doctrine `bootstrap/env.js` (`resolveRuntimeEnvironment()`), contournée par :
  `services/otp-test-mode.js:56`, `routes/auth.js:473`, `middleware/verify-authkey-webhook.js:64`, `services/authkey-client.js:48`.
- **Correctif** : remplacer chaque test `NODE_ENV === 'production'` par l'helper canonique (production **et** staging traités comme protégés là où la doctrine le prévoit — vérifier `utils/auth-cookie.js`, qui le fait déjà correctement, et s'aligner). Ne pas créer de second helper.
- **Tests** : `KOMERCE_ENV=production` + `NODE_ENV=development` → mode test OTP refusé, `/otp/test-reset` 404, admin-reset refusé, webhook authkey non signé refusé.
- **Garde anti-régression** : ajouter au gate existant le plus proche (ou `scripts/backend-audit.js`) une règle interdisant `process.env.NODE_ENV === 'production'` dans `services|routes|middleware` (hors `utils/auth-cookie.js` fallback documenté).

## Définition de fini
Quatre PR mergées, `pr:preflight` vert, chaque correctif prouvé par son test, `STATUS`/carte feature mis à jour si l'outil `agent:context` le signale. Aucun arbitrage métier attendu ; si l'un apparaît (ex. plafond de crédit admin), s'arrêter et le poser.
