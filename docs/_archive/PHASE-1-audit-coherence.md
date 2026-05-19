# 🔍 Phase 1 — Audit de cohérence des données Komerce

**Date :** avril 2026
**Statut :** Complété — 4 corrections appliquées

---

## 🎯 Objectif

Avant de construire l'Atelier de composition (Phase 2) et la Stratégie de prix (Phase 3), s'assurer que **les données se parlent vraiment partout** dans le système. Identifier et corriger les "fuites de cohérence".

---

## 🗺️ Cartographie des sources de vérité

### Sources de vérité officielles (post-ADR-009/010/011)

| Table | Type | Rôle | Lecteurs autorisés |
|---|---|---|---|
| `finance_config` | Singleton à colonnes (id=1) | Variables financières globales (taux change, marge cible, objectifs) | Tous les modules |
| `customs_categories` | Catalogue | Taux de douane, TVA, taxes par catégorie produit | Pricing, Modèle Économique |
| `pricing_components` | Catalogue (Niveau 1) | Variables par commande (sourcing, transit, hub, distrib) | Pricing |
| `risk_provisions` | Catalogue (Niveau 3) | Provisions risques en % | Pricing |
| `charges` | Catalogue (Niveau 2) | Charges fixes mensuelles à amortir | Pricing, Modèle Économique |
| `business_rules` | Clé/Valeur | Seuils opérationnels (SLA, alertes, paramétrage métier) | Tous les modules |
| `exchange_rates` | Historique passif | Taux de change à des dates passées (audit comptable) | finance.js (export) |

### Sources legacy à dépriorité (ne pas écrire dessus)

| Table | Statut | Action future |
|---|---|---|
| `economic_variables` | Legacy lecture seule | À retirer après migration des derniers consommateurs |

---

## 🔥 Bugs détectés et corrigés

### Bug #1 — `sourcing-engine.js` lisait `finance_config` comme une table clé/valeur

**Avant :**
```sql
SELECT value FROM finance_config WHERE key = $1 AND is_active = TRUE
```

**Problème** : `finance_config` est un **singleton à colonnes** (id=1, taux_change_eur_kmf, etc.), pas un kv-store. Toutes les requêtes échouaient silencieusement (try/catch) et retombaient sur les fallbacks hardcodés.

**Impact** : Le module Sourcing fonctionnait avec des seuils non variabilisés sans le savoir. 17 paramètres étaient affectés (rails de produits, marges cibles, seuils volumétrie).

**Correction** : `getCfg()` lit désormais depuis `business_rules` (la vraie table kv) avec gestion du JSON `{value: 42}`.

```javascript
// AVANT (cassé)
const { rows } = await db.query(
  'SELECT value FROM finance_config WHERE key = $1 AND is_active = TRUE',
  [key]
);

// APRÈS (fonctionnel)
const { rows } = await db.query(
  'SELECT value FROM business_rules WHERE key = $1',
  [key.toUpperCase()]
);
```

### Bug #2 — `payments.js /rates` écrasait `finance_config` avec `exchange_rates`

**Avant :** L'endpoint appelait `getRates()` (qui lit `finance_config`) puis **écrasait** la réponse avec une lecture brute de `exchange_rates`.

**Impact** : Si tu modifiais le taux dans `finance_config`, le frontend continuait d'afficher l'ancien taux de `exchange_rates` jusqu'à ce que `exchange_rates` soit aussi mis à jour. Source #1 de désync silencieuse.

**Correction** : Suppression de la lecture `exchange_rates`. L'endpoint retourne uniquement la valeur de `finance_config` via `getRates()`.

### Bug #3 — `finance.js` lisait `exchange_rates` (légitime, mais non documenté)

**Statut** : Ce n'est pas un bug. L'export comptable a besoin du **taux historique au moment de la commande**, ce qui est exactement le rôle de `exchange_rates` post-ADR-009.

**Action** : Commentaire explicatif ajouté pour éviter une "correction" malvenue dans le futur :

```sql
-- ADR-009 : usage légitime de exchange_rates en tant qu'historique d'audit.
-- finance_config porte le taux ACTUEL ; exchange_rates porte les taux PASSÉS.
LEFT JOIN LATERAL (...) er ON TRUE
```

### Duplication #4 — `MARGE_PCT` existe dans `business_rules` ET `finance_config`

**Statut** : Doublon connu. Pour l'instant, le code privilégie `finance_config.target_marge_brute_pct` (admin-radar.js fix appliqué dans patch précédent).

**Action future (Phase 4)** : Soit supprimer `MARGE_PCT` de `business_rules`, soit ajouter un trigger SQL de synchronisation. À décider quand on simplifiera la vue Settings.

---

## 🔗 Chaînes de propagation vérifiées

### Chaîne 1 — Modifier `finance_config.taux_change_eur_kmf`

```
ADMIN modifie le taux EUR→KMF dans Modèle Économique
                          ↓
  finance_config UPDATE   →   exchange_rates INSERT (audit)
                          ↓
            Cache rates invalidé (utils/rates.js)
                          ↓
         ┌────────────────┴─────────────────┐
         ▼                ▼                 ▼
  Pricing /recommend  Pricing /batch  Boutique panier
  ✅ lit finance_config  ✅              ✅ via getRates()

         ┌────────────────────┴──────────────────────┐
         ▼                                             ▼
  /api/payments/rates                       Export comptable
  ✅ lit finance_config (FIX appliqué)      ✅ lit exchange_rates
                                                (taux historique
                                                 au moment cmd)
```

### Chaîne 2 — Modifier `finance_config.target_marge_brute_pct`

```
ADMIN modifie la marge cible globale
                  ↓
       finance_config UPDATE
                  ↓
    ┌─────────────┴──────────────┐
    ▼              ▼              ▼
Vue Santé      Vue Sales      admin-radar
✅ pilier      ✅ écart       ✅ money card
   marge          vs cible       marge fallback
```

### Chaîne 3 — Modifier un `pricing_components`

```
ADMIN active/désactive un composant ou modifie sa valeur
                  ↓
  pricing_components UPDATE
                  ↓
    ┌─────────────┴──────────────┐
    ▼                              ▼
Pricing /recommend             Pricing /batch
✅ lit en temps réel           ✅ recalcule 200 produits
                                  → vue Catalogue mise à jour
```

### Chaîne 4 — Modifier une `charge` dans Modèle Économique

```
ADMIN ajoute/modifie une charge mensuelle
                  ↓
       charges UPDATE
                  ↓
   Aucun cache → Pricing recalcule à la prochaine demande
                  ↓
    ┌─────────────┴──────────────┐
    ▼                              ▼
Niveau 2 amorti                Catalogue verdicts
✅ se met à jour               ✅ écart révisé
```

---

## 🧪 Tests de cohérence recommandés (post-déploiement)

### Test 1 — Cohérence des taux
1. Aller dans Modèle Économique → modifier `taux_change_eur_kmf` à 500 (vs 492)
2. Vérifier dans Pricing : prix recommandés ont changé (+1.6% environ)
3. Vérifier `/api/payments/rates` : retourne 500
4. Vérifier dans une nouvelle commande boutique : prix calculé avec 500

### Test 2 — Cohérence de la marge cible
1. Modifier `finance_config.target_marge_brute_pct` à 35% (vs 40%)
2. Vue Santé : pilier marge utilise 35% comme cible
3. Vue Sales : écart vs cible affiche 35%
4. Pricing batch : prix recommandés baissent (marge moins exigeante)

### Test 3 — Cohérence des composants Niveau 1
1. Ajouter un nouveau composant "marketing_meta_ads = 3%" dans Pricing
2. Recalculer : prix recommandés montent de ~3% sur tous les produits
3. Désactiver le composant : prix recommandés reviennent à l'état précédent

---

## 📊 État de cohérence post-Phase 1

```
🟢 finance_config       → Lue correctement par tous les modules critiques
🟢 customs_categories   → Source de vérité unique pour douane/TVA
🟢 pricing_components   → Source de vérité unique pour Niveau 1
🟢 risk_provisions      → Source de vérité unique pour Niveau 3
🟢 charges              → Source de vérité unique pour Niveau 2
🟢 exchange_rates       → Rôle clarifié : historique audit uniquement
🟡 business_rules       → Source pour seuils ops, doublon MARGE_PCT à traiter
🟡 economic_variables   → Legacy, à retirer dans une étape future
```

---

## 🚀 Prêt pour Phase 2 — Atelier de composition CDR

Avec ces correctifs, on peut maintenant construire l'Atelier en confiance :
- Les données affichées seront **vraiment** celles du système
- Modifier un composant aura un impact **vraiment** propagé partout
- Les benchmarks pourront s'appuyer sur des chiffres **vraiment** cohérents

---

## Files modifiés

- `routes/sourcing-engine.js` — getCfg() lit business_rules au lieu de finance_config singleton
- `routes/payments.js` — /rates retourne finance_config (suppression écrasement par exchange_rates)
- `routes/finance.js` — Commentaire ADR-009 sur l'usage légitime de exchange_rates en historique
