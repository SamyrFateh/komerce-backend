# ADR-013 — Fret : autorité `transport-rails`, règle poids/mesure (W/M), coût ≠ prix

**Date :** août 2026
**Statut :** Accepté (à implémenter en LOT 1B)
**Réf. :** doctrine `docs/doctrine/DOCTRINE_ADMIN_DASHBOARDS.md` §I-5 · lié à ADR-004 (cohérence douane), ADR-009 (source de vérité unifiée), ADR-011 (pricing 3 niveaux)

---

## Contexte

L'audit de la refonte Admin/Dashboards a mis en évidence que le fret est traité de façon **incohérente et dupliquée** dans le code :

1. **Coût dans le CDR** (`services/pricing-cdr.js`, l.196) : `volume_m3 × finance_config.fret_eur_per_m3 × fx` — bateau uniquement, volumétrique, taux global. Le CDR ignore totalement les rails de transport.
2. **Prix de transport commercial** (`services/transport-pricing.js` + `transport-rails.js`, migration 118) : moteur rail-aware (`SEA_STANDARD`, `AIR_EXPRESS`), au **poids taxable**, avec cycle `pricing_status`.

Trois conséquences fautives :
- **Double-comptage** : `pricing-cdr.js` cumule le fret `finance_config` (l.196) et tout composant `cost_components` de famille `freight` (l.261).
- **Bug de marge avion** : dès qu'`AIR_EXPRESS` passe `ACTIVE`, le CDR calcule un coût bateau/volume pour un colis facturé au poids → marge fausse.
- **Bug de recette bateau** : le commercial `SEA` facture le poids réel sans W/M → sous-facturation des colis denses.

## Décision

1. **Le fret est DEDICATED au moteur `transport-rails`.** `cost_components` ne valorise pas le fret ; une contrainte `CHECK` réserve les familles `customs`, `risk` et `freight`.
2. **Règle poids/mesure (W/M) unifiée** : quantité facturable = `max(mesure native, autre mesure ramenée)`, exprimée sur l'unité de référence du rail — **kg** pour l'air (`max(poids, volume/diviseur)`), **m³** pour le bateau (`max(volume, poids/densité)`). L'unité, le facteur de conversion et le seuil sont des **POLICY par rail** (`business_rules`).
3. **Coût ≠ prix (option b)** : `transport-rails` porte **deux taux distincts par rail** — un taux de **coût** et un taux de **prix commercial**. Le **CDR consomme uniquement le coût** (`quantité facturable × taux de coût`). Le prix commercial reste le devis client. On ne mélange jamais marge et coût de transport.
4. **Le CDR consomme, ne recalcule pas.** Le chemin `finance_config.fret_eur_per_m3` (l.196) devient un fallback à retirer une fois la consommation branchée.

## Conséquences

- Le double-comptage disparaît par construction (une seule autorité).
- Les bugs de marge avion et de recette bateau sont corrigés ensemble (une seule chirurgie, LOT 1B).
- La migration est une **correction de vérité** (doctrine I-7) : `BEFORE != AFTER`, chaque écart doit être expliqué contre le Golden CDR (`tools/golden-cdr/`).
- Coût quasi nul côté moteur : `transport-pricing` retourne déjà `taxable_weight_kg` séparément du taux ; ajouter le taux de coût suffit.

## Alternatives écartées

- **Fret OWNED (`cost_components`, composant global)** : rejeté — la règle `max(poids, volume)` est inexprimable par une unité `cost_components` unique (`kmf_per_kg` **ou** `kmf_per_m3`, pas le max des deux).
- **CDR consomme le prix commercial (option a)** : rejeté — mélange marge et coût, fausse la marge calculée (marge-sur-marge).
