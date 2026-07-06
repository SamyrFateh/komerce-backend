# NOTE OPS — Calibration densité de valeur (lot V-5)

> **Date** : 2026-07-02 · **Doctrine** : `DOCTRINE_DENSITE_VALEUR.md` §3 et §6
> **Quand** : après le **premier shipment maritime réel** dont la facture transitaire est saisie
> **Qui** : admin (pas d'agent hub, pas de code à déployer)
> **Durée** : ~15 minutes

---

## 1. Pourquoi

La clé `VALUE_DENSITY_TARGET_KMF_PER_DM3` a été posée à **500 en confiance basse**
(migration 095). Tant qu'elle n'est pas calibrée sur du réel, l'alerte
`review_volume` du moteur sourcing reste indicative et n'influence aucune
décision. Cette note décrit comment la caler sur la vérité terrain — même
principe que le recalibrage `transitaire_kmf` (047) : **le réel prime, jamais
l'intuition**.

## 2. Prérequis (sinon reporter la calibration)

- [ ] Le shipment est arrivé et sa facture transitaire est saisie :
      `customs_shipments.total_volume_m3` ET `freight_kmf` renseignés.
- [ ] La majorité des colis du shipment ont un volume snapshoté
      (`fill_rate_pct` non NULL dans la vue — sinon, saisir d'abord les
      volumes produits manquants via `POST /hub/volume`, ils remonteront
      par le proxy Σ produits).

## 3. Lire la vérité

```sql
SELECT reference, transport_mode, total_volume_m3, fill_rate_pct,
       margin_embarked_kmf, margin_kmf_per_m3, chargeable_wm, freight_kmf
FROM v_shipment_density
WHERE transport_mode = 'sea'
ORDER BY reference DESC
LIMIT 3;
```

Trois chiffres à noter :

| Lecture | Interprétation |
|---|---|
| `margin_kmf_per_m3` | La marge que le conteneur a **réellement** portée par m³. C'est la référence. |
| `fill_rate_pct` | < 85 % = du m³ payé pour de l'air → levier repack/densification avant d'ajuster la cible. |
| `freight_kmf / total_volume_m3` | Le coût réel du m³ — plancher absolu : un produit sous ce seuil en KMF/m³ de marge **détruit** de la valeur. |

## 4. Fixer la cible

Règle simple, à ajuster avec l'expérience :

```txt
cible KMF/dm³ = (margin_kmf_per_m3 du shipment ÷ 1000) × 0,8
```

Le facteur 0,8 laisse une tolérance : la cible sert à **signaler** les
produits qui diluent la marge du conteneur, pas à exiger que chaque produit
batte la moyenne (mathématiquement impossible). Ne jamais fixer la cible
sous le plancher `freight ÷ volume` du §3.

Mise à jour (l'historique part dans `business_rules_history`) :

```sql
UPDATE business_rules
SET value = jsonb_build_object('value', <CIBLE_CALCULEE>),
    updated_at = now()
WHERE key = 'VALUE_DENSITY_TARGET_KMF_PER_DM3';
```

## 5. Après calibration

- L'alerte `review_volume` du moteur sourcing devient significative : les
  produits sous la cible sont de vrais candidats à repack, re-négociation
  packaging fournisseur, hausse de prix ou sortie de catalogue.
- Elle reste **informative** (level `info`). La promotion en `warning` et/ou
  son entrée dans le score sourcing est une décision doctrinale séparée, à
  prendre après 2–3 shipments calibrés, pas avant.
- Recalibrer à chaque shipment les 3 premiers, puis trimestriellement —
  le mix produit fait bouger la moyenne.

## 6. Signaux d'alerte à surveiller dans la vue

- `margin_kmf_per_m3` qui **baisse** de shipment en shipment = le mix se
  dégrade (trop de volumineux à faible marge embarqués).
- `fill_rate_pct` durablement > 95 % = le conteneur sature : c'est le moment
  d'arbitrer par densité ce qui embarque (le coût d'opportunité devient réel).
- Beaucoup d'allocations `estimated_fallback` / confidence `low` en
  réconciliation = volumes non saisis en amont → prioriser les mesures hub.
