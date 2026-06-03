# 🛒 Komerce Backend

> E-commerce multi-vendeurs — Comores  
> Node.js / Express / PostgreSQL (Railway)

---

## 🤖 PROTOCOLE AGENT — LECTURE OBLIGATOIRE AVANT TOUTE ACTION

**Tu débarques sur ce repo ? Lis ces fichiers dans l'ordre. Pas de raccourci.**

| # | Fichier | Pourquoi |
|---|---|---|
| 1 | [`AGENTS.md`](./AGENTS.md) | Point d'entrée — règle de divergence + socle + interdits |
| 2 | [`docs/chantier/STATUS.md`](./docs/chantier/STATUS.md) | État du jour + prochain lot à exécuter + pièges critiques |
| 3 | [`docs/CARTOGRAPHY_360.md`](./docs/CARTOGRAPHY_360.md) | Quoi existe : domaines API, surfaces HTML, points de vérité |
| 4 | [`docs/ZONE_IMPACT.md`](./docs/ZONE_IMPACT.md) | Quoi protéger : invariants + fichiers à haut risque |
| 5 | [`docs/SCHEMA.md`](./docs/SCHEMA.md) | Quoi est vrai en base : tables, ENUMs, triggers, FK |

**Et un 6ᵉ si tu touches aux services critiques** : [`docs/CONTRACTS.md`](./docs/CONTRACTS.md) — signatures publiques des services critiques.

---

## 🚨 Règles non-négociables — les invariants métier

Détail complet dans `docs/ZONE_IMPACT.md`.

| ID | Invariant |
|---|---|
| I-01 | Ne jamais modifier `orders.status` hors `services/order-status-machine.js` |
| I-02 | Paiements Stripe/cash/wallet/shared-cart/collectif → uniquement via les services propriétaires |
| I-03 | Transitions scan/système : forward-only + idempotentes |
| I-04 | Toute transition effective → trace dans `order_status_history` |
| I-05 | Wallet : pas de suppression — créditer, débiter, contre-passer |
| I-06 | Annulation → restaurer stock ET wallet appliqué |
| I-07 | Webhooks Stripe : body brut avant `express.json` |
| I-08 | Pricing : lire les composantes DB, jamais de coefficient dur |
| I-09 | Colis = unité opérationnelle autonome |
| I-10 | Codes retrait et preuves de collecte = éléments de confiance |

---

## 📂 Documentation organisée par couches

### Socle architectural — documents canoniques

| Doc | Rôle |
|---|---|
| [`docs/CARTOGRAPHY_360.md`](./docs/CARTOGRAPHY_360.md) | Quoi existe : domaines, surfaces, points de vérité |
| [`docs/ZONE_IMPACT.md`](./docs/ZONE_IMPACT.md) | Quoi protéger : invariants + fichiers à haut risque |
| [`docs/SCHEMA.md`](./docs/SCHEMA.md) | Quoi est vrai en base |
| [`docs/CONTRACTS.md`](./docs/CONTRACTS.md) | Qui appelle quoi : services critiques |

**Règle de divergence** : voir `AGENTS.md` §2. En résumé : DB live fait foi sur le schéma ; code fait foi sur les contrats et comportements ; en cas de doute, stop + signaler dans `STATUS.md`.

### Chantier en cours

| Doc | Rôle |
|---|---|
| [`docs/chantier/STATUS.md`](./docs/chantier/STATUS.md) | **Premier fichier à lire à chaque session** |
| [`docs/backend/BACKEND_GOLIVE_ROADMAP.md`](./docs/backend/BACKEND_GOLIVE_ROADMAP.md) | Roadmap lots backend |
| [`docs/backend/BACKEND_AUDIT_SESSIONS_PLAN.md`](./docs/backend/BACKEND_AUDIT_SESSIONS_PLAN.md) | Sessions d'audit approfondies |
| [`docs/backend/BACKEND_AUDIT_CORRECTIONS.md`](./docs/backend/BACKEND_AUDIT_CORRECTIONS.md) | Corrections post-lecture code, fait foi contre l'audit initial |
| `docs/chantier/*_AUDIT_*.md` | Livrables d'audit par lot |

### Docs métier

| Doc | Rôle |
|---|---|
| [`docs/doctrine/DOCTRINE_ECONOMIQUE_KOMERCE.md`](./docs/doctrine/DOCTRINE_ECONOMIQUE_KOMERCE.md) | Pricing, marges, sourcing |
| [`docs/doctrine/DOCTRINE_LEVIERS_MARGE.md`](./docs/doctrine/DOCTRINE_LEVIERS_MARGE.md) | Leviers de marge |
| [`docs/doctrine/DOCTRINE_ALLOCATION_COUTS.md`](./docs/doctrine/DOCTRINE_ALLOCATION_COUTS.md) | Allocation des coûts |
| [`docs/doctrine/DOCTRINE_PANIER_COLLECTIF.md`](./docs/doctrine/DOCTRINE_PANIER_COLLECTIF.md) | Panier collectif / partagé |
| [`docs/backend/SECURITY-MODEL.md`](./docs/backend/SECURITY-MODEL.md) | Modèle de sécurité |
| [`docs/specs/SPEC-ORDER-PARCEL-LIFECYCLE.md`](./docs/specs/SPEC-ORDER-PARCEL-LIFECYCLE.md) | Cycle de vie commande/colis |

### Frontend Boutique

Le frontend Boutique vit dans :

```txt
public/boutique/
```

Point d'entrée local : [`public/boutique/README.md`](./public/boutique/README.md).

Docs canoniques Boutique actuelles :

| Doc | Rôle |
|---|---|
| [`docs/boutique/BOUTIQUE_CSS_PIPELINE.md`](./docs/boutique/BOUTIQUE_CSS_PIPELINE.md) | Pipeline CSS canonique : sources → dist → cache-buster |
| [`docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md`](./docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md) | Ownership composants JS/CSS |
| [`docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`](./docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md) | Architecture modal |

Les docs sous `public/boutique/docs/` sont utiles pour le contexte local, l'historique ou les snapshots générés, mais elles sont **subordonnées** à `docs/boutique/*` si elles contredisent l'état actuel du code.

Commandes Boutique principales, depuis `public/boutique` :

```bash
npm run deploy:css      # source CSS → dist + cache-buster
npm run bundle:css      # alias compatibilité vers deploy-css.js
npm run check:all       # garde-fous complets Boutique
```

---

## ⚙️ Quick Start (dev)

```bash
npm install
cp .env.example .env
# Renseigner DATABASE_URL, JWT_SECRET, STRIPE_*, QR_SECRET, etc.
npm start
```

**Variables d'env requises** : voir `docs/CARTOGRAPHY_360.md` §5 + `docs/chantier/ENV_AUDIT_D5.md`.

---

## 🛠️ Commandes utiles

```bash
# Backend
npm start
npm test

# Frontend Boutique
cd public/boutique
npm run deploy:css
npm run check:all
```

---

## 📝 Process de PR

```bash
# 1. Lire AGENTS.md + STATUS.md + le socle docs pertinent
# 2. Coder en respectant les invariants
# 3. Mettre à jour les docs concernées dans la même PR
# 4. Pour Boutique : lancer les garde-fous depuis public/boutique
# 5. Commit avec message conventional commits
git commit -m "feat(domaine): description claire"
```

> 🔴 **Une PR qui modifie le code sans mettre à jour la doc pertinente = à refuser** ou dette explicite dans `STATUS.md`.

---

## 🆘 En cas de doute

- **Conflit doc ↔ code** : voir `AGENTS.md` §2.
- **Violation d'invariant détectée** : signaler dans `STATUS.md`, ne pas corriger à la volée sans cadrage.
- **Tu ne sais pas où ajouter ton code** : ouvre `CARTOGRAPHY_360.md` puis `CONTRACTS.md`.
- **Tu touches la Boutique** : commence par `public/boutique/README.md` puis `docs/boutique/BOUTIQUE_CSS_PIPELINE.md` si CSS.

---

*Ce README est aligné sur l'état du repo au 3 juin 2026 après synchronisation des garde-fous Boutique. Si tu trouves une obsolescence, mets à jour dans la même PR que le changement qui rend l'info obsolète.*
