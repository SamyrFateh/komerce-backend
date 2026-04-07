# 🔍 CHALLENGE — Synthèse Architecture Logistique vs Gouvernance Komerce

> **Date** : 7 avril 2026
> **Auteur** : Agent Tasklet
> **Base** : CARTOGRAPHY v15.14, ROADMAP v16.1, GOVERNANCE v2.2, code source actuel
> **Objectif** : Challenger chaque point de la synthèse, identifier les écarts avec l'existant, proposer un plan d'intégration conforme à la gouvernance.

---

## 📊 VERDICT GLOBAL

| Aspect | Score | Détail |
|--------|:-----:|--------|
| **Alignement avec l'existant** | 🟢 65% | La refonte parcel-centric (Phases 1-3) a déjà posé les fondations |
| **Nouveautés à intégrer** | 🟡 35% | Moteur d'optimisation, stratégie douanière, hub simplifié, multi-transporteurs |
| **Conflits avec la gouvernance** | 🔴 3 points | Détaillés ci-dessous |
| **Effort estimé** | ⚠️ ~8-12 phases | Ne peut PAS être fait en une seule itération |

---

## ✅ PARTIE 1 — CE QUI EST DÉJÀ FAIT (aligné avec la synthèse)

### 1.1 Modèle de données parcel-centric
**Synthèse §2** : `orders → parcels → parcel_items → shipments → scans`
**État actuel** : ✅ **FAIT** (Phases 1-3 terminées)

| Élément synthèse | Implémentation existante | Statut |
|-------------------|-------------------------|:------:|
| Table `parcels` | Migration 010 — UUID PK, `order_id`, `shipment_id`, `status`, timestamps | ✅ |
| Table `parcel_items` | Migration 010 — mapping `parcel_id → order_item_id → product_id` | ✅ |
| Enum `parcel_status` | `draft, preparation, shipped, in_transit, arrived, available, collected, cancelled` | ✅ |
| `scans.parcel_id` | Colonne ajoutée, liée par `parcelSync.js` | ✅ |
| `orders.computed_status` | Ajouté puis migré vers `orders.status` (Phase 3) | ✅ |

> **Verdict** : La fondation est solide. La synthèse valide nos choix architecturaux.

### 1.2 Règle métier de split (§3)
**Synthèse** : standard / partial / backorder / awaiting_stock
**État actuel** : ✅ **FAIT** dans `utils/parcels.js`

| Règle synthèse | Code existant |
|----------------|---------------|
| Tout dispo → 1 standard | `defaultStrategy()` → `PARCEL_TYPES.STANDARD` |
| Mix → partial + backorder | `defaultStrategy()` → split automatique |
| Rien dispo → awaiting_stock | `defaultStrategy()` → `PARCEL_TYPES.AWAITING_STOCK` |
| Stratégies extensibles | Registre `STRATEGIES{}` + `registerStrategy()` |
| Config via business_rules | `PARCEL_DEFAULT_SPLIT_STRATEGY`, `PARCEL_SPLIT_MIN_ITEMS_FOR_PARTIAL` |

> **Verdict** : 100% aligné. Le registre de stratégies permet d'ajouter les futures stratégies douanières sans migration.

### 1.3 Statut commande = agrégat des colis (§10-11)
**Synthèse** : `computeOrderStatus()`, jamais d'UPDATE direct
**État actuel** : ✅ **PARTIELLEMENT FAIT** — `parcelSync.js` est la source de vérité

| Principe synthèse | Implémentation | ⚠️ Écart |
|-------------------|----------------|----------|
| `computeOrderStatus(orderId)` | `computeOrderStatus(parcels)` dans `parcels.js` | ✅ Aligné |
| Interdiction `UPDATE orders.status` direct | `PATCH /orders/:id/status` **existe encore** dans `orders.js` | 🔴 **CONFLIT** |
| Recalcul via service central | `safeSyncScanToParcels()` dans `parcelSync.js` | ✅ Aligné |

> **⚠️ CONFLIT IDENTIFIÉ** : Le endpoint `PATCH /api/orders/:id/status` (ligne ~endpoint 8 dans orders.js) permet encore un UPDATE direct du statut. La synthèse l'interdit formellement. Ce endpoint doit être **déprécié** progressivement (garde-fou admin uniquement, avec log d'alerte).

### 1.4 Migration progressive (§12)
**Synthèse** : 5 étapes progressives
**État actuel** : 3/5 phases terminées

| Phase synthèse | Phase roadmap | Statut |
|----------------|---------------|:------:|
| 1. Introduire parcels/parcel_items | Phase 1 — Migration 010 | ✅ |
| 2. Ajouter parcel_id aux scans | Phase 2 — Migration 011, double écriture | ✅ |
| 3. Double logique temporaire → basculer | Phase 3 — Migration 012, trigger désactivé | ✅ |
| 4. Basculer shipments vers parcels | Phase 4 — 🟡 EN COURS (nettoyage colonnes legacy) | 🟡 |
| 5. Supprimer dépendance orders.status | Phase 5 — ⬜ API CRUD parcels | ⬜ |

> **Verdict** : Parfaitement aligné. La synthèse confirme notre trajectoire.

---

## 🆕 PARTIE 2 — CE QUI MANQUE (à intégrer)

### 2.1 🔴 Hub = Logique terrain simplifiée (§4)
**Synthèse** : L'opérateur scanne un article → le met dans un carton → scanne le carton → avance
**État actuel** : ❌ **PAS IMPLÉMENTÉ** — le hub actuel est encore orienté commande

| Workflow synthèse | Endpoint actuel | Écart |
|-------------------|----------------|-------|
| Scanner un article | `POST /api/scans` (scan générique par step) | ⚠️ Le scan est par commande, pas par article/carton |
| Mettre dans un carton | ❌ Pas de concept de "carton en cours" | 🔴 **MANQUANT** |
| Scanner le carton | ❌ Pas d'endpoint "sceller un colis" | 🔴 **MANQUANT** |
| Faire avancer le carton | `POST /api/scans` + `parcelSync` | 🟡 Partiellement via parcelSync |

**Impact** : Nécessite de nouveaux endpoints dans `routes/scans.js` ou un nouveau fichier `routes/hub.js` :
- `POST /api/hub/scan-item` — scanner un article et l'affecter à un colis ouvert
- `POST /api/hub/seal-parcel` — sceller un colis (passer de draft → preparation)
- `GET /api/hub/open-parcels` — lister les colis ouverts au hub

**Tables impactées** : parcels, parcel_items, scans
**Risque** : 🟠 Moyen — nouveau flux mais s'appuie sur les tables existantes

### 2.2 🔴 Module d'optimisation des colis (§8)
**Synthèse** : `optimizeParcelComposition(availableItems)` basé sur valeur/poids/volume
**État actuel** : ❌ **PAS IMPLÉMENTÉ** — aucun moteur d'optimisation

| Fonction demandée | Existant | À créer |
|-------------------|----------|---------|
| Optimiser le remplissage | ❌ | `utils/parcelOptimizer.js` |
| Équilibrer les colis | ❌ | Algorithme bin-packing |
| Réduire risque douanier | ❌ | Contraintes de valeur max/colis |
| Optimiser coût transport | ❌ | Contraintes poids/volume |

**Pré-requis** :
- Colonne `weight_kg` sur `parcels` ✅ (existe déjà)
- Colonnes `weight_g`, `volume_cm3` sur `products` ❌ (à ajouter)
- Nouvelles business_rules pour seuils (valeur max, poids max, etc.)

**Impact** : 🔴 Élevé — nouveau module, nouvelles colonnes produits, nouvelles business_rules
**Dépendance** : S'intègre comme nouvelle STRATÉGIE dans le registre `STRATEGIES{}` de `parcels.js`

### 2.3 🟠 Stratégie douanière (§7)
**Synthèse** : Colis homogènes, équilibrés, non ciblables
**État actuel** : ❌ **PAS IMPLÉMENTÉ** — la douane est un simple `customs_delta_pct` dans la vue

| Règle douanière | Existant | À créer |
|-----------------|----------|---------|
| Pas de colis mono-produit haute valeur | ❌ | Contrainte dans `optimizeParcelComposition` |
| Équilibrage valeur entre colis | ❌ | Algorithme de distribution |
| Homogénéité des colis | ❌ | Heuristique dans le moteur d'optimisation |

**Impact** : S'intègre dans le module §2.2 comme contraintes. Pas de changement DB supplémentaire.

### 2.4 🟠 Multi-transporteurs (§5)
**Synthèse** : Chaque colis → transporteur différent, moment différent
**État actuel** : 🟡 **PARTIELLEMENT FAIT**

| Élément | Existant | Écart |
|---------|----------|-------|
| `parcels.shipment_id` → `shipments` | ✅ FK existe | — |
| `shipments` table avec `carrier` | ✅ Existe | — |
| Assignation colis → expédition | ✅ `POST /api/logistics/parcels` | — |
| Multi-transporteurs par commande | ⚠️ La logique existe en DB mais pas exposée | 🟡 Endpoints à enrichir |
| ETA par colis (pas par commande) | ❌ Pas de `parcels.eta` | 🟡 Colonne à ajouter |

**Impact** : 🟡 Moyen — surtout du travail API + frontend, la DB est prête.

### 2.5 🟡 Incertitude terrain (§6)
**Synthèse** : Résilience aux délais bateaux, douane imprévisible, taxation variable
**État actuel** : 🟡 **PARTIELLEMENT COUVERT**

| Aspect | Existant | Manque |
|--------|----------|-------|
| Statut `arrived` (douane) | ✅ Enum `parcel_status` | — |
| `arrived_at` timestamp | ✅ Sur `parcels` ET `shipments` | — |
| `customs_cleared_at` | ✅ Sur `shipments` | ❌ Pas sur `parcels` individuels |
| Taxation variable | `customs_delta_pct` dans vue | ❌ Pas par colis |
| SLA adaptés | SLA Warning/Late/Blocked dans dashboard | 🟡 À adapter par colis |

**Impact** : 🟡 Moyen — principalement des ajouts de colonnes et ajustement des SLA.

---

## 🔴 PARTIE 3 — CONFLITS AVEC LA GOUVERNANCE

### Conflit 1 : UPDATE direct de `orders.status`
- **Synthèse §11** : "INTERDICTION : UPDATE orders.status direct"
- **Code actuel** : `PATCH /api/orders/:id/status` dans `orders.js` permet un changement direct
- **Gouvernance** : L'endpoint est utilisé par l'admin et les agents relais
- **Résolution** : Déprécier progressivement → remplacer par des actions sur les parcels qui déclenchent `computeOrderStatus()`. Garder un fallback admin-only avec log d'alerte pendant la transition.

### Conflit 2 : Complexité vs Roadmap
- **Synthèse** : Demande 6+ nouveaux modules/concepts (optimiseur, hub simplifié, douane, etc.)
- **Gouvernance Règle #4** : "Roadmap = source de vérité unique"
- **Roadmap actuelle** : Parcel-Centric est Phase 3-5, puis Sécurité, puis Catalogue Pièces
- **Résolution** : Intégrer la synthèse **à l'intérieur** des phases existantes + créer une nouvelle section "Architecture Logistique Avancée" dans la ROADMAP, positionnée **APRÈS** les fix sécurité critiques.

### Conflit 3 : Sécurité vs Nouvelles features
- **Synthèse** : 14 points d'architecture à implémenter
- **Gouvernance / Audit** : 6 vulnérabilités CRITIQUES + 8 MAJEURES ouvertes (#71-#84)
- **Résolution** : **La sécurité passe AVANT l'architecture avancée.** La synthèse est intégrée mais séquencée après les fix critiques. Exception : les Phases 4-5 parcel-centric déjà planifiées continuent.

---

## 📋 PARTIE 4 — PLAN D'INTÉGRATION

### Principe : Intégration en 3 vagues

```
VAGUE 1 — TERMINER L'EXISTANT (court terme, 1-2 semaines)
  └→ Phases 4-5 Parcel-Centric + Fix sécurité critiques

VAGUE 2 — FONDATIONS AVANCÉES (moyen terme, 2-4 semaines)
  └→ Hub simplifié + Multi-transporteurs + Dépréciation UPDATE direct

VAGUE 3 — INTELLIGENCE LOGISTIQUE (long terme, 4-8 semaines)
  └→ Moteur d'optimisation + Stratégie douanière + Résilience terrain
```

### Vague 1 — Terminer l'existant (aligner avec roadmap actuelle)

| # | Tâche | Source | Effort | Priorité |
|---|-------|--------|:------:|:--------:|
| 1.1 | Phase 4 — Nettoyage colonnes legacy (sub_orders) | Roadmap existante | 4h | 🔴 P1 |
| 1.2 | Phase 5 — API CRUD parcels | Roadmap existante | 8h | 🔴 P1 |
| 1.3 | Ajouter guard sur `PATCH /orders/:id/status` | Conflit 1 | 2h | 🔴 P1 |
| 1.4 | Fix 6 CRITIQUES sécurité #71→#76 | Roadmap existante | 12h | 🔴 P1 |
| 1.5 | Fix 8 MAJEURES #77→#84 | Roadmap existante | 16h | 🟠 P2 |

### Vague 2 — Fondations avancées (nouveaux concepts de la synthèse)

| # | Tâche | Synthèse § | Effort | Priorité |
|---|-------|:----------:|:------:|:--------:|
| 2.1 | Créer `routes/hub.js` — workflow terrain simplifié | §4 | 12h | 🟠 P2 |
| 2.2 | Endpoints : `scan-item`, `seal-parcel`, `open-parcels` | §4 | 8h | 🟠 P2 |
| 2.3 | Enrichir multi-transporteurs (ETA par colis, assignment) | §5 | 6h | 🟠 P2 |
| 2.4 | Ajouter `customs_cleared_at` sur parcels | §6 | 2h | 🟡 P3 |
| 2.5 | Déprécier `PATCH /orders/:id/status` → actions parcel-only | §11 | 6h | 🟡 P3 |
| 2.6 | Adapter SLA au niveau colis (pas commande) | §6 | 4h | 🟡 P3 |
| 2.7 | Migration données shipments → liaison parcels complète | §5 | 4h | 🟡 P3 |

### Vague 3 — Intelligence logistique (modules avancés)

| # | Tâche | Synthèse § | Effort | Priorité |
|---|-------|:----------:|:------:|:--------:|
| 3.1 | Ajouter `weight_g`, `volume_cm3` aux produits | §8 pré-requis | 3h | 🟡 P3 |
| 3.2 | Créer `utils/parcelOptimizer.js` — moteur d'agencement | §8 | 16h | 🟡 P3 |
| 3.3 | Stratégie `optimize_customs` dans registre STRATEGIES | §7 | 8h | 🟡 P3 |
| 3.4 | Business rules : `PARCEL_MAX_VALUE_KMF`, `PARCEL_MAX_WEIGHT_KG` | §7-8 | 2h | 🟡 P3 |
| 3.5 | `optimizeParcelComposition(availableItems)` — API endpoint | §8 | 6h | 🟡 P3 |
| 3.6 | Dashboard : vue colis en temps réel (hub) | §4 | 8h | ⬜ P4 |
| 3.7 | Frontend hub mobile : interface carton simplifié | §4 | 12h | ⬜ P4 |
| 3.8 | Tests E2E multi-colis + douane + multi-transporteurs | §12 | 8h | ⬜ P4 |

---

## 🏗️ MODIFICATIONS ROADMAP PROPOSÉES

### Section à ajouter après "Refonte Parcel-Centric"

```markdown
## 🧠 Architecture Logistique Avancée — 0/X phases

> Intégration de la vision logistique terrain : hub simplifié, multi-transporteurs,
> optimisation douanière, résilience à l'incertitude.
> Pré-requis : Phases 4-5 Parcel-Centric terminées.

| Phase | Contenu | Statut |
|:-----:|---------|:------:|
| A | Hub terrain — scan article/carton, endpoints hub.js | ⬜ |
| B | Multi-transporteurs — ETA colis, assignment, dashboard | ⬜ |
| C | Moteur d'optimisation — valeur/poids/volume, bin-packing | ⬜ |
| D | Stratégie douanière — contraintes customs dans STRATEGIES | ⬜ |
| E | Résilience terrain — SLA colis, customs par colis, alertes | ⬜ |
| F | Frontend hub mobile — interface opérateur simplifiée | ⬜ |
```

### Modifications CARTOGRAPHY à prévoir

| Modification | Section impactée |
|-------------|-----------------|
| Nouveau fichier `routes/hub.js` | §4 Carte des routes |
| Nouveau fichier `utils/parcelOptimizer.js` | §10 Utilitaires |
| Nouvelles colonnes `products` (weight_g, volume_cm3) | §5 Schéma BDD |
| Nouvelle colonne `parcels.customs_cleared_at` | §5 Schéma BDD |
| Nouvelles business_rules (PARCEL_MAX_*) | §5 Schéma BDD |
| Nouveau diagramme flux hub | §8 Chaîne traitement |

---

## ⚡ RECOMMANDATIONS

### 1. NE PAS tout faire d'un coup
La synthèse est une **vision cible**, pas un sprint unique. Notre gouvernance exige des commits toutes les 10 min et des deltas progressifs. Chaque vague doit être autonome et déployable.

### 2. Prioriser la sécurité
Les 6 CRITIQUES (#71-#76) sont un risque immédiat. L'architecture avancée est un gain futur. **Pas de Vague 2 avant que les CRITIQUES soient fix.**

### 3. Exploiter l'extensibilité existante
Le registre `STRATEGIES{}` dans `parcels.js` est exactement le point d'ancrage pour le moteur d'optimisation et la stratégie douanière. Pas besoin de refondre — il suffit d'ajouter.

### 4. Le hub simplifié est le quick win le plus impactant
3 nouveaux endpoints + une interface mobile = transformation terrain immédiate. À faire dès que les Phases 4-5 sont terminées.

### 5. Valider chaque vague avec le terrain
Avant de coder la stratégie douanière (Vague 3), valider les hypothèses avec les opérateurs terrain aux Comores. La théorie de l'optimisation douanière doit être confrontée à la réalité.

---

## 📝 PROCHAINE ACTION

Conformément à la gouvernance :
1. **Commit immédiat** de cette analyse dans `docs/_work/`
2. **Demander validation** du plan au propriétaire
3. Si validé → créer un **delta** pour mettre à jour la ROADMAP
4. Enchaîner sur la Vague 1 (Phases 4-5 + sécurité)

---

*Analyse produite par l'agent Tasklet — 7 avril 2026*
*Basée sur : CARTOGRAPHY v15.14 · ROADMAP v16.1 · GOVERNANCE v2.2 · Code source complet*
