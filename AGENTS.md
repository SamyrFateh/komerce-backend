# AGENTS.md — Règles obligatoires Komerce

Ce fichier est l'instruction racine du dépôt pour tout agent IA ou développeur.

---

## 🚨 Point d'entrée obligatoire — lire AVANT toute modification

1. `docs/chantier/STATUS.md` — état du jour et prochain lot à exécuter
2. **Socle architectural** (les 4 documents de référence — voir §1 ci-dessous)
3. Si la modification touche la Boutique :
   - `docs/boutique/BOUTIQUE_CSS_PIPELINE.md` pour le pipeline CSS canonique ;
   - `docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md` pour l'ownership composants ;
   - `public/boutique/README.md` pour les commandes et garde-fous locaux.

> Note chemin : le frontend Boutique vit dans `public/boutique/**`. Les anciens chemins `boutique/**` ou `boutique/docs/**` ne doivent plus être utilisés comme chemins repo.

---

## 1. Socle architectural — 4 documents de référence

Komerce repose sur quatre documents qui font foi sur **l'état de l'art** du projet. Ils sont co-référence : aucun n'est secondaire, chacun couvre une dimension distincte.

| Document | Question à laquelle il répond | Statut |
|---|---|---|
| `docs/CARTOGRAPHY_360.md` | **Quoi existe** (domaines API, surfaces HTML, points de vérité, env vars) | Canonique |
| `docs/ZONE_IMPACT.md` | **Quoi protéger** (10 invariants, fichiers à haut risque, checklist) | Canonique |
| `docs/SCHEMA.md` | **Quoi est vrai en base** (tables, ENUMs, triggers, contraintes) | Canonique |
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
| Modification Boutique structurelle | `docs/boutique/*` pertinent + `public/boutique/README.md` si workflow/commande change |

**Une PR qui modifie un de ces points sans mettre à jour la doc correspondante doit être refusée ou commitée avec une dette explicite dans STATUS.md.**

---

## 4. Règle Boutique obligatoire

Si une modification touche :

- `public/boutique/**`
- `docs/boutique/**`
- un script racine qui affecte la Boutique (`scripts/*boutique*`, `package.json` build, etc.)

alors il faut lire et respecter les docs Boutique canoniques avant d'écrire du code.

### Source documentaire Boutique

| Besoin | Lire |
|---|---|
| Pipeline CSS source → dist → cache-buster | `docs/boutique/BOUTIQUE_CSS_PIPELINE.md` |
| Ownership JS / composants | `docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md` |
| Commandes locales, garde-fous, workflow | `public/boutique/README.md` |
| Docs historiques ou générées | `public/boutique/docs/**` — subordonnées, à synchroniser si elles contredisent `docs/boutique/**` |

Toute PR Boutique doit indiquer :

- les fichiers Boutique touchés ;
- le composant owner concerné ;
- pourquoi le fichier modifié est le bon propriétaire ;
- comment le mobile, le desktop, le panier et le checkout ont été préservés ;
- si du CSS source change : `cd public/boutique && npm run deploy:css` doit être exécuté et les bundles/caches modifiés committés.

### Interdictions Boutique

- Ne pas créer une deuxième source de vérité.
- Ne pas déplacer du CSS dans un fichier non propriétaire.
- Ne pas éditer `public/boutique/css/dist/*.css` directement.
- Ne pas réintroduire de CSS durable dans le JS : `createElement('style')`, `style.textContent`, `style.cssText`, `innerHTML style=`.
- Ne pas casser le moteur mobile hero fixed + `#k-page-scroll` + `b-pager.js`.
- Ne pas corriger le desktop avec un hack mobile.
- Ne pas ajouter de règle `.k-chip`, `.k-cats`, `.k-cats-shell` hors fichier propriétaire documenté.
- Ne pas dupliquer `.k-grid` ou `.k-card` hors owner documenté.

---

## 5. Règle de statut commande

Toute modification de statut commande doit respecter `docs/ZONE_IMPACT.md` (invariants I-01 à I-04) et passer par `services/order-status-machine.js`.

Toute mutation de paiement (Stripe, cash, wallet, panier partagé, panier collectif) doit passer par `services/order-payment-confirmation.js`. Cf. `CONTRACTS.md` §4.

---

## 6. Règle de fin de session

Avant tout commit ou PR, mettre à jour `docs/chantier/STATUS.md` ou documenter explicitement pourquoi le lot est uniquement documentaire / opportuniste et ne change pas le chantier courant.

À vérifier :

- lot terminé ou dette ajoutée ;
- date de mise à jour si le chantier courant change ;
- divergence doc ↔ code ↔ DB signalée dans "Pièges critiques" si détectée ;
- commandes de garde-fou exécutées ou raison de non-exécution.

---

## 7. Hiérarchie documentaire en cas de conflit

Pour mémoire, en cas de doute sur quelle doc fait foi :

```txt
1. SCHEMA.md                         ← état DB (généré depuis pg_dump live)
2. CONTRACTS.md                      ← signatures publiques services critiques
3. ZONE_IMPACT.md                    ← invariants à ne pas casser
4. CARTOGRAPHY_360.md                ← cartographie domaines et points de vérité
5. ADR-001 à ADR-012                 ← décisions historisées
6. docs/boutique/*                   ← gouvernance Boutique canonique actuelle
7. public/boutique/README.md         ← workflow local Boutique
8. public/boutique/docs/*            ← docs Boutique historiques/générées, subordonnées
9. autres docs spécialisées          ← DOCTRINE_*, SPEC_*, ROADMAP_*
10. docs/_archive/                   ← archive informationnelle uniquement
```

Une doc ancienne qui contredit le socle ou les docs Boutique canoniques est **toujours subordonnée**, même si elle est plus détaillée.
