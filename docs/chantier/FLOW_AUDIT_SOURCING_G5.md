# G5 — Flow sourcing → ajout produit → mise en vente

> Date : 2026-05-17
> Scope : audit/documentation uniquement

## Résumé

Audit du flow sourcing / catalogue :

1. création fournisseur et mapping fournisseur-produit ;
2. création / modification produit ;
3. enrichissement sourcing ;
4. pricing recommendation / application prix ;
5. variantes / stock / mise en vente ;
6. lien avec purchasing.

Aucune correction de code n'a été appliquée dans ce lot. Les écarts restent rattachés à `I-SWEEP` / `TEST-1` / lots pricing.

## Fournisseurs et mappings

Surface : `routes/purchasing.js` (routes HTTP) + `services/purchasing-trigger-service.js` (engine — A-BE-05 ✅ 2026-05-26).

### Garanties constatées

- Routes fournisseurs protégées admin-only.
- Création fournisseur exige `name` et `platform`.
- Listing masque `api_key_enc` et `api_secret_enc`, expose seulement `has_api_key`.
- Mapping produit → fournisseur exige `product_id`, `supplier_sku`, `supplier_price_aed`.
- Mapping utilise `ON CONFLICT (product_id, supplier_id) DO UPDATE`, donc réactivation/mise à jour idempotente.
- Soft-delete fournisseur : `deleted_at` côté suppliers et product_suppliers.
- Suppression fournisseur bloque si POs confirmées existent, sauf fournisseur test + force-delete.
- Suppression fournisseur annule les POs pending/notified, ou plus largement en mode test forcé.

### Risques / limites

- Le mapping ne semble pas vérifier explicitement que `product_id` existe avant insertion ; la contrainte FK doit donc protéger.
- La suppression fournisseur n'est pas intégrée à une doctrine globale d'annulation commande ; G4 l'a déjà isolé.
- `triggerPurchasing(orderId)` peut créer des POs si fournisseur mappé. Idempotence anti-double PO (I-SWEEP-3B) couverte par tests unitaires A-BE-05 ✅.

## Création / modification produit catalogue

Surface : `routes/products.js`.

### Garanties constatées

- Lecture catalogue publique filtre `is_active = TRUE`.
- Création produit protégée admin-only.
- Modification produit protégée admin-only.
- Suppression produit = désactivation `is_active = FALSE`, pas delete physique.
- UUID produit validé sur endpoints sensibles.
- Champs numériques validés >= 0 côté create/update.
- Image upload admin-only.
- Upload image utilise multer + extension filter ; D6/A6 a rappelé la dette stockage objet persistant.
- Les variantes sont exposées côté détail produit si `has_variants = true`.

### Risques / limites

- Création produit accepte un `price_kmf` manuel obligatoire, sans imposer `pricing-engine`.
- Pas d'audit `price_history` lors de création ou modification directe via `PUT /api/products/:id`.
- `stock` peut être défini manuellement par admin sans journal dédié stock movement.
- `is_available` et `is_active` peuvent diverger ; la lecture catalogue filtre `is_active`, mais pas explicitement `is_available`.
- Upload image local `public/uploads/products` reste non persistant sur Railway, comme documenté par A6.

## Enrichissement sourcing

Surface : `routes/sourcing-engine.js`.

### Garanties constatées

- Toutes les routes admin sourcing sont protégées `authenticate + requireAdmin`.
- Le moteur lit les produits et calcule une analyse portefeuille.
- Seuils sourcing lus depuis `business_rules` avec fallback.
- Le moteur normalise les doublons historiques `cost_kmf/cost_price_kmf` et `weight_kg/weight_g`.
- Écriture `PUT /api/admin/sourcing/products/:id` synchronise `cost_price_kmf → cost_kmf` et `weight_g → weight_kg`.
- `last_review_at` mis à jour à chaque enrichissement sourcing.
- Bulk rail admin-only.
- Analyse signale gaps, qualité, poids, marge, lifecycle, rotation 30j.

### Risques / limites

- Les fallbacks business_rules permettent au moteur de fonctionner, mais peuvent masquer une config manquante.
- L'analyse donne des suggestions, mais n'empêche pas un produit actif sans validation qualité.
- Le moteur signale produit actif sans qualité validée, mais ne bloque pas la mise en vente.

## Variantes produit

Surface : `PUT /api/admin/sourcing/products/:id/variants`.

### Garanties constatées

- Admin-only.
- Transaction explicite.
- Verrou `FOR UPDATE` sur produit.
- Maximum 50 variantes.
- Validation type/value/stock/price.
- Détection doublons `(type,value)`.
- Garde-fou : refuse suppression d'une variante référencée par une commande `pending` / `pending_group_payment`.
- Remplacement atomique : delete puis insert dans la même transaction.
- Flag `products.has_variants` mis à jour.

### Risques / limites

- Le garde-fou ne regarde que les commandes pending/pending_group_payment. Supprimer une variante déjà achetée dans une commande plus avancée peut rester acceptable si snapshot dans order_items, mais à confirmer.
- Stock variantes modifiable manuellement sans journal stock movement dédié.

## Pricing recommendation et application prix

Surface : `routes/pricing.js`.

### Garanties constatées

- `/api/pricing/recommend` appelle le service `pricing-engine` en complément des champs legacy.
- Le pricing lit `finance_config`, `customs_categories`, `pricing_components`, `risk_provisions`, `charges`.
- `/api/pricing/apply-price/:product_id` admin-only.
- Garde-fou : refuse un prix sous `survival_price_kmf` si fourni dans le body.
- `price_history` est alimenté lors de `apply-price`, avec scénario si colonnes disponibles.
- `/api/pricing/apply-all` admin-only et transactionnel.

### Risques / limites

- Le garde-fou sous survival dépend du body envoyé. Si le caller ne fournit pas `survival_price_kmf`, la route applique quand même le prix.
- `apply-all` ne semble pas écrire `price_history`, contrairement à `apply-price`.
- `PUT /api/products/:id` peut modifier `price_kmf` directement sans `price_history` ni garde-fou survival.
- `POST /api/products` peut créer un prix sous coût sans passer par pricing engine.
- L'invariant I-08 vise à lire les composantes DB et éviter les coefficients durs : le pricing avancé le fait, mais le catalogue admin peut contourner la doctrine par prix manuel.

## Lien avec purchasing / mise en vente

### Garanties constatées

- `triggerPurchasing(orderId)` (dans `services/purchasing-trigger-service.js`) utilise les mappings `product_suppliers` actifs et fournisseurs actifs.
- Le meilleur fournisseur est choisi par `priority ASC`.
- Les POs restent dans leur propre lifecycle ; l'ordre reste `ordered` jusqu'à réception complète.
- Réception complète transitionne l'ordre vers `preparation` via machine.

### Risques / limites

- Un produit peut être mis en vente sans fournisseur mappé ; `triggerPurchasing` notifiera admin `no_supplier`, mais cela intervient après paiement/commande.
- Il n'y a pas de blocage catalogue pour produit actif sans supplier mapping, sans coût, sans poids, sans qualité validée.
- Les champs `is_active`, `is_available`, `quality_validated`, `sourcing_rail`, `lifecycle_status` ne forment pas encore une machine de publication stricte.

## Conclusion G5

Le flow sourcing/catalogue est exploitable et admin-only, avec de bons garde-fous sur les variantes, les mappings fournisseurs et le pricing avancé.

Les dettes principales concernent la gouvernance de mise en vente : aujourd'hui, un admin peut publier/modifier un produit avec prix/stock manuel en contournant la doctrine pricing et sans journal stock/prix complet.

## À rattacher à I-SWEEP / TEST-1 / pricing hardening

- Ajouter un test : produit actif sans supplier mapping → commande Stripe payée → triggerPurchasing doit créer alerte no_supplier sans casser paiement.
- Ajouter un test : `apply-price` sous survival refusé si survival fourni.
- Durcir `apply-price` pour recalculer `survival_price_kmf` côté serveur, au lieu de dépendre du body.
- Ajouter `price_history` sur `apply-all` ou interdire apply-all sans audit par item.
- Ajouter audit price_history sur `PUT /api/products/:id` quand `price_kmf` change.
- Ajouter journal stock movement pour changements manuels de stock produit/variante.
- Clarifier doctrine de publication : produit visible seulement si `is_active && is_available && quality_validated` ou exception assumée.
- Sortir l'upload image local vers stockage objet persistant avant Go Live.
