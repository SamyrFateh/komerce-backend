# Doctrine Densité de Valeur Komerce

> **Version** : 1.1 — 2026-07-02 (fusion branche « fret-maritime-volume-v2 »)
> **Statut** : document fondamental — complète DOCTRINE_ECONOMIQUE_KOMERCE.md §6.6 et DOCTRINE_ALLOCATION_COUTS.md
> **Migration socle** : `095_value_density_foundation.sql` v2 (liée au lot C5 : 087 + scheduled/089)
> **Code d'application** : `services/cost-allocation/allocate.js`, `services/customs-shipment-service.js` (+ tests `cost-allocation-allocate.test.js`) — issus de la branche fusionnée
> **Changelog v1.1** : arbitrage §4 — ventilation maritime automatique par `transport_mode`, fallback **égalitaire** (jamais le poids) ; lot V-3 livré.

---

## 1. Phrase de vérité

> **La ressource rare de Komerce n'est pas le kilo, c'est le mètre cube embarqué.**

Le fret maritime Dubai→Moroni se facture au volume (règle W/M : le max entre la
tonne et le m³ — sur des biens de consommation, le volume sature presque
toujours en premier). Un conteneur LCL de ~10 m³ porte une marge potentielle
fixe : chaque cm³ occupé par un produit en évince un autre. La rentabilité d'un
produit ne se lit donc pas seulement en marge %, mais en **KMF de marge par dm³
embarqué**.

Cette doctrine est **bi-métrique, pas volumétrique** : la contrainte dominante
change par segment.

| Segment | Contrainte dominante | Règle |
|---|---|---|
| Maritime Dubai→Moroni | **Volume** (W/M) | `SEA_WM_KG_PER_M3` |
| Aérien | Poids volumétrique | `AIR_VOLUMETRIC_DIVISOR` |
| Hub→relais (local) | **Poids** (colis 25–30 kg) | `MAX_PARCEL_WEIGHT_KG` |

---

## 2. Principe d'application : SANS CONTRAINTE

La densité de valeur **informe, elle ne bloque jamais**. Trois traductions
techniques, alignées sur la philosophie du moteur sourcing (« pas de magie,
données partielles acceptées ») :

1. **Aucune colonne volume n'est obligatoire.** Un produit sans `volume_cm3`
   reçoit une alerte `review_volume` (comme `review_cost`), jamais un blocage
   d'activation, de commande ou de scan.
2. **La ventilation volumétrique est automatique, pas administrée.**
   Déclenchée par `transport_mode = 'sea'`, sans toggle par shipment. Données
   absentes → dégradation honnête (voir §4), **jamais un run qui casse**.
   `allocation_method = 'manual'` explicite reste un override admin respecté.
3. **Tous les seuils sont en `business_rules`** (invariant I-08), modifiables
   sans redéploiement, désactivables via `is_active`.

---

## 3. La métrique pivot : `margin_kmf_per_dm3`

```text
margin_kmf_per_dm3 = (price_kmf − cost_kmf) / (volume_cm3 / 1000)
```

- Calculée dans `analyzeProduct` (champ `computed`), NULL si volume absent.
- Comparée à `VALUE_DENSITY_TARGET_KMF_PER_DM3` → alerte informative sous la
  cible. La `sourcing_decision` reste inchangée tant que la cible n'est pas
  calibrée (confiance basse assumée).
- **Calibration** : après le premier shipment réel, `v_shipment_density`
  donne la marge/m³ effectivement embarquée — c'est elle qui fixe la cible,
  pas une intuition.

Les rails gardent leurs bornes poids (contrainte du segment local) mais le
**classement intra-rail** passe à la densité de valeur. Le rail D (dense,
petit, marge forte) devient enfin cohérent avec sa définition.

## 4. Ventilation W/M du fret réel — ARBITRÉ (v1.1)

Principe arbitré lors de la fusion : **le poids n'a aucun sens économique sur
du fret acheté au m³. Mieux vaut un signal neutre honnête qu'un signal faux.**

```text
transport_mode = 'sea' + volumes snapshotés
    → by_volume : clé = COALESCE(csp.parcel_volume_cm3, parcels.volume_cm3)
      confidence 'high'

transport_mode = 'sea' + volumes absents (legacy pré-095)
    → répartition ÉGALE entre colis (clé = 1), méthode 'estimated_fallback',
      confidence 'low' — JAMAIS le poids.
      Le signal 'low' est visible en réconciliation : il s'éteint de lui-même
      dès que les rattachements post-095 snapshotent le volume.

air / land / transport_mode non renseigné
    → by_weight (inchangé)

allocation_method = 'manual'
    → override admin, toujours respecté

'mixed' (W/M taxable = max(poids/SEA_WM_KG_PER_M3×1000, volume))
    → réservé au lot V-6, quand un shipment mixte lourd/volumineux
      le justifiera dans les données réelles
```

Le snapshot est posé au rattachement par `customs-shipment-service.js` :
`COALESCE(parcels.volume_cm3, Σ products.volume_cm3 × quantité)` — le volume
produit sert de proxy tant que le colis n'a pas été mesuré au hub.

## 5. Repack au hub — prescrit, jamais improvisé (R2)

Le système décide, l'opérateur exécute :

- `products.repack_volume_cm3` (volume constaté après repack, mesuré une fois),
  `products.repack_exempt` (fragile, boîte = valeur perçue, douane).
- Gain = `volume_cm3 − repack_volume_cm3`. Si gain ≥ `REPACK_MIN_GAIN_CM3` et
  non exempt → le scan hub retourne `next_action: 'repack'` avec consigne.
- L'interface hub reste à 3 actions ; le repack est une consigne dans le flux
  d'emballage, pas un 4ᵉ bouton.

## 6. KPI de pilotage : `v_shipment_density`

Vue lecture seule (pattern 094 : pas de job, pas de cron) : poids, volume,
tonnage taxable W/M, `fill_rate_pct`, et **`margin_kmf_per_m3`** — le chiffre
qui pilote quoi sourcer, renforcer ou arrêter. Sur ~10 m³, récupérer 1 m³ =
10 % de fret en moins ou 10 % de marchandise dense en plus.

---

## 7. Règles à ne pas casser

- Ne jamais rendre `volume_cm3` bloquant — alerte oui, refus non.
- Ne jamais ventiler le fret **maritime** au poids — volume si disponible,
  répartition égale confiance basse sinon (v1.1). Le poids reste la clé du
  non-maritime.
- Ne jamais masquer une dégradation : tout fallback s'écrit dans les lignes
  d'allocation (`allocation_method`, `confidence`) — la réconciliation doit
  voir ce qui est estimé.
- Ne jamais faire décider le repack par l'agent hub — flag système + exemptions admin (R2).
- Ne jamais classer sur la densité avec une cible non calibrée en confiance haute.
- Ne jamais oublier que le poids reste la contrainte du dernier segment et de l'aérien.
- Ne jamais négocier les grammes fournisseur quand ce sont les cm³ qui paient (packaging à plat, nesting, suppression boîtes cadeaux).

## 8. Séquencement (léger)

| Lot | Contenu | Statut |
|---|---|---|
| V-1 | Migration 095 v2 (socle données + rules + vue, absorbe la branche) | **prêt à commiter** |
| V-3 | `allocate.js` + `customs-shipment-service.js` + tests (ventilation volume) | **livré** (branche fusionnée) — commiter avec V-1 |
| V-2 | `analyzeProduct` : `margin_kmf_per_dm3` + alerte `review_volume` | à faire |
| V-4 | Hub : `next_action:'repack'` + saisie `repack_volume_cm3` à la 1ʳᵉ réception | à faire |
| V-5 | Calibration `VALUE_DENSITY_TARGET_KMF_PER_DM3` sur 1ᵉʳ shipment réel | après 1ᵉʳ départ |
| V-6 | Méthode `mixed` (W/M taxable) dans `allocate.js` | si les données le justifient |

**Checklist de commit de la fusion** : (1) ne PAS ajouter
`095_customs_shipment_parcel_volume.sql` — absorbée par la 095 v2 ;
(2) ajouter l'override `allocation_method='manual'` dans `allocate.js` si la
branche ne le porte pas encore ; (3) `npm test` (les 5 tests volume doivent
passer sur la 095 v2 — même colonne) ; (4) mettre à jour `SCHEMA.md` (gate
`arch:drift`).
