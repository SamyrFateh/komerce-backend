# ADR-005 — Fournisseurs unifiés (Partners v2)

**Date :** avril 2026
**Statut :** Implémenté
**Contexte :** Étape C du plan post-audit. Refonte complète du module Suppliers (qui était en localStorage, sans données métier réelles).

---

## Contexte

L'ancienne vue `ct-views-suppliers.js` :
- Stockait les données dans **localStorage** (par utilisateur, non partagées dans l'équipe)
- Aucun lien avec la base de données ni les commandes/envois
- 3 fournisseurs en dur en exemple
- Champs minimaux (6 colonnes basiques)
- Aucun usage métier réel

Or, le système Komerce gère **3 types de fournisseurs très différents** :

| Type | Cas d'usage | Lien métier |
|---|---|---|
| **Sourcing** | Fournisseurs Dubai/Chine pour le stock standard | Catalogue produits |
| **Personnalisé** | Artisans pour mariage/cérémonie sur-mesure | Commandes assignées |
| **Logistique** | Transitaires, transporteurs | Envois `customs_shipments` |

Plus les types existants `relais` et `agent_hub`. Soit **5 catégories** dans une même table.

## Décision

**Réutiliser la table `partners` existante** (déjà créée par `scripts/fix-schema.js`) et l'enrichir avec :
- Les colonnes métier manquantes (devise, délai, paiement, catégories produits, WhatsApp)
- Les FK vers `customs_shipments.supplier_id` et `orders.supplier_id`
- Une vue `suppliers_stats` pour les KPI agrégés

L'ancienne table avait déjà les bonnes fondations (`partner_type`, contact, île, commission, is_active). Pas de nouvelle table à créer.

### Schéma enrichi (migration 035)

Nouvelles colonnes ajoutées à `partners` :

```sql
country_code TEXT          -- 'AE', 'CN', 'KM', 'FR'...
country_label TEXT         -- 'Émirats Arabes Unis', 'Chine'...
currency TEXT              -- AED, USD, EUR, KMF, CNY
lead_time_days INTEGER     -- délai moyen de livraison
payment_terms TEXT         -- "Acompte 30% + solde livraison"
product_categories TEXT[]  -- {phones, electromenager}
whatsapp_url TEXT          -- lien WhatsApp direct
website_url TEXT
pricing_notes TEXT         -- pour logistique
rating SMALLINT (1-5)      -- qualité subjective
```

Liaisons ajoutées :
```sql
ALTER TABLE customs_shipments ADD COLUMN supplier_id UUID REFERENCES partners(id) ON DELETE SET NULL;
ALTER TABLE orders            ADD COLUMN supplier_id UUID REFERENCES partners(id) ON DELETE SET NULL;
```

`ON DELETE SET NULL` : si un fournisseur est supprimé, les commandes/envois ne sont pas perdus, juste dissociés.

### Vue `suppliers_stats`

Agrège pour chaque fournisseur :
- `orders_count_30d` : commandes liées (pour personnalisé)
- `orders_revenue_30d_kmf` : CA généré
- `avg_margin_pct_90d` : marge moyenne 90j
- `shipments_count` : nombre d'envois douane (pour logistique)
- `avg_customs_rate_90d` : taux douane terrain moyen 90j

Affichée inline sur chaque card pour pilotage rapide.

## Endpoints API

| Méthode | URL | Rôle |
|---|---|---|
| GET | `/api/admin/partners` | Liste filtrée (filtres `?type=`, `?island=`, `?country=`, `?active=`) |
| GET | `/api/admin/partners/stats` | KPI agrégés (vue `suppliers_stats`) |
| GET | `/api/admin/partners/:id` | Détail + stats inline |
| POST | `/api/admin/partners` | Créer un partenaire |
| PUT | `/api/admin/partners/:id` | Modifier un partenaire |
| DELETE | `/api/admin/partners/:id` | Supprimer (avec compte des liens dissociés en retour) |

Les validators Joi (`createPartner`, `updatePartner`, `deletePartner`) sont **alignés sur le vrai schéma DB** (avant cette ADR ils utilisaient `company_name`/`category`/`country` qui n'existaient pas → CRUD cassé silencieusement).

## UI : 5 sections en tabs

```
🏭 Sourcing   |  🎨 Personnalisé  |  🚚 Logistique  |  📍 Relais  |  🏢 Hub
─────────────────────────────────────────────────────────────────────────
[ Recherche par nom/contact/zone ]                    [ + Ajouter ]
─────────────────────────────────────────────────────────────────────────
[Card]    [Card]    [Card]    [Card]
[Card]    [Card]    [Card]    [Card]
```

Chaque card affiche :
- Nom + rating ★
- Contact (nom, téléphone)
- Localisation (pays, île, zone)
- Délai + devise
- Tags (actif/inactif + catégories produits)
- **Stats inline selon le type** :
  - Personnalisé/Sourcing → Cmd 30j + Marge 90j
  - Logistique → Envois 90j + Taux moyen
- Actions : ✏️ Éditer, ⏸/▶ Toggle, 🗑 Supprimer, 💬 WhatsApp direct

Auto-documentation : chaque type a un texte explicatif qui apparaît au-dessus de la grille pour rappeler à quoi sert le type sélectionné.

## Modal CRUD organisé en 5 sections

1. **Identification** — nom, type, rating qualité
2. **Contact** — nom, téléphone, email, WhatsApp, site web
3. **Localisation** — pays, île, ville, adresse
4. **Conditions commerciales** — devise, délai, commission, paiement
5. **Catalogue** — catégories produits, notes tarification (logistique)
6. **Notes générales**

## Branchement avec les autres modules

### `ct-views-customs.js` — champ Transitaire

Le champ "Transitaire" du formulaire "Nouvel envoi" est désormais un **dropdown** alimenté par `/api/admin/partners?type=logistique&active=true` :

```html
<select id="cust-transit-select">
  <option value="">— Aucun —</option>
  <option value="uuid-1">Ahmed Trading (UAE)</option>
  <option value="uuid-2">Al Wafaa Logistics (UAE)</option>
  <option value="__custom__">+ Autre (saisie libre)…</option>
</select>
```

Si "Autre" est sélectionné → un input texte apparaît pour saisir un transitaire ad hoc (sans créer de fiche).

Le `customs_shipments.supplier_id` est désormais enregistré, ce qui permet :
- Cohérence des données (plus 4 orthographes pour "Ahmed")
- Stats par transitaire (taux moyen, nb envois) dans la vue Suppliers
- Tableau de bord futur "Performance transitaires"

### Préparé pour l'usage commande personnalisée (futur)

`orders.supplier_id` existe désormais. Reste à brancher dans la vue commandes pour les `category='ceremonie'` :
- Dropdown des artisans `partner_type='personnalise'`
- Workflow d'assignation
- Notification WhatsApp directe à l'artisan

Cette partie sera implémentée dans une session future (besoin d'aligner les workflows commandes).

## Hygiène collatérale

- L'ancienne implémentation localStorage est **complètement remplacée**
- Le validator Joi (cassé) est aligné
- Constantes `VALID_PARTNER_TYPES`, `VALID_CURRENCIES`, `VALID_ISLANDS` exportées dans le validator pour usage cohérent

## Fichiers livrés

**Créés**
- `migrations/035_partners_enrichment.sql` — colonnes + FK + vue stats
- `docs/ADR-005-suppliers-unifies.md` — ce document

**Modifiés**
- `validators/index.js` — `createPartner`/`updatePartner` alignés + `deletePartner` ajouté + 3 constantes valides
- `routes/admin.js` — endpoints partners enrichis (GET filtrés, GET stats, GET :id, POST/PUT/DELETE)
- `routes/admin-customs-shipments.js` — accepte `supplier_id` dans POST et PATCH
- `public/js/ct-views-suppliers.js` — réécrit complètement (581 lignes, vrai CRUD API)
- `public/js/ct-views-customs.js` — dropdown transitaire branché sur partners

## Déploiement

1. Push code → Railway build
2. Appliquer migration : `psql $DATABASE_URL -f migrations/035_partners_enrichment.sql`
3. Vérifier la Control Tower → section **Configuration** → **🏭 Fournisseurs**
4. Créer 1 fournisseur test de chaque type
5. Aller dans **Historique Douane** → vérifier que le dropdown Transitaire se peuple

## Limites connues / Évolutions possibles

- **Pas encore de filtre par catégorie produit** sur la liste sourcing — à ajouter quand le catalogue grossit
- **Pas de scoring automatique** — le rating reste manuel (1-5 ★). Plus tard on pourrait calculer un score (taux retours, retards, qualité) depuis les données.
- **Pas encore d'upload de logo** ou photo de fiche — texte uniquement
- **Pas d'historique de modifications** — les changements remplacent la valeur
- `orders.supplier_id` est ajouté mais **pas encore exposé dans l'UI commandes** — branchement futur
