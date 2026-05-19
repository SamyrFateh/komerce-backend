# Audit Backend Komerce — Findings

> Lecture du backend `komerce-backend.zip` + `schema.sql` du 3 mai 2026,
> dans le contexte de préparation de la Vague 3 (variantes produits).

---

## ✅ Bons points (à conserver)

1. **Architecture en services centralisés** :
   `services/order-payment-confirmation.js::confirmPaymentCycle` est le **point
   d'entrée unique** pour le cycle paiement→stock. C'est exactement le bon
   pattern, R5 respecté avec `FOR UPDATE OF p` ligne 128.

2. **State machine fermée** :
   `services/order-status-machine.js::transitionOrderStatus` enforce les
   transitions valides. R3 protégé.

3. **`order_items` déjà préparé pour les options produit** :
   Les colonnes `module_type, module_size, module_fabric_id, module_fabric_type,
   module_retouche, module_qty_meters, module_accessories` couvrent déjà le cas
   "couture sur mesure". C'est un précédent qui valide l'approche
   "options-spécifiques-par-item".

4. **`products.images` existe déjà** comme JSON array — le carousel mobile
   du frontend l'utilise déjà.

5. **Validation Joi systématique** via `middleware/validate.js`, validators
   factorisés dans `validators/`. Pattern uniforme à reproduire pour les
   variantes.

6. **Migrations bien numérotées et idempotentes** (`IF NOT EXISTS` partout).
   Dernière en date : `062_boutique_categories_seed.sql`.

---

## ⚠️ Points d'attention découverts pendant l'audit

### 1. Deux conventions UUID coexistent

- `db/schema.sql` (boot initial) : `uuid_generate_v4()` (extension `uuid-ossp`)
- Migrations récentes (044+) : `gen_random_uuid()` (extension `pgcrypto`)

**Recommandation :** garder cette dualité (ne pas migrer le legacy), mais
**toutes les nouvelles migrations doivent utiliser `gen_random_uuid()`** pour
rester cohérentes avec la convention récente. La migration `063_product_variants.sql`
livrée respecte cette règle.

### 2. Colonnes `module_*` dans `order_items` non documentées dans le schema

Le code de `routes/orders/create.js` ligne 312-329 insère des valeurs dans
les colonnes `module_type, module_fabric_id, module_fabric_type, module_size,
module_retouche, module_qty_meters, module_accessories`. **Mais aucune
migration que j'ai lue n'ajoute ces colonnes**. Il y a deux possibilités :

- une migration manquante dans le zip que j'ai reçu
- ces colonnes ont été ajoutées hors-migration (à la main en prod, ou dans
  une migration qui a été perdue/supprimée)

**À vérifier côté propriétaire** : est-ce que ces colonnes existent réellement
dans la DB de production ? Si oui, où est la migration qui les a créées ?
Sinon le code de `create.js` plante en prod sur les commandes couture.

### 3. `routes/orders/create.js` — point de validation stock à refaire

La validation stock actuelle (ligne 171) est **dupliquée** entre :
- `routes/orders/create.js::POST /api/orders` (vérif au moment de créer la commande)
- `services/order-payment-confirmation.js::confirmPaymentCycle` (vérif au moment de confirmer le paiement)

C'est intentionnel (le stock peut bouger entre les deux moments), mais il faut
penser à mettre à jour les **deux** quand on ajoute la logique variantes,
sinon on ouvre une fenêtre de race où une combo peut être validée à la
création mais en rupture au paiement.

La spec V2 traite ce point.

### 4. Beaucoup de routes (76 fichiers dans `routes/`)

Le projet est plus mûr que ce que je supposais en V1. Pour la Vague 3, on
ne touche qu'à 3 fichiers routes (`products.js`, `orders/create.js`) et 1
service (`order-payment-confirmation.js`). Faible blast radius.

### 5. Pas de cache applicatif visible sur `GET /api/products/:id`

Si un cache CDN est mis devant l'API en prod (Cloudflare, Railway, etc.),
il faudra penser à l'invalider après `POST /api/products/:id/variants`.
Pas de pattern de cache invalidation dans le code que j'ai lu.

**Action recommandée :** au moment de la PR-VAR-3, ajouter un commentaire
dans le code admin qui rappelle "vérifier la config cache devant l'API".

---

## 🟢 Compatibilité frontend / backend

Le frontend (déjà déployé) attend de `GET /api/products/:id` :
```json
{
  "has_variants": true,
  "variants": {
    "Taille": [{"value": "M", "stock": 0, ...}, ...]
  }
}
```

Et envoie à `POST /api/orders` :
```json
{
  "items": [{
    "product_id": "...",
    "quantity": 1,
    "variant_combo": {"Taille": "M", "Couleur": "Bleu"}
  }]
}
```

**Ces formats sont 100% compatibles avec la spec V2 livrée.** Pas d'adaptation
frontend nécessaire quand le backend sera prêt.

---

## 📋 Décisions d'architecture à valider avec le propriétaire

Avant de coder la Vague 3, valide ces 5 points :

1. **OK pour créer une nouvelle table `product_variants` séparée des colonnes `module_*`** existantes (cohabitation, pas de migration des `module_*`) ?

2. **OK pour stocker la combo en `variant_combo jsonb`** sur `order_items`
   (au lieu d'une FK vers `product_variants`), pour que l'historique des
   commandes reste valide même si une variante est supprimée plus tard ?

3. **OK pour la sémantique du stock** : `product_variants.stock` peut être
   NULL ("non géré par cette variante"), 0 (rupture), ou positif. Le stock
   global du produit n'est PAS la somme des stocks variantes (les deux sont
   indépendants).

4. **OK pour la migration en 4 phases rollback-ables** (cf. spec V2 §7) ?

5. **Qui fait l'UI admin de saisie des variantes** ? Ce n'est pas dans la
   spec backend, c'est un autre chantier (admin frontend).

---

## 📦 Livrables de cette session

- `SPEC_BACKEND_VAGUE_3_VARIANTES_V2.md` — spec complète révisée après audit
- `063_product_variants.sql` — migration prête à appliquer (PR-VAR-1, syntaxe Postgres validée)
- `AUDIT_BACKEND_FINDINGS.md` — ce document

**Aucune ligne de code backend n'a été touchée**, conformément à ce qui était
demandé (préparation, pas exécution).
