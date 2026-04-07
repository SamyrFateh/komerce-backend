# 🔧 PARTS_MODULE_ANALYSIS.md
## Analyse d'impact — Module Pièces Détachées Auto/Moto (Visual-First)

> **Statut** : ⬜ Backlog post-Vague 3  
> **Effort estimé** : ~13h (roadmap) + ~4h pour le flow "demande assistée" = ~17h  
> **Auteur** : Analyse pré-code obligatoire — ZONE_IMPACT protocole  
> **Date** : 2026-04-08  
> **⚠️ Ce document doit être validé par le propriétaire avant toute écriture de code.**

---

## 1. PÉRIMÈTRE DU BESOIN

### Besoin validé

Créer dans Komerce un module pièces détachées auto/moto multimarque, adapté à des utilisateurs qui savent reconnaître une pièce mais ne savent pas forcément la nommer ni lire un catalogue classique.

**Principe** : parcours ultra visuel, guidé, mobile-first, avec choix du véhicule, navigation par zone mécanique, galerie photo des pièces, puis validation anti-erreur avant achat.

| Exigence | Nature |
|----------|--------|
| Photos > texte | UX frontend |
| Logos et pictogrammes | UX frontend |
| Bouton "je ne suis pas sûr" | **Nouveau flow backend** |
| Envoi de photo de la pièce par l'utilisateur | Upload + stockage |
| Assistance humaine disponible | Notification + workflow |
| Logique demande assistée si commande pas assez fiable | **Nouveau concept backend** |
| Ne PAS être un e-commerce texte/références standard | Contrainte de conception |

---

## 2. CHECKLIST PRÉ-CODE (ZONE_IMPACT — OBLIGATOIRE)

| # | Question | Réponse |
|---|----------|---------|
| 1 | **Zones touchées** | `products.js` (🟠28), `orders.js` (🔴84), `baskets.js` (🟢10), `payments.js` (🟠35), `uploads.js` (🟢) |
| 2 | **Nouveaux composants** | `parts.js`, `vehicles.js`, `assisted-requests.js`, `part-photos.js` |
| 3 | **Tables W existantes** | `products`, `orders`, `order_items`, `baskets` |
| 4 | **Tables W nouvelles** | `vehicles`, `vehicle_models`, `part_zones`, `parts`, `part_photos`, `assisted_requests`, `assisted_request_photos` |
| 5 | **Invariants concernés** | ✅ **R1** (orders.status via parcelSync), ✅ **R3** (machine à états orders), ✅ **R5** (transaction stock) |
| 6 | **Blast radius** | `payments → purchasing → scans → parcelSync → orders.status → dashboard` |
| 7 | **Score de risque global** | 🔴 — intégration dans la chaîne critique |
| 8 | **Ce delta est dans `_work/` ?** | ✅ Ce fichier = le delta |

---

## 3. DÉCISION ARCHITECTURALE CRITIQUE — "Demande Assistée"

### Le problème

Le concept "demande assistée" (commande pas assez fiable → intervention humaine avant achat) **n'existe pas** dans la machine à états actuelle :

```
confirmed → ordered → preparation → shipped → collected
```

### Option A — Statut dans `orders` : `pending_validation`
- ❌ Casse **R3** (machine à états orders = invariant non-négociable)
- ❌ Une demande assistée n'est PAS encore une commande
- ❌ Polluterait `parcelSync.js` avec une branche qu'il ne doit pas gérer

### Option B — Table séparée `assisted_requests` ✅ RETENU
- ✅ Isolation totale — pas de contact avec `parcelSync.js`
- ✅ Cycle de vie propre (5 états, voir §4)
- ✅ Bascule en `orders` **uniquement** après validation humaine explicite
- ✅ Le dashboard pièces peut exister sans impacter le dashboard logistique

**Règle ajoutée** :
> **R7** — Aucune `assisted_request` ne bascule en `order` sans une action humaine explicite (`status = validated`). Jamais automatiquement.

---

## 4. SCHÉMA DE BASE DE DONNÉES

### Tables nouvelles (aucun impact sur l'existant)

```sql
-- Référentiel véhicules
CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  make VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  logo_url TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE vehicle_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id),
  name VARCHAR(100) NOT NULL,
  year_start INTEGER,
  year_end INTEGER,
  image_url TEXT
);

CREATE TABLE part_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  icon_url TEXT,
  description TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  zone_id UUID REFERENCES part_zones(id),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  oem_ref VARCHAR(100),
  price_kmf NUMERIC(10,2),
  stock_qty INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE part_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID REFERENCES parts(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  alt_text VARCHAR(200),
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE part_vehicle_compat (
  part_id UUID REFERENCES parts(id) ON DELETE CASCADE,
  vehicle_model_id UUID REFERENCES vehicle_models(id) ON DELETE CASCADE,
  notes TEXT,
  PRIMARY KEY (part_id, vehicle_model_id)
);

CREATE TABLE assisted_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  vehicle_model_id UUID REFERENCES vehicle_models(id),
  zone_id UUID REFERENCES part_zones(id),
  part_id UUID REFERENCES parts(id),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  confidence_level VARCHAR(20),
  user_description TEXT,
  admin_notes TEXT,
  order_id UUID REFERENCES orders(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE assisted_request_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assisted_request_id UUID REFERENCES assisted_requests(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  uploaded_by VARCHAR(20) DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. MACHINE À ÉTATS — `assisted_requests.status`

```
                    ┌─────────────┐
                    │   pending   │  ← Créé par l'utilisateur
                    └──────┬──────┘
                           │ Admin prend en charge
                           ▼
                    ┌─────────────┐
                    │  reviewing  │  ← Admin analyse
                    └──────┬──────┘
                    ┌──────┴──────┐
                    │             │
                    ▼             ▼
             ┌──────────┐  ┌──────────┐
             │validated │  │ rejected │
             └────┬─────┘  └──────────┘
                  │ Action humaine EXPLICITE (R7)
                  ▼
        ┌──────────────────────┐
        │ converted_to_order   │  ← order_id renseigné
        └──────────────────────┘
```

**Transitions interdites** :
- `pending → converted_to_order` (bypasse R7)
- `reviewing → converted_to_order` (idem)
- `rejected → *` (état final)
- `converted_to_order → *` (état final)

---

## 6. NOUVELLES ROUTES

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/vehicles` | Liste marques + logos |
| GET | `/api/vehicles/:id/models` | Modèles d'une marque |
| GET | `/api/parts/zones` | Zones mécaniques + pictogrammes |
| GET | `/api/parts` | Catalogue filtré |
| GET | `/api/parts/:id` | Détail pièce + photos |
| POST | `/api/assisted-requests` | Créer une demande |
| POST | `/api/assisted-requests/:id/photos` | Uploader une photo |
| GET | `/api/assisted-requests/:id` | État de ma demande |
| GET | `/api/admin/assisted-requests` | Liste admin |
| PATCH | `/api/admin/assisted-requests/:id/status` | Changer statut |
| POST | `/api/admin/assisted-requests/:id/convert` | **R7** : convertir en order |

---

## 7. IMPACT SUR L'EXISTANT

| Module | Impact | Action |
|--------|--------|--------|
| `products.js` (🟠28) | Mineur — relation optionnelle | Aucune modification |
| `orders.js` (🔴84) | Nul jusqu'à conversion | Admin appelle POST /orders existant |
| `baskets.js` (🟢10) | Nul | Pièce = produit standard dans le panier |
| `payments.js` (🟠35) | Nul | Aucune modification |
| `parcelSync.js` (🔴) | **ZÉRO** | Ne jamais y référencer ce module |
| Dashboard | Additif uniquement | Widget "Demandes assistées" optionnel |

---

## 8. UPLOAD PHOTOS

- Utiliser `multer` existant
- Bucket : `/uploads/assisted-requests/`
- Max : 10MB / photo, 5 photos / demande
- Formats : JPG, PNG, WebP
- ⚠️ Valider MIME type (issue #71)

---

## 9. NOTIFICATIONS

| Événement | Destinataire | Canal |
|-----------|-------------|-------|
| Nouvelle demande | Admin | SMS (`utils/sms.js`) |
| En reviewing | Utilisateur | SMS |
| Validée / rejetée | Utilisateur | SMS |
| Convertie en order | Utilisateur | SMS standard |

---

## 10. BLAST RADIUS

| Scénario | Impact | Risque |
|----------|--------|--------|
| Bug `parts.js` | Catalogue KO | 🟢 Isolé |
| Bug `assisted-requests.js` | Demandes bloquées | 🟢 Isolé |
| Bug conversion R7 | Order mal formé | 🔴 Tester |
| Tables nouvelles corrompues | Module parts KO | 🟢 0 impact logistique |
| Upload photos KO | Pas de photos | 🟠 Demande possible sans photo |

---

## 11. PLAN D'IMPLÉMENTATION SÉQUENCÉ

> ⚠️ Respecter cet ordre strict.

| # | Tâche | Risque |
|---|-------|--------|
| 3.1 | Migration DB | 🟢 |
| 3.2 | CRUD `vehicles` + `vehicle_models` | 🟢 |
| 3.3 | CRUD `part_zones` | 🟢 |
| 3.4 | CRUD `parts` + photos | 🟢 |
| 3.5 | API lecture publique catalogue | 🟢 |
| 3.6 | `assisted-requests` — création + upload | 🟠 |
| 3.7 | `assisted-requests` — admin workflow | 🟠 |
| 3.8 | Conversion R7 → order | 🔴 |
| 3.9 | Notifications SMS | 🟠 |
| 3.10 | Widget dashboard | 🟢 |
| 3.11 | Frontend catalogue visuel | 🟠 |
| 3.12 | Tests & validation | 🔴 |

---

## 12. TESTS OBLIGATOIRES AVANT MERGE

| Test | Critère |
|------|---------|
| Machine à états `assisted_requests` | Toute transition interdite → 400 |
| R7 : `pending → converted_to_order` | → 403 Forbidden |
| R1 : pièce → panier → order | `orders.status` jamais écrit directement |
| Upload photo MIME injection | Fichier non-image → 400 |
| Isolation | Bug `parts.js` n'affecte pas `orders` |

---

> 📌 **Prochaine action** : valider ce document, puis démarrer par 3.1 (migration DB) uniquement après la fin de Vague 3.
>
> **Ne pas coder avant validation.**
