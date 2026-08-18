# ADR-007 — Hygiène Finance BO (Phase 2 audit)

**Date :** avril 2026
**Statut :** Implémenté
**Contexte :** Phase 2 du plan d'audit architectural. Suppression des doublons et de la confusion entre vues "Finance".

---

## Problème détecté pendant l'audit

La section **Finance BO** contenait 5 vues qui se chevauchaient :

| Vue | Source données | Sujet réel | Problème |
|---|---|---|---|
| 💰 **Finances** | `v2ParcelKpis()` + `v2Orders()` | KPI commandes + colis (CA, statut, panier) | Redondant avec Dashboard + Comptabilité + Sales |
| 🧾 **Factures** | `invoicesList()` | Liste factures émises | OK |
| ⚖️ **Réconciliation** | `v2ParcelReconciliation()` | **Colis bloqués / warning / OK** | **Nom trompeur** : c'est de l'opérationnel, pas du cash |
| 📊 **Comptabilité** | `/finance` + `/charges` + `/cash/reconciliation` + `/uncollected` | KPI compta + grand livre + **réconciliation cash** + non encaissées | OK (vraie compta, ADR-003) |
| 📦 **Historique Douane** | `/customs-shipments` | Envois & taux terrain | OK (ADR-001) |

### Confusion grave : "Réconciliation" portait deux sens

1. **Réconciliation cash relais** (Attendu vs Collecté vs Déposé) → désormais dans **Comptabilité**
2. **Réconciliation colis** (Bloqués / Warning / OK) → vue séparée `reconciliation` mais nommée pareil

Un opérateur cliquait sur "Réconciliation" en Finance BO en pensant trouver le suivi cash, et tombait sur du suivi de colis problématiques. **Ambiguïté inacceptable**.

### Doublon : "Finances"

La vue `Finances` affichait :
- CA total commandes — déjà dans **Dashboard** + **Comptabilité**
- Panier moyen — déjà dans **Sales v2** + **Comptabilité**
- Clients uniques — déjà dans **Clients** + **Sales v2**
- Statut colis — déjà dans **Dashboard** + **Pipeline**

Aucun contenu unique. Pure redondance.

## Décisions

### Décision 1 — Retirer `finances` du registry

**Action** : suppression de l'entrée `id: 'finances'` du registry `ct-platform.js`.

**Conservation** : le code de `CT.views.finances` reste dans `ct-views-v7.js` pour ne pas casser les routes legacy. Les anciens liens `#finances` continuent de fonctionner (alias dans `_resolveViewFn`). Mais la vue n'apparaît plus dans la sidebar.

**Pourquoi pas supprimer le code ?** Parce qu'il pourrait être bookmarké ou référencé par des liens externes. Suppression UI ≠ suppression code.

### Décision 2 — Renommer `reconciliation` → `parcel_reconciliation` + déplacer

**Avant** :
```
Finance BO
└── ⚖️ Réconciliation  ← ambigu
```

**Après** :
```
Opérations
└── ⚖️ Colis à réconcilier  ← clair, c'est de l'opérationnel
```

**Action concrète** :
- Nouveau `id: 'parcel_reconciliation'` dans la section **Opérations**
- Label clarifié : **"Colis à réconcilier"** (plus de risque de confusion avec cash)
- Code `CT.views.reconciliation` inchangé — un alias dans `_resolveViewFn` mappe `parcel_reconciliation → reconciliation`
- Ancienne URL `#reconciliation` continue de fonctionner

### Décision 3 — Garder `invoices` où elle est

**Action** : aucun changement. Les factures sont du domaine financier, leur place est légitime.

## Section Finance BO après nettoyage

```
Finance (BO)  ── 3 entrées (au lieu de 5)
├── 📊 Comptabilité          ← KPI + grand livre + réconciliation cash + uncollected
├── 🧾 Factures              ← gestion documents
└── 📦 Historique Douane     ← envois & taux terrain
```

```
Opérations (BO)  ── +1 entrée
├── 📋 Commandes & Colis
├── 💰 Paiements cash
├── 📦 Créer colis
├── 🏭 Hub Dubai
├── 📦 Relais
├── 🚢 Transitaire
├── 📋 Inventaire
└── ⚖️ Colis à réconcilier   ← NEW (déplacé depuis Finance BO + renommé)
```

## Compatibilité ascendante

Trois aliases sont posés dans `_resolveViewFn` (ct-app-v7.js) :

```js
var legacy = {
  'action-center': 'actionCenter',
  'parcels': 'orders',                       // existant
  'parcel_reconciliation': 'reconciliation', // ADR-007 nouveau
  'finances': 'finances'                     // ADR-007 nouveau (URL marche, juste pas dans sidebar)
};
```

Conséquence :
- `https://.../control-tower.html#finances` → fonctionne toujours (mais pas dans le menu)
- `https://.../control-tower.html#reconciliation` → fonctionne toujours
- `https://.../control-tower.html#parcel_reconciliation` → fonctionne (nouveau nom officiel)

## Fichiers touchés

- **Modifié** : `public/js/ct-platform.js` — registry nettoyé
- **Modifié** : `public/js/ct-app-v7.js` — aliases de compatibilité
- **Inchangé** : `public/js/ct-views-v7.js` — code des vues `finances` et `reconciliation` conservé

Aucun fichier supprimé. Aucune migration SQL nécessaire.

## Bénéfices mesurables

- **Section Finance BO épurée** : 5 → 3 vues (−40%)
- **Levée d'ambiguïté** : "réconciliation" ne désigne plus deux choses différentes
- **Cohérence sémantique** : Finance BO = vraie compta, Opérations = exploitation quotidienne
- **Aucune régression** : tous les liens existants continuent à fonctionner

## Prochaines étapes du plan d'audit

- **Phase 3** : Réorganisation `pilotage` mégavue (CT) + Vue Santé business agrégée
