# D4 — Audit QR / pickup-secret

> Date : 2026-05-17
> Scope : audit/documentation uniquement

## Résumé

Audit des mécanismes de retrait client :

- QR de retrait : `routes/orders/qr.js`
- Code secret de retrait : `routes/pickup-secret.js`
- Scan retrait : `routes/scans.js`

Aucune correction de logique métier n'a été appliquée dans ce lot.

## QR de retrait — `routes/orders/qr.js`

### Garanties constatées

- Génération réservée à `admin` et `agent_relais`.
- Génération possible uniquement si la commande est `available`.
- Token généré à partir de `orderId`, `relaisId`, timestamp et `QR_SECRET`.
- Fallback `QR_SECRET` supprimé lors de D0.
- Expiration pilotée par `QR_EXPIRATION_HOURS`, avec défaut 48h.
- Page publique `/retrait/:token` vérifie l'existence du token et affiche l'expiration.
- Validation finale réalisée par `/api/scans/verify-qr`.
- Après validation QR réussie, `qr_token` et `qr_expires_at` sont remis à `NULL` dans la transaction.

### Risques et limites

- `qr.js` commente encore que `QR_SECRET` est obligatoire via `scripts/validate-required-env.js`, alors que le hotfix D0 a retiré la validation pre-start de `package.json`.
- Si `QR_SECRET` est absent au runtime, la génération utilise implicitement la chaîne `undefined` dans le hash. Ce n'est pas un fallback codé en dur, mais cela reste une configuration dangereuse.
- La page publique charge une librairie QR depuis CDN ; risque opérationnel si réseau indisponible côté client.
- Le HTML public ne fait pas d'échappement systématique des champs injectés (`reference`, `client_name`, `relais_name`, `relais_address`). Les valeurs viennent de la DB, mais ce point mérite une passe sécurité front/server-side rendering.

## Pickup secret — `routes/pickup-secret.js`

### Garanties constatées

- Modèle de code secret inspiré Western Union.
- Code généré au moment du paiement ou par régénération admin.
- Code clair renvoyé une seule fois selon le canal.
- Hash stocké en DB avec salt par commande.
- Code expirant à 60 jours.
- Alphabet sans caractères ambigus.
- Anti-collision sur `pickup_secret_last4` par relais actif.
- Vérification avec rate-limit par commande : 3 tentatives puis blocage 15 min sur `/verify/:orderId`.
- Régénération réservée admin avec motif obligatoire.
- Status endpoint ne révèle jamais le code complet.
- Reveal-once vérifie le propriétaire de la commande et impose une fenêtre de 30 minutes.

### Risques et limites

- Les tokens d'impression sont stockés en mémoire process (`printTokens`). En multi-instance ou après redémarrage, le reçu one-shot peut être perdu.
- `REVEAL_CACHE` est également en mémoire process. En cas de redémarrage, le client doit passer par procédure de perte.
- Le fichier contient déjà des TODO indiquant que Redis serait préférable pour le multi-instance.
- La logique de génération anti-collision existe à la fois dans `generateAndStoreSecret`, `/pay-cash` et `/regenerate`. Le risque est surtout de divergence future.
- `/pay-cash` modifie directement `orders.status = 'confirmed'` dans un `UPDATE`, ce qui semble en tension avec l'invariant I-01. Ce point doit être traité séparément, car corriger cela touche la machine de statut et le flux paiement cash.

## Scan retrait — `routes/scans.js`

### Garanties constatées

- Le endpoint générique `POST /api/scans` exclut `collected` des steps autorisés.
- Le retrait classique passe par `/api/scans/collect` avec rôle `admin` ou `agent_relais`.
- `collect` utilise `SELECT ... FOR UPDATE` pour éviter double-validation simultanée.
- Cross-relais check : un `agent_relais` ne peut valider qu'au relais auquel il est affecté.
- Agent relais sans `relais_id` : refus strict.
- En cas de cross-relais invalide, compteur d'échecs et blocage temporaire après 5 tentatives.
- Succès retrait : passage par `safeSyncScanToParcels` et fallback machine si pas de colis.
- `verify-qr` invalide le QR dans la même transaction que la transition `collected`.

### Risques et limites

- `/api/scans/collect` reste basé sur un `pickup_code` classique, distinct du modèle `pickup_secret`. Le risque de confusion opérationnelle entre ancien code de retrait et nouveau pickup secret doit être surveillé.
- Les tentatives invalides par `pickup_code` inconnu sont journalisées mais ne peuvent pas incrémenter un compteur par commande, puisqu'aucune commande n'est identifiée.
- `verify-qr` ne fait pas de cross-relais check équivalent à `/collect`. Il exige seulement rôle `admin` ou `agent_relais`. À analyser avant Go Live si les QR sont utilisés en relais multiples.

## Conclusion D4

D4 est validé côté audit.

Aucun correctif automatique n'a été appliqué, car les points les plus importants touchent des zones sensibles : machine de statut, multi-instance Redis, QR public et retrait relais.

## Points à suivre

1. Créer un lot dédié pour remettre `/pay-cash` dans la machine de statut si confirmé hors machine.
2. Créer un lot multi-instance pour remplacer `printTokens` et `REVEAL_CACHE` par Redis ou équivalent.
3. Vérifier que `QR_SECRET` est garanti au runtime malgré le hotfix D0.
4. Étudier un cross-relais check dans `/api/scans/verify-qr`.
5. Échapper systématiquement les champs injectés dans le HTML public QR.
