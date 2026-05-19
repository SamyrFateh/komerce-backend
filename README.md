# 🛒 Komerce Backend

> E-commerce multi-vendeurs — Comores
> Node.js / Express / PostgreSQL (Railway)

---

## 🤖 PROTOCOLE AGENT — LECTURE OBLIGATOIRE AVANT TOUTE ACTION

**Tu débarques sur ce repo ? Lis ces 5 fichiers dans l'ordre. Pas de raccourci.**

| # | Fichier | Pourquoi |
|---|---|---|
| 1 | [`AGENTS.md`](./AGENTS.md) | Point d'entrée — règle de divergence + socle 4 docs + interdits |
| 2 | [`docs/chantier/STATUS.md`](./docs/chantier/STATUS.md) | État du jour + prochain lot à exécuter + pièges critiques |
| 3 | [`docs/CARTOGRAPHY_360.md`](./docs/CARTOGRAPHY_360.md) | Quoi existe : 80 routes, domaines API, surfaces HTML, points de vérité |
| 4 | [`docs/ZONE_IMPACT.md`](./docs/ZONE_IMPACT.md) | Quoi protéger : 10 invariants I-01 à I-10 + fichiers à haut risque |
| 5 | [`docs/SCHEMA.md`](./docs/SCHEMA.md) | Quoi est vrai en base : 91 tables, 14 ENUMs, 31 triggers, 147 FK |

**Et un 6ᵉ si tu touches aux services critiques** : [`docs/CONTRACTS.md`](./docs/CONTRACTS.md) — signatures publiques des 9 services critiques.

---

## 🚨 Règles non-négociables — les 10 invariants

Détail complet dans `docs/ZONE_IMPACT.md` §2.

| ID | Invariant |
|---|---|
| I-01 | Ne jamais modifier `orders.status` hors `services/order-status-machine.js` |
| I-02 | Paiements Stripe/cash/wallet/shared-cart/collectif → uniquement `pending → confirmed` |
| I-03 | Transitions scan/système : forward-only + idempotentes |
| I-04 | Toute transition effective → trace dans `order_status_history` |
| I-05 | Wallet : pas de suppression — créditer, débiter, contre-passer |
| I-06 | Annulation → restaurer stock ET wallet appliqué |
| I-07 | Webhooks Stripe : body brut avant `express.json` |
| I-08 | Pricing : lire les composantes DB, jamais de coefficient dur |
| I-09 | Colis = unité opérationnelle autonome |
| I-10 | Codes retrait et preuves de collecte = éléments de confiance |

> 🔴 **Violation I-01 ACTIVE** signalée dans STATUS.md § Pièges critiques — `routes/pickup-secret.js:286`. Correction différée en lot I-SWEEP (après fin chantier d'audits). **Ne pas toucher avant.**

---

## 📂 Documentation organisée par couches

### Socle architectural — 4 documents canoniques

| Doc | Rôle | Co-référence |
|---|---|---|
| [`docs/CARTOGRAPHY_360.md`](./docs/CARTOGRAPHY_360.md) | Quoi existe | domaines, surfaces, points de vérité |
| [`docs/ZONE_IMPACT.md`](./docs/ZONE_IMPACT.md) | Quoi protéger | 10 invariants + fichiers à haut risque |
| [`docs/SCHEMA.md`](./docs/SCHEMA.md) | Quoi est vrai en base | 91 tables, 14 ENUMs, 31 triggers |
| [`docs/CONTRACTS.md`](./docs/CONTRACTS.md) | Qui appelle quoi | 9 services critiques |

**Règle de divergence** : voir `AGENTS.md` §2. En résumé : DB live fait foi sur le schéma ; code fait foi sur les contrats et comportements ; en cas de doute, stop + signaler dans STATUS.md.

### Chantier en cours

| Doc | Rôle |
|---|---|
| [`docs/chantier/STATUS.md`](./docs/chantier/STATUS.md) | **Premier fichier à lire à chaque session** — lots cochés + prochain lot + pièges |
| [`docs/backend/BACKEND_GOLIVE_ROADMAP.md`](./docs/backend/BACKEND_GOLIVE_ROADMAP.md) | 51 lots détaillés (8 blocs A-H) |
| [`docs/backend/BACKEND_AUDIT_SESSIONS_PLAN.md`](./docs/backend/BACKEND_AUDIT_SESSIONS_PLAN.md) | Sessions d'audit approfondies |
| [`docs/backend/BACKEND_AUDIT_CORRECTIONS.md`](./docs/backend/BACKEND_AUDIT_CORRECTIONS.md) | Corrections post-lecture code, fait foi contre l'audit initial |
| `docs/chantier/*_AUDIT_*.md` | Livrables d'audit par lot (D1, D3, D4, D5, D6, D7) |

### Docs métier (référence stable)

| Doc | Rôle |
|---|---|
| [`docs/doctrine/DOCTRINE_ECONOMIQUE_KOMERCE.md`](./docs/doctrine/DOCTRINE_ECONOMIQUE_KOMERCE.md) | Pricing, marges, sourcing |
| [`docs/doctrine/DOCTRINE_LEVIERS_MARGE.md`](./docs/doctrine/DOCTRINE_LEVIERS_MARGE.md) | Leviers de marge |
| [`docs/doctrine/DOCTRINE_ALLOCATION_COUTS.md`](./docs/doctrine/DOCTRINE_ALLOCATION_COUTS.md) | Allocation des coûts |
| [`docs/doctrine/DOCTRINE_PANIER_COLLECTIF.md`](./docs/doctrine/DOCTRINE_PANIER_COLLECTIF.md) | Panier collectif |
| [`docs/backend/SECURITY-MODEL.md`](./docs/backend/SECURITY-MODEL.md) | Modèle de sécurité |
| [`docs/specs/SPEC-ORDER-PARCEL-LIFECYCLE.md`](./docs/specs/SPEC-ORDER-PARCEL-LIFECYCLE.md) | Cycle de vie commande/colis |

### Décisions historisées (ADR)

11 ADR dans `docs/ADR-*.md` — mémoire des décisions structurantes (ADR-001 à ADR-011).

### Notes de design (à exécuter plus tard)

| Doc | Rôle |
|---|---|
| [`docs/backend/ARCHI_DECOUPAGE_MODULAIRE.md`](./docs/backend/ARCHI_DECOUPAGE_MODULAIRE.md) | Plan de découpage des gros fichiers (REFAC-pricing, REFAC-dashboard) |
| [`docs/ops/PAYPAL_POSITIONNEMENT.md`](./docs/ops/PAYPAL_POSITIONNEMENT.md) | Intégration PayPal phase 1 (lot PAYPAL-1) |

### Frontend Boutique

Le frontend Boutique a sa propre gouvernance documentaire dans `public/boutique/docs/`. **Point d'entrée** : [`docs/boutique/BOUTIQUE_DOCS_INDEX.md`](./docs/boutique/BOUTIQUE_DOCS_INDEX.md).

3 scripts automatisent sa vérification :
- `npm run bundle:css` — bundling sources → dist
- `npm run boutique:arch` — photo de l'archi réelle
- `npm run boutique:audit` — garde-fou des invariants

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
npm start                          # démarrer le serveur (port 3001 par défaut)
npm test                           # tests Jest (5 fichiers actuellement — TEST-1 à venir)

# Frontend Boutique (depuis public/boutique/)
npm run bundle:css                 # rebundler les CSS sources → dist
npm run boutique:arch              # régénérer BOUTIQUE_ARCHITECTURE_LIVE.md
npm run boutique:audit             # valider les invariants Boutique
```

---

## 📊 État du chantier

Voir `docs/chantier/STATUS.md` pour le détail. Résumé au 17 mai 2026 :

- **10 / 51 lots du chantier** terminés (20 %)
- **Socle architectural à 4 docs** gravé (lots SOCLE-1, SOCLE-2, SOCLE-3, H-SYNC)
- **Bloc A Hygiène** : 71 % (5/7)
- **Bloc D Sécurité** : 62 % (5/8)
- **Blocs B, C, E, F, G** : à venir
- **Lot critique en attente** : I-SWEEP (correction groupée des violations d'invariants détectées par les audits)

---

## 📝 Process de PR

```bash
# 1. Lire AGENTS.md + STATUS.md + le socle 4 docs (CARTOGRAPHY/ZONE_IMPACT/SCHEMA/CONTRACTS)
# 2. Coder en respectant les 10 invariants
# 3. Mettre à jour les docs socle concernées DANS LA MÊME PR (cf. AGENTS.md §3)
# 4. Mettre à jour STATUS.md (cocher le lot, dater, indiquer le prochain)
# 5. Commit avec message conventional commits
git commit -m "feat(domaine): description claire"
git push origin main
```

> 🔴 **Une PR qui modifie le code sans mettre à jour le socle = à refuser** (ou dette explicite dans STATUS.md).

---

## 🆘 En cas de doute

- **Conflit doc ↔ code** : voir `AGENTS.md` §2 (règle de divergence)
- **Violation d'invariant détectée** : signaler dans STATUS.md § Pièges critiques, NE PAS corriger à la volée — sera traité en lot I-SWEEP groupé
- **Tu ne sais pas où ajouter ton code** : ouvre `CARTOGRAPHY_360.md` (§3 domaines API) puis `CONTRACTS.md` (services critiques)
- **Tu ne sais pas si une table existe** : ouvre `SCHEMA.md` (généré contre `pg_dump` live)

---

*Ce README est aligné sur l'état du repo au 17 mai 2026 (post-SOCLE-1/2/3 + H-SYNC). Si tu trouves une obsolescence, mets à jour dans la même PR que le changement qui rend l'info obsolète.*
