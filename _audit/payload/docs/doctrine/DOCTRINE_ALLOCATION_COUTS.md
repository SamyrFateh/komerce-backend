# Doctrine d'Allocation des Coûts Komerce

> **Version** : pré-2026 — non datée. Revue de conformité requise (audit 2026-07-01).

> *Komerce price avec des moyennes, mesure le réel, ajuste les moyennes.*

---

## 1. Principe fondateur

Komerce engage des coûts à plusieurs niveaux du process logistique. Pour pricer
un article, il faut **imputer** sa juste part de chaque coût engagé.

L'article seul ne porte pas tous les coûts. Mais c'est lui qui se vend. Donc le
moteur traduit `coût engagé → coût imputé à l'article`.

---

## 2. Les 4 niveaux d'engagement

```
🌍 SHIPMENT       1 conteneur LCL Dubai → Moroni (~10 m³, ~200 articles)
   └─ 📦 COLIS    un carton sortant du hub (~4 articles)
       └─ 📋 COMMANDE  un client (~2.5 articles)
           └─ 🏷️ ARTICLE  un produit final (1 article)

CHARGES MENSUELLES   loyers, salaires, logiciels (à diluer sur N commandes/mois)
```

---

## 3. Règles d'imputation

| Coût engagé à... | Imputation à l'article |
|---|---|
| 🏷️ Article (achat, sourcing, QC) | 100% au prix |
| 📋 Commande (commission relais, Stripe) | ÷ `avg_articles_per_order` |
| 📦 Colis (emballage, transport local) | ÷ `avg_articles_per_parcel` |
| 🌍 Shipment (fret, port, transitaire forfait) | ÷ `avg_articles_per_shipment` |
| 🗓️ Mensuel (charges fixes) | ÷ `avg_orders_per_month` ÷ `avg_articles_per_order` |

---

## 4. Le modèle commercial : prix fixe + promos

**Prix affiché au client = stable, basé sur les moyennes.** Mariama voit toujours
le même prix sur la robe, qu'elle commande seule ou avec 5 autres articles.

**La marge réelle par commande varie** autour d'une cible. La marge globale
mensuelle tombe juste **par construction** des moyennes (à condition qu'elles
soient honnêtes).

**Stratégie commerciale recommandée :**
- Prix de base = coût imputé moyennes + **marge confortable**
- Promos ciblées pour redescendre vers le client si besoin
- Le système alerte si une promo s'approche du `minimum_safe_price`

Doctrine respectée : pricer une fois proprement, ajuster commercialement après.

---

## 5. Les 3 vues de coût

Pour chaque produit, le système maintient **3 vues distinctes** :

### Vue 1 — Prix affiché (vitrine)
- Calculé une fois par produit, basé sur les moyennes d'allocation
- Stable, prévisible, communicable
- C'est ce que le client voit et paie

### Vue 2 — Coût imputé théorique (par commande)
- Lock-in dans la BDD au moment de la commande
- "On pense que cet article a coûté X à Komerce"
- Sert à la prévision de marge

### Vue 3 — Coût engagé réel (a posteriori)
- Calculé une fois le shipment livré, le colis distribué, la commande bouclée
- "En vrai, cet article a coûté Y à Komerce"
- L'écart `(X − Y)` est traçable et permet de recalibrer les moyennes

---

## 6. Traçabilité dans la réponse API

Le moteur `/api/pricing/recommend` retourne un champ `cost_breakdown.allocations[]` :

```json
{
  "cost_breakdown": {
    "landed_relay": [...],
    "business": [...],
    "allocations": [
      {
        "component_key": "fret_maritime_eur_m3",
        "component_label": "Fret maritime",
        "category": "freight",
        "unit": "eur",
        "engaged_amount_kmf": 443,
        "engaged_level": "article",
        "allocation_divisor": 1,
        "imputed_amount_kmf": 443
      },
      {
        "component_key": "frais_portuaires_kmf",
        "engaged_amount_kmf": 12000,
        "engaged_level": "shipment",
        "allocation_divisor": 200,
        "imputed_amount_kmf": 60
      },
      {
        "component_key": "commission_relais_kmf",
        "engaged_amount_kmf": 500,
        "engaged_level": "order",
        "allocation_divisor": 2.5,
        "imputed_amount_kmf": 200
      }
    ],
    "allocation_averages": {
      "articles_per_order": 2.5,
      "articles_per_parcel": 4.0,
      "articles_per_shipment": 200.0,
      "confidence": "low"
    }
  }
}
```

---

## 7. Configuration des moyennes

Stockées dans `finance_config` (table singleton) :

| Champ | Hypothèse initiale | À recalibrer après... |
|---|---:|---|
| `avg_articles_per_order` | 2.5 | 50 commandes réelles |
| `avg_articles_per_parcel` | 4.0 | 10 expéditions réelles |
| `avg_articles_per_shipment` | 200.0 | 1 shipment réel |
| `avg_orders_per_month` | 50.0 | 3 mois d'exploitation |
| `allocation_confidence` | `low` | mis à `medium` ou `high` après calibrage |
| `allocation_calibrated_at` | NULL | timestamp du dernier recalibrage |
| `allocation_notes` | NULL | contexte du calibrage |

---

## 8. Warnings et garde-fous

Le moteur émet un warning explicite si :
- Les moyennes sont en `confidence='low'` ET au moins un coût > niveau article est appliqué
- Le composant n'a pas de `default_value`
- Les moyennes sont incohérentes (par ex. `articles_per_parcel > articles_per_shipment`)

Pour pricer sereinement, ces warnings doivent être **lus et compris**, pas ignorés.

---

## 9. Roadmap par étapes

| Phase | Effort | État | Contenu |
|---|---|---|---|
| **3a — Moteur prêt à imputer** | ~3h | ✅ FAIT | Migration 045 + `pricing-engine` divise + traçabilité dans réponse |
| **3b — Lock-in théorique en BDD** | ~2h | À faire | Table `order_cost_imputations` qui stocke le détail à chaque commande |
| **3c — UI Atelier traçable** | ~2h | À faire | Atelier affiche engagé / niveau / imputé pour chaque ligne |
| **3d — Calcul a posteriori du réel** | ~4h | À faire | Job qui calcule les vrais ratios depuis commandes/colis/shipments |
| **3e — Tableau d'écart Santé Éco** | ~3h | À faire | Vue admin "Imputé vs Réel" avec recalibrage assisté |

---

## 10. Limites assumées au démarrage

- **Les moyennes sont des hypothèses**. Confidence='low'. Le moteur émet un warning.
- **Pas d'audit auto Engagé vs Réel** au début (Phase 3d).
- **Pas d'allocation différenciée par catégorie** (Phase ultérieure).

Ces limites sont **acceptées et documentées**. Mieux vaut une approximation
honnête qu'une fausse précision.

---

## 11. Pourquoi c'est important

> *« Komerce ne part pas du produit, il part du coût rendu relais. »*

La doctrine d'allocation est ce qui permet de **respecter cette règle**
mathématiquement. Sans elle, le pricing-engine sous-évalue ou surévalue
silencieusement les coûts par shipment/colis/commande, et la marge réelle
diverge du calcul théorique.

Avec elle, chaque article porte **sa juste part** des coûts engagés à tous les
niveaux. La marge globale mensuelle tombe juste par construction.

C'est la différence entre un pricing qui marche **par chance** et un pricing
qui marche **par conception**.
