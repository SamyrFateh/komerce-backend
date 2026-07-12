# Lot O1.2 — Livrable (scission wallet / loyalty)

Date : 2026-07-12

## ⚠️ Point d'attention avant tout

Cette conversation reprend une session précédente. Les fichiers `backend.zip`,
`boutique.zip` et `public.zip` que tu as réuploadés ne sont **pas arrivés
côté conteneur** (répertoire `/mnt/user-data/uploads` vide) — seul leur nom
figure en texte dans le message. Je n'ai donc **pas le repo lui-même** dans
cette session : pas de `services/wallet-service.js`, pas de
`services/loyalty-service.js`, pas de `routes/loyalty.js`, pas de
`docs/doctrine/APP_FEATURE_REGISTRY.md` à jour.

Ce que je peux livrer avec certitude, c'est ce qui m'a été transmis en clair
dans le message : le contenu final des **trois manifests** issus du travail
précédent (`wallet.feature.js`, `loyalty.feature.js`,
`wallet-loyalty.feature.js` déprécié). Je les livre ci-dessous, inchangés
par rapport à la version validée par les gates dans la session précédente.

Ce que je **ne peux pas** reconfirmer dans cette session, faute d'accès au
repo :

- que les headers `@domain` de `services/loyalty-service.js`,
  `routes/loyalty.js`, `services/wallet-service.js`, `routes/wallet.js`,
  `utils/store-credits.js` sont bien retaggés (la session précédente dit
  l'avoir fait, mais je ne peux pas relire les fichiers ici pour te livrer
  leur contenu réel) ;
- le diff exact appliqué à `docs/doctrine/APP_FEATURE_REGISTRY.md`
  (ligne 4, split wallet-loyalty → wallet + loyalty) ;
- une réexécution des gates (`feature:registry`, `gate:schema`,
  `arch:check`, `gate:touched-files`) dans cet environnement, puisque le
  repo n'est pas monté ici.

**Pour livrer un lot O1.2 complet et vérifié**, réuploade `backend.zip` (et
`boutique.zip` si tu veux que je vérifie `js/b-wallet.js` / `css/wallet.css`)
dans un nouveau message — je reprends immédiatement la vérification et le
repackaging avec le repo réel sous la main.

---

## Ce qui est livré ici (3 fichiers, contenu confirmé)

| Fichier | Statut | Chemin repo exact |
|---|---|---|
| `wallet.feature.js` | créé | `features/wallet.feature.js` |
| `loyalty.feature.js` | créé | `features/loyalty.feature.js` |
| `wallet-loyalty.feature.js` | déprécié (stub vide, files: {}) | `features/wallet-loyalty.feature.js` (remplace l'existant) |

### wallet — service rendu
> Tenir un solde client et son historique de crédit/débit, avec application exactement une fois.

Ownership : `services/wallet-service.js`, `utils/store-credits.js`,
`routes/wallet.js`, migrations `066_wallet_consumptions_append_only.sql` /
`068_wallets_check_balance.sql`, `js/b-wallet.js`, `css/wallet.css`, 3 fichiers
de tests unitaires.

Tables : `orders: RW` (colonne `wallet_applied_kmf` uniquement), `users: R`,
`wallets/wallet_transactions/wallet_credit_lots/wallet_consumptions: RW`.

### loyalty — service rendu
> Calculer et maintenir le statut de fidélité d'un client et les récompenses associées.

Ownership : `services/loyalty-service.js`, `routes/loyalty.js`, 3 fichiers de
tests unitaires.

Tables : `loyalty_rewards/loyalty_tiers: RW`, `v_loyalty_summary: R`,
`orders: R`, `finance_config: R`, `users: RW` (colonnes
`loyalty_tier_id` et `big_basket_last_notified_count` uniquement).

### wallet-loyalty — déprécié
`files: {}`, `db.tables: []`, `contract` vide. Un champ `verification`
documente que la couverture de test est intégralement redistribuée vers
`wallet.feature.js` et `loyalty.feature.js` (pour satisfaire le ratchet
tests|verification|contracts de `feature-schema-check.js` sans fabriquer de
fausse preuve).

## Tableau ancien owner → nouvel owner

| Ancien owner | Fichier | Nouvel owner | Justification métier |
|---|---|---|---|
| wallet-loyalty | services/wallet-service.js | wallet | solde + historique crédit/débit, invariant d'idempotence propre |
| wallet-loyalty | utils/store-credits.js | wallet | store credits, même service que le solde |
| wallet-loyalty | routes/wallet.js | wallet | 9/9 routes protégées, contrat wallet uniquement |
| wallet-loyalty | services/loyalty-service.js | loyalty | calcul palier + récompenses, écrit uniquement `users.loyalty_tier_id` / `users.big_basket_last_notified_count` |
| wallet-loyalty | routes/loyalty.js | loyalty | 6/7 routes protégées, 1 publique par design (`GET /api/loyalty/tiers`) |
| wallet-loyalty | tests unitaires wallet* | wallet | suit le service |
| wallet-loyalty | tests unitaires loyalty* | loyalty | suit le service |

## Tableau avant / après

| Objet | Avant | Après | Décision |
|---|---|---|---|
| `wallet-loyalty.feature.js` | 1 manifest, 2 services fusionnés | `deprecated`, `files: {}` | scindé, conservé comme trace historique |
| `wallet` | n'existait pas | `production`, feature autonome | nouveau manifest |
| `loyalty` | n'existait pas | `production`, feature autonome | nouveau manifest |
| table `users` | RW déclaré côté wallet-loyalty (globale) | `wallet: R` / `loyalty: RW` (colonnes disjointes) | accès réel scindé par colonne, pas par table entière |

## ONTOLOGY_GAP

Aucun nouveau gap identifié sur ce sous-lot au-delà de celui déjà noté en
O1.1 (collision de nom `sourcing` entre `economic-engine` et `logistics`,
pertinent pour O1.3).

## Statut des gates / tests

Résultats **tels que rapportés dans la session précédente** (non
ré-exécutables ici faute de repo) :

- `feature:registry` : ✔ (0 orphelin, 0 fichier manquant, 0 multipropriété)
- `gate:schema` : ✔ (le stub déprécié ne déclenche qu'un warning non bloquant)
- classification stricte (wallet, loyalty, wallet-loyalty) : ✔
- `arch:check` : ✔
- `gate:touched-files` (scopé O1.2) : ✔
- `gate:docs-lint` : ✖, violation pré-existante sans lien avec ce lot (déjà connue depuis O1.1)
- tests ciblés wallet/loyalty : verts

Ces résultats sont à considérer comme **non vérifiés dans cette session** —
je ne les réaffirme pas, je les rapporte tels quels en attendant de pouvoir
relancer les gates moi-même sur le repo réuploadé.
