# 🤝 Guide de Contribution — Komerce Backend

## 🚨 Protocole obligatoire avant toute modification

**Lire ces fichiers dans l'ordre. Pas de raccourci.**

| # | Fichier | Pourquoi |
|---|---|---|
| 1 | [`AGENTS.md`](./AGENTS.md) | Point d'entrée — règle de divergence, socle 4 docs, interdits |
| 2 | [`docs/chantier/STATUS.md`](./docs/chantier/STATUS.md) | État du jour + prochain lot + pièges critiques |
| 3 | [`docs/CARTOGRAPHY_360.md`](./docs/CARTOGRAPHY_360.md) | Quoi existe : 80 routes, domaines API, env vars |
| 4 | [`docs/ZONE_IMPACT.md`](./docs/ZONE_IMPACT.md) | Quoi protéger : 10 invariants I-01 à I-10 |
| 5 | [`docs/SCHEMA.md`](./docs/SCHEMA.md) | Quoi est vrai en base : 91 tables, 14 ENUMs, 31 triggers |
| 6 | [`docs/CONTRACTS.md`](./docs/CONTRACTS.md) | Qui appelle quoi : signatures des 9 services critiques |

**Si la PR touche `boutique/**`** : lire aussi [`boutique/docs/BOUTIQUE_ARCHITECTURE.md`](./boutique/docs/BOUTIQUE_ARCHITECTURE.md) — cf. `AGENTS.md` §4.

---

## 📝 Workflow

### 1. Lire le socle

```
AGENTS.md → STATUS.md → CARTOGRAPHY_360 / ZONE_IMPACT / SCHEMA / CONTRACTS
```

### 2. Coder

- Respecter les 10 invariants (`ZONE_IMPACT.md` §2)
- Toute transition de statut commande → passer par `services/order-status-machine.js` (I-01)
- Toute mutation de paiement → passer par `services/order-payment-confirmation.js` (I-02)
- SQL paramétré — jamais de concaténation (`WHERE id = $1`, pas `WHERE id = ${id}`)
- `authenticate` + `requireRole` sur toutes les routes sensibles
- Pas de secret en dur — tout en variables d'environnement
- try/catch sur toutes les routes

### 3. Mettre à jour le socle dans la même PR

| Type de modification | Documents à mettre à jour |
|---|---|
| Ajout/suppression d'une route | `CARTOGRAPHY_360.md` §3 |
| Nouveau statut, transition, source de paiement | `CARTOGRAPHY_360.md` §6 + `ZONE_IMPACT.md` §4 + `CONTRACTS.md` §3 |
| Fichier à haut risque modifié | `ZONE_IMPACT.md` §3 |
| Migration SQL | `SCHEMA.md` (régénérer depuis `pg_dump`) |
| Signature de service critique modifiée | `CONTRACTS.md` § correspondant |
| Nouvel invariant | `ZONE_IMPACT.md` §2 |

### 4. Mettre à jour STATUS.md

Avant tout commit :
- Cocher le lot terminé (☐ → ✅)
- Mettre à jour **PROCHAIN LOT À EXÉCUTER**
- Mettre à jour la date en tête de fichier
- Toute divergence doc ↔ code ↔ DB → ajouter dans "Pièges critiques"

### 5. Créer la PR

- Lister les fichiers modifiés et leur impact
- Indiquer les invariants concernés
- Indiquer les docs socle mises à jour

---

## 🚫 Ce qui bloque une PR

| Motif | Exemple |
|---|---|
| Socle non consulté | STATUS.md ou AGENTS.md non lus |
| Socle non mis à jour | Nouvelle route absente de CARTOGRAPHY_360.md |
| STATUS.md non mis à jour | Lot terminé non coché, prochain lot non renseigné |
| SQL non paramétré | `WHERE id = ${id}` au lieu de `WHERE id = $1` |
| Transition de statut hors machine | `orders.status` modifié hors `order-status-machine.js` |
| Route sans auth | Endpoint admin sans `requireRole(['admin'])` |
| Secret en dur | `JWT_SECRET = 'mysecret'` dans le code |
| Pas de try/catch | Route sans gestion d'erreur |
| PR Boutique sans lire BOUTIQUE_ARCHITECTURE.md | cf. `AGENTS.md` §4 |

---

## 📂 Structure du projet

```
komerce-backend/
├── AGENTS.md                 # 🚨 Point d'entrée obligatoire
├── server.js                 # Point d'entrée Express
├── db.js                     # Pool PostgreSQL
├── routes/                   # Fichiers de routes
├── services/                 # Services critiques (order-status-machine, etc.)
├── middleware/                # Auth, rate-limit, upload, validate
├── utils/                    # Email, SMS, pricing, rates, reference
├── validators/               # Schémas Joi
├── db/                       # Schema SQL + migrations
│   ├── schema.sql
│   ├── schema_extension.sql
│   ├── seed.sql
│   └── migrations/
├── boutique/                 # Frontend Boutique
│   └── docs/                 # Gouvernance Boutique (point d'entrée : BOUTIQUE_DOCS_INDEX.md)
└── docs/                     # 📚 Documentation
    ├── CARTOGRAPHY_360.md    # 🔒 Quoi existe
    ├── ZONE_IMPACT.md        # 🔒 Quoi protéger
    ├── SCHEMA.md             # 🔒 Quoi est vrai en base
    ├── CONTRACTS.md          # 🔒 Qui appelle quoi
    ├── chantier/STATUS.md    # ⚡ État du jour
    ├── adr/                  # Décisions historisées (ADR-001 à ADR-012)
    ├── doctrine/             # Docs métier (pricing, marges, panier collectif)
    ├── specs/                # Specs cycle de vie
    └── _archive/             # Archives (informationnel uniquement)
```

---

## 🆘 En cas de doute

- **Conflit doc ↔ code** → `AGENTS.md` §2 (règle de divergence)
- **Violation d'invariant détectée** → signaler dans `STATUS.md` §Pièges critiques, ne pas corriger à la volée
- **Tu ne sais pas où ajouter ton code** → `CARTOGRAPHY_360.md` §3 puis `CONTRACTS.md`
- **Tu ne sais pas si une table existe** → `SCHEMA.md`

> 🔴 *Une PR qui modifie le code sans mettre à jour le socle = à refuser (ou dette explicite dans STATUS.md).*
