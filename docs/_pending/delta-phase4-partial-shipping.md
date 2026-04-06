# DELTA — Phase 4 : Expédition Partielle (Hub Dubai)

**Date :** 7 avril 2026
**Auteur :** Système (génération automatique)
**Scope :** Backend — routes, validators, SMS, cron

---

## Résumé

Implémentation de l'expédition partielle depuis le Hub Dubai. Quand certains articles d'une commande ne sont pas disponibles (retard fournisseur, rupture temporaire), le hub peut envoyer les articles disponibles immédiatement et créer un backorder pour le reste.

---

## Impact ROADMAP

| Tâche | Avant | Après |
|-------|-------|-------|
| 7.7 — Expédition partielle Hub Dubai | 🔲 TODO | ✅ Done |

---

## Nouveaux endpoints (CARTOGRAPHY)

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| `POST` | `/api/orders/:id/mark-availability` | admin, agent_hub | Marquer la disponibilité des articles (available / delayed / backorder) |
| `POST` | `/api/orders/:id/partial-ship` | admin, agent_hub | Créer une expédition partielle + backorder |
| `GET` | `/api/orders/:id/sub-orders` | admin, agent_hub, agent_relais, owner | Lister les sous-commandes d'une commande |
| `PATCH` | `/api/orders/sub-orders/:subId/status` | admin, agent_hub, agent_relais | Changer le statut d'une sous-commande |
| `POST` | `/api/orders/:id/cancel-backorder` | admin, agent_hub, owner | Annuler un backorder (remboursement/crédit) |

---

## Tables utilisées (existantes — nouvelles colonnes requises)

### `order_items` — colonnes ajoutées
| Colonne | Type | Description |
|---------|------|-------------|
| `availability_status` | `TEXT DEFAULT 'pending'` | `pending` / `available` / `delayed` / `backorder` |
| `estimated_available_at` | `TIMESTAMPTZ` | Date estimée de disponibilité (si retardé) |
| `backorder_reason` | `TEXT` | Raison du retard / backorder |
| `updated_at` | `TIMESTAMPTZ DEFAULT NOW()` | Date dernière mise à jour |

### `sub_orders` — nouvelle table
| Colonne | Type | Description |
|---------|------|-------------|
| `id` | `UUID PRIMARY KEY` | |
| `parent_order_id` | `UUID REFERENCES orders(id)` | Commande parent |
| `type` | `TEXT NOT NULL` | `partial_ship` / `backorder` |
| `status` | `TEXT DEFAULT 'preparation'` | preparation → shipped → in_transit → available → collected / cancelled |
| `tracking_ref` | `TEXT UNIQUE` | Ex: `PS-K482917-1` ou `BO-K482917-2` |
| `estimated_date` | `TIMESTAMPTZ` | Date estimée (backorder) |
| `shipped_at` | `TIMESTAMPTZ` | Date d'expédition |
| `cancel_reason` | `TEXT` | Raison annulation |
| `notes` | `TEXT` | Notes libres |
| `created_by` | `UUID REFERENCES users(id)` | Agent ayant créé |
| `backorder_reminder_sent` | `BOOLEAN DEFAULT FALSE` | Flag rappel SMS envoyé |
| `created_at` | `TIMESTAMPTZ DEFAULT NOW()` | |
| `updated_at` | `TIMESTAMPTZ DEFAULT NOW()` | |

### `sub_order_items` — nouvelle table
| Colonne | Type | Description |
|---------|------|-------------|
| `id` | `UUID PRIMARY KEY` | |
| `sub_order_id` | `UUID REFERENCES sub_orders(id)` | |
| `order_item_id` | `UUID REFERENCES order_items(id)` | Lien vers l'article original |
| `product_id` | `UUID REFERENCES products(id)` | |
| `quantity` | `INTEGER NOT NULL` | |
| `price_kmf` | `NUMERIC NOT NULL` | Prix unitaire KMF |
| `created_at` | `TIMESTAMPTZ DEFAULT NOW()` | |

---

## Règles métier (business_rules)

| Clé | Valeur par défaut | Description |
|-----|-------------------|-------------|
| `PARTIAL_SHIP_DELAY_THRESHOLD_DAYS` | `7` | Nb jours minimum après commande avant de permettre une expédition partielle |
| `PARTIAL_SHIP_MIN_AVAILABLE_PCT` | `30` | % minimum d'articles disponibles pour autoriser l'expédition partielle |
| `BACKORDER_MAX_DAYS` | `45` | Délai max backorder avant proposition d'annulation au client |
| `PARTIAL_SHIP_AUTO_NOTIFY` | `true` | Envoyer automatiquement un SMS au client lors de la création de l'expédition partielle |

---

## SMS ajoutés

| Type | Déclencheur | Contenu |
|------|-------------|---------|
| `partial_ship` | Création expédition partielle | Informe du split (x expédiés, y en backorder) |
| `sub_shipped` | Sous-commande expédiée | Confirmation départ + tracking |
| `sub_available` | Sous-commande disponible au relais | Invitation retrait |
| `backorder_cancelled` | Annulation backorder | Montant crédité/remboursé |
| `backorder_reminder` | Cron 6h — backorder expiré | Propose l'annulation au client |

---

## Cron ajouté

| Nom | Intervalle | Description |
|-----|-----------|-------------|
| Backorder checker | 6 heures | Détecte les backorders expirés, envoie un SMS de proposition d'annulation |

---

## Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `routes/orders.js` | +5 endpoints (mark-availability, partial-ship, sub-orders, sub-order status, cancel-backorder) |
| `validators/index.js` | +4 schémas Joi (markAvailability, partialShip, subOrderStatus, cancelBackorder) |
| `utils/sms.js` | +PARTIAL_SHIP_SMS templates, +processBackorderReminders() |
| `server.js` | +cron backorder checker (6h) |

---

## Notes d'intégration

1. **Migration DB requise** : créer les tables `sub_orders` et `sub_order_items`, ajouter les colonnes à `order_items`.
2. **Route ordering** : le `PATCH /sub-orders/:subId/status` doit être inséré AVANT les routes `/:id/*` dans orders.js pour éviter les conflits de matching Express.
3. **Pas d'annulation automatique** : le cron ne supprime pas les backorders — il propose uniquement l'annulation au client par SMS. L'annulation réelle se fait via `POST /api/orders/:id/cancel-backorder`.
4. **Remboursement** : Stripe si paiement initial Stripe, sinon crédit boutique. Fallback automatique vers crédit boutique si Stripe échoue.
