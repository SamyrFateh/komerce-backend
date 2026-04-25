# Doctrine économique Komerce

> Document de référence pour l'alignement du moteur économique, du pricing,
> du sourcing et des dashboards. Toute évolution future doit s'y conformer.

---

## 1. Phrase de vérité

> Komerce ne cherche pas le prix parfait au lancement.
> Komerce cherche un prix protégé qui permet d'apprendre le marché sans vendre à perte,
> puis utilise les signaux réels pour décider quoi sourcer, renforcer, corriger ou arrêter.

---

## 2. Doctrine centrale

| Unité économique | Rôle |
|---|---|
| Le **produit** | fixe le prix |
| Le **colis** | porte les coûts logistiques |
| Le **shipment** | porte la vérité terrain globale |
| La **commande collectée** | prouve la rentabilité |
| Le **mois** | mesure si le business tient |

---

## 3. Séparation des rôles

### 3.1 Pricing Dashboard — Atelier produit / prix / sourcing

Répond à : *Ce produit peut-il être vendu ? À quel prix ? Faut-il le sourcer, le tester, le renforcer ou l'éviter ?*

Niveau de travail : produit, catégorie, ligne de commande, signaux marché, décision sourcing.

Affiche : prix actuel, 4 prix doctrinaux, CDR, marge, contribution, market_confidence,
sourcing_decision, raison humaine.

### 3.2 Moteur Économique — Santé globale du business

Répond à : *Est-ce que le modèle Komerce tient globalement ?*

Niveau de travail : mois, charges fixes, commandes collectées, panier moyen, contribution moyenne,
seuil de rentabilité.

Affiche : CA mensuel, commandes collectées, panier moyen, coût variable moyen, contribution moyenne,
charges fixes mensuelles, seuil de rentabilité, marge réelle moyenne, alertes globales.

### 3.3 Boucle d'apprentissage

```
Moteur économique
    └─ hypothèses globales (taux, charges, objectif/mois)
        └─ Pricing produit
            └─ Vente
                └─ Colis / Shipment
                    └─ Coûts réels
                        └─ Contribution réelle
                            └─ Moteur économique enrichi
```

---

## 4. Les 4 prix à calculer

### 4.1 Prix de survie (`survival_price_kmf`)

```
survival_price_kmf = coûts variables estimés UNIQUEMENT (sans risques, sans fixe)
```

Utilité : promo, déstockage, test agressif, produit d'appel.
**Ne couvre pas les charges fixes.**

### 4.2 Prix minimum sûr (`minimum_safe_price_kmf`)

```
minimum_safe_price_kmf = variables + provisions risques + part charges fixes
                      = cost_complete_estimated_kmf
```

En dessous → **alerte rouge**.

### 4.3 Prix conseillé (`recommended_price_kmf`)

```
recommended_price_kmf = cost_complete_estimated_kmf / (1 - target_margin_pct)
```

⚠️ `target_margin_pct` en **décimal** (40 % = 0.40).

⚠️ Ne pas confondre marge et markup :
- Mauvais : `price = cost * (1 + 0.40)`
- Bon : `price = cost / (1 - 0.40)`

### 4.4 Prix test marché (`test_price_kmf`)

Prix réellement recommandé pour tester le marché.

**Règle absolue** : `test_price_kmf >= minimum_safe_price_kmf` sauf décision admin
explicite (promo, déstockage, produit d'appel).

---

## 5. Coût de revient complet

```
cost_complete_estimated_kmf =
    product_cost_kmf
  + sourcing_cost_kmf
  + hub_variable_cost_kmf
  + freight_estimated_kmf
  + customs_estimated_kmf
  + port_transitaire_estimated_kmf
  + local_distribution_estimated_kmf
  + payment_cost_estimated_kmf
  + risk_provision_estimated_kmf
  + fixed_cost_allocation_kmf
```

```
variable_cost_estimated_kmf = cost_complete_estimated_kmf - fixed_cost_allocation_kmf
```

```
fixed_cost_allocation_kmf = monthly_fixed_costs_kmf / target_orders_per_month
```

> Si `target_orders_per_month` absent : valeur par défaut configurable + warning.

```
estimated_margin_pct      = (current_price - cost_complete_estimated) / current_price
estimated_contribution    = current_price - variable_cost_estimated
real_contribution         = paid_amount - variable_cost_real
monthly_break_even_orders = monthly_fixed_costs / average_contribution_per_order
```

---

## 6. Ventilation douane / fret (vérité terrain)

### 6.1 Doctrine

- On **estime** au produit avant vente
- On **constate** au shipment / colis après terrain
- On **ventile** intelligemment vers colis, lignes de commande et commandes

### 6.2 Douane

**Estimée avant vente** :
```
customs_estimated = product_cost * customs_rate_by_category
```
(`customs_rate_by_category` vient de `customs_categories`)

**Réelle après terrain** :
```
customs_real_total = montant réellement payé (shipment ou colis)
```

**Ventilation MVP** (par valeur achat) :
```
item_share = item_purchase_value / total_purchase_value
customs_allocated_to_item = customs_real_total * item_share
```

**Ventilation cible** (valeur × coefficient risque catégorie) :
```
customs_weight_item = item_purchase_value * customs_risk_coeff
customs_allocated_to_item = customs_real_total * customs_weight_item / total_customs_weight
```

### 6.3 Fret

**Méthode simple** :
```
freight_allocated_to_item = freight_real_total * item_weight / total_weight
```

**Méthode cible** :
```
taxable_weight = max(real_weight, volumetric_weight)
freight_allocated_to_item = freight_real_total * item_taxable_weight / total_taxable_weight
```

### 6.4 Port / transitaire / manutention

Ventilation par colis, par commande, ou par valeur (selon donnée disponible).
MVP : par colis puis par commande.

### 6.5 Relais

Coût par commande collectée (forfait ou commission selon modèle réel).

### 6.6 Paiement

Selon canal réel : Stripe (frais % + fixe) ou cash relais (pas de Stripe mais
risque non-collecte / impayé).

### 6.7 Implémentation — `services/cost-allocation.js` (Lot C)

Le service expose 5 fonctions de ventilation et 2 helpers purs :

| Fonction | Rôle | État |
|---|---|---|
| `allocateCustomsCost(shipmentId)` | Ventile la douane d'un shipment vers ses colis | **Stub** (renvoie `is_stub: true`) |
| `allocateFreightCost(shipmentId)` | Ventile le fret d'un shipment | **Stub** |
| `allocateShipmentCosts(shipmentId)` | Orchestre douane + fret + port + transitaire | **Stub** |
| `computeOrderRealContribution(orderId)` | Contribution réelle d'une commande (paid - coûts réels) | **Partiel** (produits OK, logistique stub) |
| `computeOrderRealMargin(orderId)` | Marge réelle d'une commande | **Partiel** |
| `shareByWeight(total, entries)` | Helper pur de ventilation proportionnelle | ✅ Fonctionnel |
| `taxableWeight(kg, m³, mode)` | Helper pur poids taxable (max réel/volumétrique) | ✅ Fonctionnel |

**Pourquoi des stubs ?** La vérité terrain (douane réelle, fret réel) n'est
pas encore systématiquement saisie en production. Les fonctions retournent
un résultat avec `is_stub: true` et une `reason` explicite tant que les
tables ne sont pas remplies. Quand le terrain produit de la donnée réelle,
il suffit de remplacer les TODO marqués dans le code, sans modifier les
signatures.

**Tables consommées (quand l'implémentation sera complétée)** :
- `customs_shipments` : facture douanière (cif_value, customs_paid, freight, méthode)
- `customs_shipment_parcels` : ventilation calculée par colis
- `customs_history` : historique douane par parcel (estimated vs real)
- `parcels`, `parcel_items` : colis et leur contenu
- `orders`, `order_items` : pour agréger au niveau commande

---

## 7. Santé prix (`health_status`)

| Statut | Règle |
|---|---|
| `loss` | `current_price < cost_complete_estimated` |
| `danger` | `estimated_margin_pct < 15 %` |
| `fragile` | `15 % ≤ estimated_margin_pct < 25 %` |
| `healthy` | `25 % ≤ estimated_margin_pct ≤ 40 %` |
| `strong` | `estimated_margin_pct > 40 %` |
| `unknown` | données insuffisantes |

### Alertes

1. Prix actuel < coût complet → **critique**
2. Marge < 15 % → **critique**
3. Marge entre 15 % et 25 % → **warning**
4. Contribution < part charges fixes → **warning**
5. Seuil rentabilité > objectif mensuel → **warning**
6. Coût réel > 15 % de l'estimé → **warning** (terrain)
7. Douane réelle > 20 % de l'estimé → **warning** (terrain)
8. Fret réel > 15 % de l'estimé → **warning** (terrain)

---

## 8. Confiance marché (`market_confidence`)

| Niveau | Critère | Action |
|---|---|---|
| `unknown` | jamais testé | Petite quantité, prix prudent, pas de gros sourcing |
| `testing` | 1-5 ventes payées | Observer vues, paniers, commandes |
| `validated` | 6-20 ventes payées | Renforcer sourcing |
| `scaling` | > 20 ventes + repeat | Augmenter volume, créer variantes |
| `rejected` | 60+ jours sans vente OU > 50 % retours | Changer photo/prix/promo ou arrêter |

### Signaux marché à intégrer (quand disponibles)

- `product_views`
- `add_to_cart_count`
- `checkout_started_count`
- `paid_orders_count`
- `cart_abandon_rate`
- `conversion_rate`
- `questions_whatsapp_count`
- `days_to_first_sale`
- `repeat_purchase_signal`

> Si données absentes : `market_confidence = unknown` + warning
> *« Données marché insuffisantes. Recommandation basée sur coûts et hypothèses. »*

---

## 9. Décision sourcing (`sourcing_decision`)

| Décision | Critères | Action |
|---|---|---|
| `PRIORITY` | bonne marge + faible complexité + signal positif | Sourcer plus, négocier, mettre en avant |
| `TEST` | marge correcte mais demande inconnue | Petite quantité, prix test, observation |
| `WATCH` | marge fragile ou coûts terrain incertains | Surveiller, renégocier, ajuster |
| `AVOID` | faible marge + lourd/volumineux/fragile | Ne pas sourcer massivement |
| `LOSS` | vendu sous coût | Corriger prix ou retirer |

### Règles décisionnelles

| Marge | Demande | → Décision |
|---|---|---|
| Bonne | Inconnue | TEST |
| Bonne | Positive | PRIORITY |
| Faible | Positive | WATCH (RENEGOTIATE / INCREASE_PRICE) |
| Faible | Faible | AVOID |
| Forte | Faible | WATCH (améliorer photo/offre) |
| Tout | Coûts terrain instables | WATCH |
| Tout | Lourd / volumineux / fragile | AVOID sauf demande spécifique |

> **Important** : ne pas automatiser brutalement les changements de prix.
> Le moteur **recommande**. L'admin **décide**.

---

## 10. Sortie de `/api/pricing/recommend`

Voir `services/pricing-engine.js` pour l'implémentation exacte.

```json
{
  "product_id": "...",
  "category": "...",
  "channel": "...",

  "current_price_kmf": 0,

  "survival_price_kmf": 0,
  "minimum_safe_price_kmf": 0,
  "recommended_price_kmf": 0,
  "test_price_kmf": 0,

  "cost_complete_estimated_kmf": 0,
  "variable_cost_estimated_kmf": 0,
  "fixed_cost_allocation_kmf": 0,
  "risk_provision_estimated_kmf": 0,

  "target_margin_pct": 40,
  "estimated_margin_pct": 0,
  "estimated_contribution_kmf": 0,

  "monthly_fixed_costs_kmf": 0,
  "target_orders_per_month": 0,
  "monthly_break_even_orders": 0,

  "market_confidence": "unknown",
  "sourcing_decision": "TEST",
  "health_status": "unknown",

  "reason": "Explication lisible humainement.",
  "alerts": [],
  "warnings": [],

  "details": {
    "product_cost": 0,
    "sourcing": 0,
    "hub": 0,
    "freight": 0,
    "customs": 0,
    "port_transitaire": 0,
    "distribution": 0,
    "payment": 0,
    "risks": 0,
    "fixed_costs": 0
  }
}
```

> Les champs **legacy** (`prix_recommande_kmf`, `niveau1`, `niveau2`, `niveau3`,
> `cout_total_kmf`, `marge_cible_pct`, `marge_atteinte_pct`) sont **conservés**
> pour ne pas casser les consommateurs existants. Ils seront retirés progressivement.

---

## 11. Modules mis en pause

| Module | Statut | Raison |
|---|---|---|
| Pricing strategy avancé | Caché menu | Trop avancé sans données réelles |
| Benchmarks concurrents | Caché menu | Théorique tant que pas de scraping |
| Élasticité-prix | Désactivé | Pas assez de changements de prix |
| Loss leader automatique | Désactivé | Toute décision prix passe par admin |
| `apply-all` massif | Désactivé | Garde-fou anti-erreur |

---

## 12. Sources de vérité (tables BDD)

| Table | Rôle |
|---|---|
| `finance_config` (singleton) | Taux change, charges mensuelles, marge cible, objectif/mois |
| `customs_categories` | Douane / TVA / marge cible par catégorie |
| `pricing_components` | Variables Niveau 1 (par commande) |
| `risk_provisions` | Provisions Niveau 3 (% sur subtotal) |
| `charges` | Charges fixes mensuelles (Niveau 2) |
| `price_history` | Audit des changements de prix |
| `products` | Cost, weight, current_price |
| `orders` + `order_items` | Source des signaux marché (paid_orders_count) |
| `customs_shipments` | Vérité terrain douane (à exploiter) |
| `parcels` + `shipments` | Vérité terrain logistique (à exploiter) |

---

## 13. Tests d'acceptation

| Test | Input | Output attendu |
|---|---|---|
| 1 | cost_complete = 10 000, margin = 40 % | recommended ≈ 16 667 |
| 2 | current = 9 000, cost = 10 000 | health = `loss` |
| 3 | current = 12 500, cost = 10 000 | margin = 20 %, health = `fragile` |
| 4 | contribution = 3 000, fixed_alloc = 5 000 | alerte contribution insuffisante |
| 5 | charges fixes = 800 000, contrib moyenne = 4 000 | break_even = 200 |
| 6 | produit sans données | confidence = `unknown`, decision = `TEST/WATCH` |
| 7 | marge bonne + demande positive | decision = `PRIORITY` |
| 8 | marge faible + lourd | decision = `AVOID` |

---

## 14. Règle finale

Si tu hésites entre **ajouter une couche complexe** ou **simplifier autour de** :

> CDR → prix protégé → prix test → contribution → seuil → décision → apprentissage

**Choisis toujours la simplification.**

Le système doit être compréhensible par un humain non technique.

> *« Ce produit coûte 8 000 KMF tout compris. Pour viser 40 % de marge, il faut le vendre au moins 13 333 KMF. Le prix test conseillé est 12 990 KMF car la demande marché est encore inconnue, mais il reste au-dessus du prix minimum sûr. Recommandation : TEST en faible quantité, ne pas sourcer massivement avant signal public. »*

C'est ça l'objectif.
