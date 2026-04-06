# 🤝 Guide de Contribution — Komerce Backend

## 🔒 Règle d'Or : Le Coffre-Fort d'abord

> **Avant de toucher à une seule ligne de code, consultez la Cartographie 360°.**
>
> 📄 [`docs/CARTOGRAPHY_360.md`](docs/CARTOGRAPHY_360.md)

Ce document est la **source de vérité unique** du projet. Il contient :
- Tous les endpoints (méthode, chemin, auth, middleware, tables touchées)
- Le schéma DB complet (tables, colonnes, types, contraintes)
- Le pipeline de commandes (9 statuts + transitions)
- Les services externes (Stripe, SMS, Email, Supabase)
- La matrice middleware et rate limiters

---

## 📝 Workflow de contribution

### 1. Consulter la carto
```
Ouvrir docs/CARTOGRAPHY_360.md
→ Chercher la section liée à votre modification
→ Vérifier les endpoints, tables et middleware concernés
```

### 2. Coder les modifications
- Respecter les patterns existants (auth, validation, try/catch)
- Paramétrer toutes les requêtes SQL (jamais de concaténation)
- Ajouter authenticate + requireRole sur les routes sensibles

### 3. Mettre à jour la carto
Si votre PR modifie des endpoints, tables, middleware ou le pipeline :
```
Mettre à jour docs/CARTOGRAPHY_360.md dans la MÊME PR
```

### 4. Créer la PR
- Remplir **toute** la checklist du template PR
- Lister les fichiers modifiés et leur impact
- Indiquer les endpoints et tables impactés

### 5. Review
- Le reviewer vérifie la cohérence code ↔ carto
- Si la carto n'est pas à jour → PR bloquée

---

## 🚫 Ce qui bloque une PR

| Motif | Exemple |
|-------|---------|
| Carto non consultée | Checklist non cochée |
| Carto non mise à jour | Nouvel endpoint absent de la carto |
| SQL non paramétré | `WHERE id = ${id}` au lieu de `WHERE id = $1` |
| Route sans auth | Endpoint admin sans `requireRole(['admin'])` |
| Secret en dur | `JWT_SECRET = 'mysecret'` dans le code |
| Pas de try/catch | Route sans gestion d'erreur |

---

## 📂 Structure du projet

```
komerce-backend/
├── server.js                 # Point d'entrée Express v10.0
├── db.js                     # Pool PostgreSQL
├── routes/                   # 18 fichiers de routes
│   ├── dashboard.js          # ⭐ Dashboard unifié v11 (8 endpoints)
│   ├── orders.js             # Commandes (26 endpoints)
│   ├── admin.js              # Administration
│   └── ...
├── middleware/                # Auth, rate-limit, upload, validate
├── utils/                    # Email, SMS, pricing, rates, reference
├── validators/               # Schémas Joi
├── db/                       # Schema SQL + migrations
│   ├── schema.sql
│   ├── schema_extension.sql
│   ├── seed.sql
│   └── migrations/
└── docs/                     # 📚 Documentation
    ├── CARTOGRAPHY_360.md    # 🔒 COFFRE-FORT — Source de vérité
    ├── AUDIT_REPORT.md       # Rapport d'audit
    ├── DASHBOARD_REDESIGN.md # Architecture dashboard v11
    └── ROADMAP_KOMERCE.md    # Plan de travail
```

---

> 🔒 *Le coffre-fort protège le code. Le code protège le business.*
