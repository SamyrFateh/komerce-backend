# Doctrine économique Komerce

> **Version** : pré-2026 — non datée. Revue de conformité requise (audit 2026-07-01).

> **Statut** : document fondamental  
> **Dernière consolidation** : 15 mai 2026  
> **Sources vérifiées** : `services/pricing-engine.js`, `routes/pricing.js`, `routes/pricing-strategy.js`, `routes/admin-pricing-components.js`, `routes/admin-cost-components.js`, `routes/admin-risk-provisions.js`, `routes/admin-finance-config.js`.

---

## 1. Phrase de vérité

Komerce ne cherche pas le prix parfait au lancement. Komerce cherche un **prix protégé** qui permet d'apprendre le marché sans vendre à perte, puis utilise les signaux réels pour décider quoi sourcer, renforcer, corriger ou arrêter.

Cette doctrine est volontairement pragmatique : aux Comores, le coût réel n'est jamais parfaitement connu à l'avance. La douane, le fret, le change, les délais, les ruptures et les coûts terrain doivent être intégrés comme des risques économiques, pas comme des détails comptables secondaires.

---

## 2. Les quatre unités économiques

| Unité | Rôle |
|---|---|
| **Produit** | Porte le coût d'achat, le prix affiché, la marge cible et la confiance marché. |
| **Commande** | Porte le paiement, le client, le relais, les remises, le wallet et la preuve commerciale. |
| **Colis** | Porte les coûts logistiques réels ou estimés : poids, volume, fret, douane, transit, distribution. |
| **Shipment** | Porte la vérité terrain agrégée : conteneur, transport, douane réelle, arrivage, ventilation. |

La rentabilité ne doit pas être lue uniquement au niveau produit. Dans Komerce, elle se lit au croisement produit × commande × colis × shipment.

---

## 3. Les quatre prix

Le moteur de pricing calcule quatre niveaux de prix. Ces niveaux ne sont pas décoratifs : ils servent à protéger l'entreprise pendant la phase d'apprentissage.

| Prix | Sens métier | Usage |
|---|---|---|
| **Survival price** | Couvre le minimum variable immédiat. | Déstockage, promo exceptionnelle, test très encadré. |
| **Minimum safe price** | Couvre variables + risques + part raisonnable de coûts fixes. | Seuil rouge : ne pas vendre durablement en dessous. |
| **Recommended price** | Prix conseillé pour atteindre la marge cible. | Prix de référence interne. |
| **Test market price** | Prix réellement testable sur le marché. | Peut être ajusté selon signal terrain, mais doit rester protégé. |

Le pricing ne doit pas être un simple `cost × coefficient`. Il doit intégrer les familles de coûts, la marge cible, le risque et la confiance marché.

---

## 4. Les trois niveaux de coûts

La doctrine actuelle suit une logique extensible en trois niveaux.

### Niveau 1 — coûts variables par commande

Exemples : sourcing, paiement, emballage, fret, douane estimée, relais, distribution locale.

Ces coûts sont modélisés via `cost_components` lorsqu'elle est disponible, avec fallback legacy vers `pricing_components`.

### Niveau 2 — charges fixes ventilées

Exemples : charges mensuelles, outils, salaires, frais récurrents, structure.

Le moteur calcule une part de charges fixes par commande :

```text
fixed_cost_allocation_kmf = monthly_fixed_costs / target_orders_per_month
```

Si l'objectif mensuel n'est pas renseigné dans `finance_config`, le moteur applique une valeur par défaut conservatrice.

### Niveau 3 — provisions risques

Exemples : douane imprévisible, casse, perte, retour impossible, litige paiement, écart de change, retard, surcoût insulaire.

Ces risques sont portés par `risk_provisions`. Ils doivent être visibles, discutables et modifiables, pas cachés dans un coefficient global opaque.

---

## 5. Statuts économiques

### `health_status`

| Statut | Sens |
|---|---|
| `loss` | Le prix vend à perte ou sous le seuil de survie. |
| `danger` | Marge trop faible ; ne pas scaler. |
| `fragile` | Viable mais sensible aux écarts terrain. |
| `healthy` | Marge correctement protégée. |
| `strong` | Très bonne marge ou protection élevée. |
| `unknown` | Données insuffisantes. |

Les seuils doctrinaux sont dans `services/pricing-engine.js` : danger sous 15 %, fragile sous 25 %, healthy jusqu'à 40 %, strong au-delà.

### `market_confidence`

| Statut | Sens |
|---|---|
| `unknown` | Pas assez de ventes ou signaux. |
| `testing` | Premières ventes observées. |
| `validated` | Demande confirmée. |
| `scaling` | Produit candidat au renforcement. |
| `rejected` | Produit actif sans vente pendant une période longue. |

Le code actuel utilise notamment : 1 vente pour `testing`, 6 pour `validated`, 20 pour `scaling`, et 60 jours sans vente pour `rejected`.

### `sourcing_decision`

| Décision | Action attendue |
|---|---|
| `PRIORITY` | Renforcer le sourcing, surveiller stock, négocier fournisseur. |
| `TEST` | Tester prudemment, petite quantité, mesure rapide. |
| `WATCH` | Surveiller sans pousser. |
| `AVOID` | Ne pas recommander à l'achat. |
| `LOSS` | Bloquer ou corriger : prix/coût dangereux. |

---

## 6. Doctrine Comores

Komerce opère dans un marché importateur, sensible au prix, où l'utilisateur final local et le payeur diaspora peuvent être deux personnes différentes.

Conséquences :

1. **Le prix doit être lisible pour la diaspora** : la personne qui paie veut comprendre ce qu'elle finance.
2. **Le prix doit rester acceptable localement** : trop cher, le produit devient symbolique mais non scalable.
3. **La douane n'est pas une constante** : elle doit être provisionnée puis réconciliée.
4. **Le retour produit n'est pas un acquis** : le risque SAV doit être intégré en amont.
5. **Le relais est une unité de confiance** : disponibilité, code retrait, preuve de collecte et cash doivent être tracés.
6. **Le colis est économique** : un produit rentable seul peut devenir mauvais si son colis est lourd, volumineux ou mal ventilé.

---

## 7. Règles à ne pas casser

- Ne jamais remplacer le moteur de pricing par un coefficient unique.
- Ne jamais masquer les risques dans une marge globale non documentée.
- Ne jamais confondre prix affiché, prix conseillé et seuil minimum sûr.
- Ne jamais scaler un produit `danger`, `loss` ou `unknown` sans justification terrain.
- Ne jamais considérer un audit ancien comme vérité si le code ou la DB l'a dépassé.
- Ne jamais faire porter toute la rentabilité au produit seul : commande, colis et shipment comptent.

---

## 8. Fichiers de référence

| Fichier | Rôle |
|---|---|
| `services/pricing-engine.js` | Calcul des prix, statuts économiques et décision sourcing. |
| `routes/pricing.js` | API principale de recommandation pricing. |
| `routes/pricing-strategy.js` | Stratégie pricing avancée. |
| `routes/admin-pricing-components.js` | Administration des composantes de prix. |
| `routes/admin-cost-components.js` | Administration des composantes de coûts. |
| `routes/admin-risk-provisions.js` | Administration des provisions de risque. |
| `routes/admin-finance-config.js` | Configuration financière globale. |
| `docs/ADR-009-source-verite-unifiee.md` | Décision source de vérité unifiée. |
| `docs/ADR-010-pricing-reads-db.md` | Décision pricing lu depuis la DB. |
| `docs/ADR-011-pricing-extensible-3-niveaux.md` | Décision pricing extensible en trois niveaux. |
