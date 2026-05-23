# AGENTS.md — Règles obligatoires Komerce

Ce fichier est l'instruction racine du dépôt pour tout agent IA ou développeur.

---

## 🚨 Point d'entrée obligatoire — lire AVANT toute modification

1. `docs/chantier/STATUS.md` — état du jour et prochain lot à exécuter
2. **Socle architectural** (les 4 documents de référence — voir §1 ci-dessous)
3. `boutique/docs/BOUTIQUE_ARCHITECTURE.md` si la modification touche la Boutique

---

## 1. Socle architectural — 4 documents de référence

Komerce repose sur quatre documents qui font foi sur **l'état de l'art** du projet. Ils sont co-référence : aucun n'est secondaire, chacun couvre une dimension distincte.

| Document | Question à laquelle il répond | Statut |
|---|---|---|
| `docs/CARTOGRAPHY_360.md` | **Quoi existe** (domaines API, surfaces HTML, points de vérité, env vars) | Canonique |
| `docs/ZONE_IMPACT.md` | **Quoi protéger** (10 invariants, fichiers à haut risque, checklist) | Canonique |
| `docs/SCHEMA.md` | **Quoi est vrai en base** (91 tables, 14 ENUMs, triggers, contraintes) | Canonique |
| `docs/CONTRACTS.md` | **Qui appelle quoi** (contrats publics des services critiques) | Canonique |

**Règle absolue** : si une information sur l'architecture, le schéma, les invariants ou les contrats est ailleurs et contredit ces quatre documents, **ces documents gagnent**. Toute autre documentation doit être alignée sur eux ou archivée dans `docs/_archive/`.

---

## 2. Règle de divergence

Une divergence peut apparaître entre les 4 documents socle, le code, et la DB. Le protocole est :

### 2.1 La DB live fait foi sur le schéma

`SCHEMA.md` doit refléter le `pg_dump` de production. En cas d'écart constaté :

1. ne pas modifier silencieusement le schéma pour "réparer" la doc ;
2. ne pas modifier la doc pour "réparer" un schéma jugé incorrect sans validation ;
3. **signaler dans `STATUS.md` section "Pièges critiques"** et demander arbitrage avant action.

### 2.2 Le code applicatif fait foi sur les contrats et le comportement

`CONTRACTS.md`, `ZONE_IMPACT.md` et `CARTOGRAPHY_360.md` doivent refléter le code en production. En cas d'écart :

1. **Si le code est juste et la doc obsolète** → mettre à jour la doc dans la même PR que la prochaine modification touchant la zone. Signaler dans STATUS.md.
2. **Si la doc est juste et le code dérive** → la dérive est un bug architectural à corriger. Ne pas re-aligner la doc sur un code qui contredit un invariant. Lot dédié.
3. **Si la doc et le code sont tous les deux flous** → c'est une zone à arbitrer. Stop, signaler dans STATUS.md, demander validation propriétaire avant toute action.

### 2.3 En cas de doute

**Toujours stopper et signaler dans STATUS.md** plutôt que de présumer. Le coût d'un arbitrage de 5 minutes est inférieur au coût d'une régression silencieuse.

---

## 3. Règle de mise à jour de la doc socle

Toute PR qui touche structurellement le projet doit mettre à jour les documents socle concernés **dans la même PR** :

| Type de modification | Documents à mettre à jour |
|---|---|
| Ajout/suppression d'une route ou d'un domaine API | `CARTOGRAPHY_360.md` §3 |
| Ajout d'un statut, d'une transition, d'une source de paiement | `CARTOGRAPHY_360.md` §6 + `ZONE_IMPACT.md` §4 + `CONTRACTS.md` §3 |
| Modification d'un fichier à haut risque | `ZONE_IMPACT.md` §3 |
| Migration SQL (table, ENUM, colonne, contrainte) | `SCHEMA.md` (régénérer depuis `pg_dump`) |
| Modification d'une signature publique de service critique | `CONTRACTS.md` § correspondant |
| Ajout d'un invariant ou modification d'un existant | `ZONE_IMPACT.md` §2 |

**Une PR qui modifie un de ces points sans mettre à jour la doc correspondante doit être refusée ou commitée avec une dette explicite dans STATUS.md.**

---

## 4. Règle Boutique obligatoire

Si une modification touche :

- `boutique/**`
- `public/Komerce_Boutique.html`
- `boutique/docs/*BOUTIQUE*`

alors il faut lire et respecter `boutique/docs/BOUTIQUE_ARCHITECTURE.md` avant d'écrire du code.

Toute PR Boutique doit indiquer :

- les fichiers Boutique touchés ;
- le composant owner concerné ;
- pourquoi le fichier modifié est le bon propriétaire ;
- comment le mobile pager et le desktop ont été préservés.

### Interdictions Boutique

- Ne pas créer une deuxième source de vérité.
- Ne pas déplacer du CSS dans un fichier non propriétaire.
- Ne pas casser le moteur mobile hero fixed + `#k-page-scroll` + `b-pager.js`.
- Ne pas corriger le desktop avec un hack mobile.
- Ne pas ajouter de règle `.k-chip`, `.k-cats`, `.k-cats-shell` hors fichier propriétaire.
- Ne pas dupliquer `.k-grid` ou `.k-card` hors `products.css`.

---

## 5. Règle de statut commande

Toute modification de statut commande doit respecter `docs/ZONE_IMPACT.md` (invariants I-01 à I-04) et passer par `services/order-status-machine.js`.

Toute mutation de paiement (Stripe, cash, wallet, panier partagé, panier collectif) doit passer par `services/order-payment-confirmation.js`. Cf. `CONTRACTS.md` §4.

---

## 6. Règle de fin de session

Avant tout commit ou PR, mettre à jour `docs/chantier/STATUS.md` :

- cocher le lot terminé (☐ → ✅)
- mettre à jour la section **PROCHAIN LOT À EXÉCUTER**
- mettre à jour la date en tête de fichier (`> Mis à jour : YYYY-MM-DD`)
- si une divergence doc ↔ code ↔ DB a été détectée : ajouter une ligne dans "Pièges critiques"

Sans cette mise à jour, le prochain agent repart sur le mauvais lot.

---

## 7. Hiérarchie documentaire en cas de conflit

Pour mémoire, en cas de doute sur quelle doc fait foi :

```
1. SCHEMA.md            ← état DB (généré depuis pg_dump live)
2. CONTRACTS.md         ← signatures publiques services critiques
3. ZONE_IMPACT.md       ← invariants à ne pas casser
4. CARTOGRAPHY_360.md   ← cartographie domaines et points de vérité
5. ADR-001 à ADR-011    ← décisions historisées (justifient le présent)
6. boutique/docs/BOUTIQUE_ARCHITECTURE.md + boutique/docs/
7. Autres docs spécialisées (DOCTRINE_*, SPEC_*, ROADMAP_*)
8. docs/_archive/       ← archive (informationnel uniquement)
```

Une doc ancienne qui contredit le socle (1-4) est **toujours subordonnée**, même si elle est plus détaillée.
