# SPEC BACKEND — Page « Sur-mesure & Modules »

> **Version** : 1.0 — 8 mai 2026
> **Auteur** : audit Komerce backend
> **Statut** : prête à coder
> **Effort estimé** : ~4h backend (1 dev junior+, 1 dev sénior pour review)
> **Conformité ZONE_IMPACT** : invariants R1-R7 non touchés, blast radius 🟢 faible

---

## 1. Objectif

Livrer le backend d'une nouvelle page boutique `/sur-mesure-et-modules` qui :

1. Présente les 4 modules spécialisés (couture, lunettes, construction, cosmétiques) + la catégorie « Sur-mesure léger » du catalogue
2. Affiche le **statut visible** de chaque module (disponible / bientôt / sur devis)
3. Permet de s'inscrire en **liste d'attente** pour les modules à venir (signal commercial vers fournisseurs)
4. Affiche des **suggestions cross-catalogue** par module (ponts vers Mode, Beauté, etc.)

**Hors périmètre** :
- L'UI / le frontend (chantier séparé)
- Les vraies suggestions contextuelles « cette robe sur mesure → ces chaussures » (étape 2, plus tard)
- Les phases 2 et 3 des modules eux-mêmes (lunettes, construction, cosmétiques) — la page sera prête à les afficher dès qu'ils basculent à `disponible: true`

---

## 2. Checklist ZONE_IMPACT (obligatoire avant de coder)

| # | Question | Réponse |
|---|---|---|
| 1 | Quelles zones je touche ? | Nouvelle route `routes/sur-mesure.js` (création), nouvelle table `module_waitlist`, lecture `products` + `MODULES_REGISTRY` |
| 2 | Quelles tables j'écris ? | `module_waitlist` (INSERT seul) |
| 3 | Quel invariant pourrait casser ? | **Aucun** — pas de touche à `orders`, `parcels`, `stock`, `users` |
| 4 | Quel est le blast radius ? | 🟢 Faible — endpoint en lecture + une nouvelle table indépendante |
| 5 | Touche un fichier sanctuarisé ? | Non |
| 6 | Mon analyse est dans `_work/` ? | Ce fichier (`docs/_pending/SPEC_SUR_MESURE_PAGE.md`) |
| 7 | Le propriétaire a validé ? | **À cocher avant exécution** |
| 8 | Tests à écrire | Voir §9 |

---

## 3. Architecture proposée

```
routes/
  sur-mesure.js                  ← nouvelle route (GET overview + POST waitlist)

migrations/
  066_module_waitlist.sql        ← nouvelle table waitlist

validators/index.js               ← +schéma `surMesure.subscribeWaitlist`

server.js                         ← 1 ligne d'ajout : app.use('/api/sur-mesure', ...)
```

**Pas de nouveau service** : la logique tient dans la route (≤200 lignes), pas la peine de scinder. Si la page grossit (analytics, recommandations contextuelles), on extraira un `services/sur-mesure-engine.js`.

**Réutilisation maximale** :
- `MODULES_REGISTRY` reste dans `routes/modules.js` — on l'importe (ou on l'extrait dans `services/modules-registry.js` si c'est plus propre)
- Catégorie « Sur-mesure » du catalogue : déjà 12+ produits avec `category='Sur-mesure'`, lus via `products`
- Suggestions par module : config statique (mapping `module → catégories cibles`), lecture standard `products`

---

## 4. Migration DB

### `migrations/066_module_waitlist.sql`

```sql
-- ============================================================================
-- Migration 066 — Liste d'attente pour les modules à venir
-- ============================================================================
-- Permet aux clients de s'inscrire pour être prévenus quand un module passe
-- en `disponible: true` (lunettes, cosmétiques, construction).
--
-- Signal commercial : aide à démarcher fournisseurs avec des chiffres concrets.
-- ============================================================================

CREATE TABLE IF NOT EXISTS module_waitlist (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  module_type   VARCHAR(50)  NOT NULL,
  user_id       UUID         REFERENCES users(id) ON DELETE SET NULL,
  email         VARCHAR(255),
  phone         VARCHAR(20),
  note          TEXT,                                  -- préférences libres ("ordonnance prête", "marque X souhaitée"…)
  source        VARCHAR(50)  DEFAULT 'sur-mesure-page', -- traçage origine inscription
  notified_at   TIMESTAMPTZ,                           -- NULL tant que pas notifié du go-live
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Au moins email OU phone OU user_id pour qu'on puisse re-contacter
  CONSTRAINT module_waitlist_contact_check CHECK (
    user_id IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL
  )
);

-- Lookup rapide par module pour l'affichage des compteurs publics
CREATE INDEX IF NOT EXISTS idx_module_waitlist_module_type
  ON module_waitlist(module_type);

-- Lookup pour la déduplication par email/phone
CREATE INDEX IF NOT EXISTS idx_module_waitlist_email
  ON module_waitlist(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_module_waitlist_phone
  ON module_waitlist(phone) WHERE phone IS NOT NULL;

-- Empêche un même couple (module, contact) de s'inscrire 2 fois
-- (PostgreSQL : index unique partiel par contact actif)
CREATE UNIQUE INDEX IF NOT EXISTS uq_module_waitlist_module_email
  ON module_waitlist(module_type, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_module_waitlist_module_phone
  ON module_waitlist(module_type, phone) WHERE phone IS NOT NULL;
```

**Notes** :
- `gen_random_uuid()` (pas `uuid_generate_v4()`) — convention des migrations récentes (cf. AUDIT_BACKEND_FINDINGS §1)
- `IF NOT EXISTS` partout — idempotente
- Contraintes uniques **partielles** (`WHERE email IS NOT NULL`) car PostgreSQL accepte plusieurs lignes avec NULL sans violer un UNIQUE classique
- `module_type` est un VARCHAR libre (pas un ENUM) pour rester aligné avec la philosophie modules.js : « ajouter un module = pas de migration destructive »

---

## 5. Validator

Ajout dans `validators/index.js` :

```javascript
// ── Schémas : sur-mesure.js ──────────────────────────────────────────────────

const surMesure = {
  subscribeWaitlist: {
    body: Joi.object({
      module_type: Joi.string()
        .valid('couture', 'lunettes', 'construction', 'cosmetiques')
        .required(),
      email: Joi.string().email().max(255),
      phone: Joi.string().pattern(/^\+?[\d\s\-]{6,20}$/),
      note:  safeStr(500),
    })
    // Au moins un canal de contact requis (le user_id vient du middleware si auth)
    .or('email', 'phone'),
  },
};

module.exports = {
  // … (reste inchangé)
  surMesure,
};
```

---

## 6. Route — `routes/sur-mesure.js`

```javascript
'use strict';

/**
 * KOMERCE — Page « Sur-mesure & Modules » (vue d'ensemble + waitlist)
 *
 * Endpoints :
 *   GET  /api/sur-mesure/overview        → agrégation modules + suggestions + sur-mesure léger
 *   POST /api/sur-mesure/waitlist        → s'inscrire pour être prévenu d'un module à venir
 *   GET  /api/sur-mesure/waitlist/stats  → (admin) compteurs par module
 *
 * Conforme ZONE_IMPACT : aucun invariant touché, lecture seule sauf INSERT waitlist.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole, attachUserIfPresent } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { surMesure } = require('../validators');

// ─── MODULES_REGISTRY — repris de routes/modules.js ───────────────────────────
// (Dans une v2, extraire dans services/modules-registry.js et importer des deux côtés)
const MODULES_REGISTRY = require('./modules-registry'); // ← option propre (cf. §7 Refacto)

// ─── Mapping suggestions cross-catalogue ──────────────────────────────────────
//
// Pour chaque module, quelles catégories du catalogue suggérer en complément.
// Modifiable sans migration. À enrichir au fil du temps.
//
const MODULE_SUGGESTIONS = {
  couture: {
    // Robe sur mesure → chaussures, sacs, bijoux, parfums
    categories:    ['Mode'],
    subcategories: ['Chaussures', 'Sacs', 'Bijoux'],
    extra_categories: ['Beauté'],
    extra_subcategories: ['Parfums'],
    label_humain: 'Complétez votre tenue',
  },
  lunettes: {
    // Lunettes → étuis, accessoires
    categories:    ['Mode'],
    subcategories: ['Accessoires'],
    label_humain: 'À porter avec vos lunettes',
  },
  construction: {
    // Construction → décoration, mobilier
    categories:    ['Maison'],
    subcategories: ['Décoration', 'Mobilier'],
    label_humain: 'Pour finir votre intérieur',
  },
  cosmetiques: {
    // Cosmétiques Dubai → soins, parfums
    categories:    ['Beauté'],
    subcategories: ['Soin', 'Parfums', 'Maquillage'],
    label_humain: 'Notre sélection beauté Dubai',
  },
};

const SUGGESTIONS_PER_MODULE = 4;
const SUR_MESURE_LEGER_LIMIT = 8;
const INSPIRATIONS_LIMIT     = 12;

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers internes
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calcule le statut affichable d'un module à partir du registre.
 *   disponible:true                 → 'available'
 *   disponible:false + delai_sup:0  → 'coming_soon'
 *   delai_sup_jours >= 14           → 'on_quote'
 *   sinon                           → 'coming_soon'
 */
function deriveModuleStatus(moduleDef) {
  if (moduleDef.disponible) return 'available';
  if (moduleDef.delai_sup_jours >= 14) return 'on_quote';
  return 'coming_soon';
}

/**
 * Construit le CTA selon le statut.
 */
function buildModuleCta(status) {
  switch (status) {
    case 'available':
      return { label: 'Démarrer',          action: 'open_form' };
    case 'on_quote':
      return { label: 'Demander un devis', action: 'open_quote_form' };
    case 'coming_soon':
    default:
      return { label: 'Me prévenir',       action: 'subscribe_waitlist' };
  }
}

/**
 * Charge en une seule requête les suggestions pour TOUS les modules
 * (évite N requêtes — pattern aligné sur baskets.js).
 */
async function loadAllSuggestions() {
  const allCategories = new Set();
  const allSubcategories = new Set();

  for (const m of Object.values(MODULE_SUGGESTIONS)) {
    (m.categories || []).forEach(c => allCategories.add(c));
    (m.subcategories || []).forEach(s => allSubcategories.add(s));
    (m.extra_categories || []).forEach(c => allCategories.add(c));
    (m.extra_subcategories || []).forEach(s => allSubcategories.add(s));
  }

  // Une seule requête sur products
  const { rows } = await db.query(
    `SELECT id, sku, name, category, subcategory, price_kmf, price_eur,
            image_url, images, promo_pct, has_variants
       FROM products
      WHERE is_active = TRUE
        AND (category = ANY($1) OR subcategory = ANY($2))
      ORDER BY sort_order ASC, created_at DESC
      LIMIT 200`,
    [Array.from(allCategories), Array.from(allSubcategories)]
  );

  // Indexation côté JS — bien moins coûteux que 4 requêtes
  const byCat = {};
  const bySub = {};
  for (const p of rows) {
    if (p.category)    (byCat[p.category]    ||= []).push(p);
    if (p.subcategory) (bySub[p.subcategory] ||= []).push(p);
  }

  return { byCat, bySub };
}

/**
 * Pour un module donné, retourne N suggestions selon son mapping.
 */
function pickSuggestionsFor(moduleType, { byCat, bySub }) {
  const map = MODULE_SUGGESTIONS[moduleType];
  if (!map) return [];

  const seen = new Set();
  const result = [];

  // Priorité aux subcategories (plus précis), puis categories
  const sources = [
    ...(map.subcategories || []).map(s => bySub[s] || []),
    ...(map.extra_subcategories || []).map(s => bySub[s] || []),
    ...(map.categories || []).map(c => byCat[c] || []),
    ...(map.extra_categories || []).map(c => byCat[c] || []),
  ];

  for (const list of sources) {
    for (const p of list) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      result.push(p);
      if (result.length >= SUGGESTIONS_PER_MODULE) return result;
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/sur-mesure/overview
// ═══════════════════════════════════════════════════════════════════════════════
//
// Endpoint principal de la page : agrège tout en une seule réponse.
// Public (pas d'auth requise). attachUserIfPresent permet de personnaliser
// plus tard (ex : "vous êtes déjà inscrit en waitlist couture").
//
router.get('/overview', attachUserIfPresent, async (req, res, next) => {
  try {
    // 1) Charger toutes les suggestions en une requête
    const suggestionsIndex = await loadAllSuggestions();

    // 2) Construire la liste des modules avec statut + CTA + suggestions
    const modules = Object.entries(MODULES_REGISTRY).map(([type, def]) => {
      const status = deriveModuleStatus(def);
      return {
        type,
        label:           def.label,
        emoji:           def.emoji,
        phase:           def.phase,
        status,                                  // available | coming_soon | on_quote
        description:     def.description,
        besoin_couvert:  def.besoin_couvert,
        delai_jours:     def.delai_sup_jours,
        cta:             buildModuleCta(status),
        suggestions:     pickSuggestionsFor(type, suggestionsIndex),
        suggestions_label: MODULE_SUGGESTIONS[type]?.label_humain || 'À découvrir',
      };
    });

    // 3) Sur-mesure léger : produits du catalogue avec category='Sur-mesure'
    const { rows: surMesureLeger } = await db.query(
      `SELECT id, sku, name, description, category, subcategory,
              price_kmf, price_eur, image_url, images, promo_pct,
              stock, has_variants, badge, emoji
         FROM products
        WHERE is_active = TRUE AND category = 'Sur-mesure'
        ORDER BY sort_order ASC, created_at DESC
        LIMIT $1`,
      [SUR_MESURE_LEGER_LIMIT]
    );

    // 4) Inspirations : un mix qui donne envie de découvrir le catalogue
    //    Mode (robes/tenues), Beauté (parfums Dubai), Sur-mesure
    const { rows: inspirations } = await db.query(
      `SELECT id, sku, name, category, subcategory,
              price_kmf, price_eur, image_url, images, promo_pct
         FROM products
        WHERE is_active = TRUE
          AND (
            (category = 'Mode' AND subcategory IN ('Robes', 'Femme', 'Homme'))
            OR (category = 'Beauté' AND subcategory = 'Parfums')
            OR category = 'Sur-mesure'
          )
        ORDER BY sort_order ASC, created_at DESC
        LIMIT $1`,
      [INSPIRATIONS_LIMIT]
    );

    res.json({
      modules,
      sur_mesure_leger: {
        label: 'Sur-mesure léger — gravure, prénoms, finitions',
        description: 'Personnalisation simple appliquée à un produit du catalogue.',
        products: surMesureLeger,
      },
      inspirations: {
        label: 'Inspirations du catalogue',
        products: inspirations,
      },
      // Petit signal de mise à jour pour le frontend (cache CDN futur)
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/sur-mesure/waitlist
// ═══════════════════════════════════════════════════════════════════════════════
//
// Inscription en liste d'attente d'un module non encore disponible.
// Pas d'auth requise (visiteur peut s'inscrire avec email seul).
// Si l'utilisateur est connecté (attachUserIfPresent), on lie au user_id.
//
router.post(
  '/waitlist',
  attachUserIfPresent,
  validate(surMesure.subscribeWaitlist),
  async (req, res, next) => {
    try {
      const { module_type, email, phone, note } = req.body;

      // Vérifier que le module existe ET qu'il n'est pas déjà disponible
      // (pas la peine de s'inscrire pour un module qu'on peut commander)
      const moduleDef = MODULES_REGISTRY[module_type];
      if (!moduleDef) {
        return res.status(400).json({
          error: `module_type inconnu : ${module_type}`,
          valeurs_acceptees: Object.keys(MODULES_REGISTRY),
        });
      }
      if (moduleDef.disponible) {
        return res.status(400).json({
          error: `Le module ${module_type} est déjà disponible — inutile de s'inscrire.`,
          cta: { label: 'Démarrer', action: 'open_form' },
        });
      }

      const userId = req.user?.id || null;

      // Insertion idempotente : si déjà inscrit (contrainte unique partielle),
      // on retourne 200 sans erreur — UX plus douce qu'un 409.
      try {
        const { rows: [row] } = await db.query(
          `INSERT INTO module_waitlist
              (module_type, user_id, email, phone, note, source)
           VALUES ($1, $2, $3, $4, $5, 'sur-mesure-page')
           RETURNING id, created_at`,
          [
            module_type,
            userId,
            email || null,
            phone || null,
            note  || null,
          ]
        );
        return res.status(201).json({
          ok: true,
          waitlist_id: row.id,
          message: `Vous serez prévenu·e dès que ${moduleDef.label} sera disponible.`,
          created_at: row.created_at,
        });
      } catch (insertErr) {
        // Contrainte unique partielle (déjà inscrit avec ce contact)
        if (insertErr.code === '23505') {
          return res.status(200).json({
            ok: true,
            already_subscribed: true,
            message: `Vous êtes déjà inscrit·e pour ${moduleDef.label}. On vous prévient dès l'ouverture.`,
          });
        }
        throw insertErr;
      }
    } catch (e) {
      next(e);
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/sur-mesure/waitlist/stats — admin uniquement
// ═══════════════════════════════════════════════════════════════════════════════
//
// Compteurs par module pour démarchage commercial vers fournisseurs :
// "47 personnes attendent les lunettes → on signe l'opticien".
//
router.get(
  '/waitlist/stats',
  authenticate,
  requireRole(['admin']),
  async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT module_type,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE notified_at IS NULL) AS pending,
                COUNT(DISTINCT email) FILTER (WHERE email IS NOT NULL) AS unique_emails,
                COUNT(DISTINCT phone) FILTER (WHERE phone IS NOT NULL) AS unique_phones,
                MIN(created_at) AS first_signup,
                MAX(created_at) AS last_signup
           FROM module_waitlist
          GROUP BY module_type
          ORDER BY total DESC`
      );
      res.json({ stats: rows });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
```

---

## 7. Petite refacto recommandée (optionnelle mais propre)

Aujourd'hui `MODULES_REGISTRY` est défini **uniquement** dans `routes/modules.js`. Pour que `routes/sur-mesure.js` y accède sans dépendance circulaire, deux options :

### Option A — Extraire dans un service (préféré)

Créer `services/modules-registry.js` :

```javascript
'use strict';

/**
 * KOMERCE — Registre des modules spécialisés (source de vérité)
 *
 * Lu par :
 *   - routes/modules.js   (catalogue + calcul prix)
 *   - routes/sur-mesure.js (page de garde + waitlist)
 */

module.exports = {
  couture: {
    label:       'Couture & Tenues sur mesure',
    emoji:       '✂️',
    phase:       1,
    disponible:  true,
    description: 'Tissu au choix (Wax, Bazin, Dentelle, Mousseline…) + confection Deira selon mensurations client. Retouche légère possible au relais Anjouan.',
    delai_sup_jours: 5,
    besoin_couvert: 'Couture professionnelle sur mesure · tissus haut de gamme indisponibles localement',
    inputs_requis: ['fabric_id', 'module_size'],
    inputs_optionnels: ['module_instructions', 'module_qty_meters', 'module_accessories'],
  },
  lunettes: {
    label:       'Lunettes de vue & Solaires',
    emoji:       '👓',
    phase:       2,
    disponible:  false,
    description: 'Ordonnance transmise via formulaire ou photo. Sélection monture catalogue Dubai. Montage verres par opticien partenaire. Livraison relais Mutsamudu.',
    delai_sup_jours: 5,
    besoin_couvert: 'Aucun opticien qualifié à Anjouan · verres correcteurs absents du marché local',
    inputs_requis: ['module_instructions'],
    inputs_optionnels: ['module_ref_produit'],
  },
  construction: {
    label:       'Matériaux & Finitions Construction',
    emoji:       '🏗️',
    phase:       3,
    disponible:  false,
    description: 'Carrelage, robinetterie, enduits, peintures professionnelles Dubai. Commande sur devis avec dimensions précises. Panier élevé, livraison groupée.',
    delai_sup_jours: 14,
    besoin_couvert: 'Matériaux de finition qualité absents du marché local · diaspora investit dans l\'immobilier',
    inputs_requis: ['module_instructions'],
    inputs_optionnels: [],
  },
  cosmetiques: {
    label:       'Cosmétiques & Parfums — Marques Dubai',
    emoji:       '💄',
    phase:       2,
    disponible:  false,
    description: 'Marques de soins, parfums oud, cosmétiques professionnels fabriqués à Dubai. Introuvables aux Comores. Accord exclusivité distribution Comores.',
    delai_sup_jours: 0,
    besoin_couvert: 'Marché local limité aux produits génériques · marques professionnelles Dubai absentes',
    inputs_requis: [],
    inputs_optionnels: ['module_ref_produit'],
  },
};
```

Et dans `routes/modules.js`, remplacer la définition inline par :

```javascript
const MODULES_REGISTRY = require('../services/modules-registry');
```

**Avantage** : 1 seule source de vérité, plus simple à étendre. **Coût** : 5 minutes.

### Option B — Réutilisation directe par require

Plus rapide mais moins propre :

```javascript
// routes/sur-mesure.js
const modulesRoute = require('./modules');
// et exporter MODULES_REGISTRY depuis modules.js (pas idéal — couplage routes-routes)
```

**Recommandation** : option A.

---

## 8. Branchement dans `server.js`

Une seule ligne à ajouter, à côté des autres `app.use` modules :

```javascript
// Vers la ligne 317 dans server.js, à côté de modulesRouter
app.use('/api/sur-mesure', require('./routes/sur-mesure'));
```

Si vous avez configuré le `dashboardLimiter` ou un rate-limiter spécifique, l'overview est lourd (4 jointures) — appliquer `dashboardLimiter` au GET /overview est raisonnable :

```javascript
const surMesureRouter = require('./routes/sur-mesure');
app.use('/api/sur-mesure/overview', dashboardLimiter);  // optionnel mais sain
app.use('/api/sur-mesure', surMesureRouter);
```

---

## 9. Tests (à écrire dans `tests/integration/`)

### `tests/integration/sur-mesure.test.js` (squelette)

```javascript
const request = require('supertest');
const app = require('../../server');

describe('GET /api/sur-mesure/overview', () => {
  it('retourne les 4 modules avec statut et CTA', async () => {
    const res = await request(app).get('/api/sur-mesure/overview');
    expect(res.status).toBe(200);
    expect(res.body.modules).toHaveLength(4);
    expect(res.body.modules[0]).toMatchObject({
      type: expect.any(String),
      status: expect.stringMatching(/^(available|coming_soon|on_quote)$/),
      cta: { label: expect.any(String), action: expect.any(String) },
      suggestions: expect.any(Array),
    });
  });

  it('couture est available, lunettes coming_soon', async () => {
    const res = await request(app).get('/api/sur-mesure/overview');
    const couture  = res.body.modules.find(m => m.type === 'couture');
    const lunettes = res.body.modules.find(m => m.type === 'lunettes');
    expect(couture.status).toBe('available');
    expect(lunettes.status).toBe('coming_soon');
  });

  it('renvoie au moins quelques produits sur-mesure léger', async () => {
    const res = await request(app).get('/api/sur-mesure/overview');
    expect(res.body.sur_mesure_leger.products.length).toBeGreaterThan(0);
    expect(res.body.sur_mesure_leger.products[0].category).toBe('Sur-mesure');
  });
});

describe('POST /api/sur-mesure/waitlist', () => {
  it('refuse module disponible (couture)', async () => {
    const res = await request(app)
      .post('/api/sur-mesure/waitlist')
      .send({ module_type: 'couture', email: 'test@test.com' });
    expect(res.status).toBe(400);
  });

  it('accepte inscription lunettes avec email', async () => {
    const res = await request(app)
      .post('/api/sur-mesure/waitlist')
      .send({ module_type: 'lunettes', email: `test+${Date.now()}@test.com` });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it('refuse sans contact (ni email ni phone)', async () => {
    const res = await request(app)
      .post('/api/sur-mesure/waitlist')
      .send({ module_type: 'lunettes' });
    expect(res.status).toBe(400);
  });

  it('idempotent : 2e inscription même email = 200 already_subscribed', async () => {
    const email = `dup+${Date.now()}@test.com`;
    const r1 = await request(app)
      .post('/api/sur-mesure/waitlist')
      .send({ module_type: 'lunettes', email });
    const r2 = await request(app)
      .post('/api/sur-mesure/waitlist')
      .send({ module_type: 'lunettes', email });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r2.body.already_subscribed).toBe(true);
  });
});

describe('GET /api/sur-mesure/waitlist/stats (admin)', () => {
  it('refuse sans auth', async () => {
    const res = await request(app).get('/api/sur-mesure/waitlist/stats');
    expect(res.status).toBe(401);
  });
  // + test avec token admin
});
```

---

## 10. Format de réponse `/overview` (référence frontend)

Pour que le dev frontend puisse câbler la page sans deviner :

```json
{
  "modules": [
    {
      "type": "couture",
      "label": "Couture & Tenues sur mesure",
      "emoji": "✂️",
      "phase": 1,
      "status": "available",
      "description": "Tissu au choix (Wax, Bazin, …) + confection Deira selon mensurations.",
      "besoin_couvert": "Couture professionnelle sur mesure · tissus haut de gamme indisponibles localement",
      "delai_jours": 5,
      "cta": { "label": "Démarrer", "action": "open_form" },
      "suggestions": [
        { "id": "...", "name": "Sandales en cuir", "category": "Mode", "subcategory": "Chaussures", "price_kmf": 7000, "image_url": "...", "promo_pct": 56 },
        { "id": "...", "name": "Sac de soirée doré", "...": "..." }
      ],
      "suggestions_label": "Complétez votre tenue"
    },
    {
      "type": "lunettes",
      "label": "Lunettes de vue & Solaires",
      "emoji": "👓",
      "phase": 2,
      "status": "coming_soon",
      "cta": { "label": "Me prévenir", "action": "subscribe_waitlist" },
      "suggestions": [/* … */],
      "suggestions_label": "À porter avec vos lunettes"
    },
    { "type": "construction", "status": "on_quote", "cta": { "action": "open_quote_form" }, "...": "..." },
    { "type": "cosmetiques",  "status": "coming_soon", "...": "..." }
  ],
  "sur_mesure_leger": {
    "label": "Sur-mesure léger — gravure, prénoms, finitions",
    "description": "Personnalisation simple appliquée à un produit du catalogue.",
    "products": [/* 8 produits category='Sur-mesure' */]
  },
  "inspirations": {
    "label": "Inspirations du catalogue",
    "products": [/* 12 produits Mode/Beauté/Sur-mesure */]
  },
  "generated_at": "2026-05-08T14:32:11Z"
}
```

---

## 11. Évolutions prévues (non livrées en v1)

À noter pour quand la page mûrira :

| Évolution | Pré-requis | Effort estimé |
|---|---|---|
| Cross-suggestions vraiment contextuelles (« cette robe → ces chaussures ») | Données de co-achat OU mapping manuel par produit | 1-2 jours |
| Notification automatique waitlist au passage `disponible: true` | Job de notif (nouveau cron) + templates WhatsApp/email | 4h |
| Compteur public « 47 personnes attendent les lunettes » | Endpoint public sur stats agrégées (sans détail) | 1h |
| Personnalisation par user connecté (« vous êtes inscrit à … ») | Lecture `module_waitlist` par `user_id` dans overview | 30 min |
| Page admin Control Tower : voir/exporter waitlist | Vue dans CT | 2h |
| Tracking conversions waitlist → commande | Champ `converted_to_order_id` sur `module_waitlist` | 1h |

---

## 12. Récapitulatif checklist livraison

- [ ] Migration `066_module_waitlist.sql` ajoutée à `migrations/`
- [ ] Table `module_waitlist` créée en base (manuel ou via runner si la convention le permet)
- [ ] `services/modules-registry.js` extrait (refacto recommandée)
- [ ] `routes/modules.js` mis à jour pour importer le registre
- [ ] `routes/sur-mesure.js` créé
- [ ] `validators/index.js` enrichi de `surMesure.subscribeWaitlist`
- [ ] `server.js` : 1 ligne `app.use('/api/sur-mesure', ...)` ajoutée
- [ ] Tests d'intégration ajoutés (`tests/integration/sur-mesure.test.js`)
- [ ] Documentation : ce fichier déplacé de `_pending/` vers `docs/` si validé
- [ ] PR commitée toutes les 10 min comme demande la règle 🔴 du README
- [ ] ROADMAP_KOMERCE.md mis à jour : nouvel item ✅
- [ ] CARTOGRAPHY (ou ARCHITECTURE_LIVE) mis à jour : +1 route, +1 table

---

## 13. Risques & points d'attention

1. **Pas de migration auto** : Komerce a 3 mécanismes de migration (cf. SCHEMA_GAP_KOMERCE §Architecture). Vérifier comment `066_module_waitlist.sql` sera réellement exécuté en prod (manuel via psql, ou ajouté dans `scripts/fix-schema.js`). **Privilégier `fix-schema.js`** si vous voulez une exécution automatique au boot.

2. **Validation stock catégorie « Sur-mesure »** : actuellement les 12+ produits Sur-mesure du catalogue sont vendables comme produits standard. Si vous voulez qu'ils nécessitent une instruction (`module_instructions`) saisie au checkout, c'est un chantier séparé qui touche `routes/orders/create.js` (donc invariants R5).

3. **Cache CDN devant l'API** : si Cloudflare/Railway met du cache devant `GET /overview`, le bouton « Me prévenir » d'un module qui vient de basculer disponible peut continuer à s'afficher. Solution : TTL court (60s) et invalidation manuelle quand on flip un `disponible:` dans le registre.

4. **i18n** : tous les textes (CTA labels, suggestions_label, etc.) sont en français hardcodés. Si vous prévoyez l'arabe ou les Comores des langues locales, prévoir un i18n simple côté frontend ou backend selon votre conception.

5. **RGPD waitlist** : `module_waitlist` collecte email/phone. Si la base est en UE (Supabase Frankfurt), prévoir une politique de purge (ex : delete après 2 ans sans conversion) — pas urgent mais à documenter.
