# Komerce — État de session

---

## 📅 Session du 6 avril 2026

### [2026-04-06 04:30 GMT+2] — 🐛 Fix désynchronisation DB ↔ Code — Pipeline MVP 6 étapes

- **Statut** : ✅ Terminé (PR #62 ouverte)
- **Problème** : L'enum PostgreSQL `order_status` (9 valeurs) était désynchronisé avec le code `orders.js` qui utilisait 13 statuts dont 4 absents de la DB (`ordered`, `purchasing`, `hub_preparation`, `transit_comores`). Toute transition vers ces statuts crashait en DB.
- **Solution** :
  - Pipeline simplifié de 10 à **6 étapes opérationnelles** : `confirmed → ordered → preparation → shipped → available → collected` (+ `cancelled`, `refunded`)
  - Suppression des statuts inutiles : `draft`, `paid`, `purchasing`, `hub_preparation`, `transit_comores`
- **Fichiers modifiés** :
  - `db/migrations/004_fix_order_status_enum.sql` (nouveau) — migration sécurisée avec mapping des données existantes
  - `routes/orders.js` (v8.0) — 15 patches : ORDER_STATUSES, VALID_TRANSITIONS, TRANSITION_ROLES, STATUS_SMS, filtres relais, règles problems
- **DB impactée** :
  - Enum `order_status` : recréé avec 8 valeurs (`confirmed`, `ordered`, `preparation`, `shipped`, `available`, `collected`, `cancelled`, `refunded`)
  - Table `orders` : colonne `status` mise à jour (mapping automatique `paid→ordered`, `purchasing→ordered`, `hub_preparation→preparation`, `transit_comores→shipped`, `draft→confirmed`)
  - Table `order_status_history` : colonne `status` mise à jour (même mapping)
- **PR** : #62 — `fix/order-status-pipeline-mvp`
- **⚠️ Ordre d'exécution** : Exécuter `004_fix_order_status_enum.sql` sur Supabase AVANT de merger la PR
- **Points en suspens** :
  - Mettre à jour `payments.js`, `scans.js`, `purchasing.js` pour aligner les statuts utilisés dans ces routes
  - Tester le flux complet en staging après migration

### [2026-04-06 04:35 GMT+2] — 📝 Ajout README.md racine + mise à jour documentation

- **Statut** : ✅ Terminé
- **Fichiers modifiés** :
  - `README.md` (nouveau, racine) — Bloc ⚠️ AGENT IA visible en premier, liens vers toute la doc
  - `docs/CARTOGRAPHY_360.md` — Section 6 mise à jour avec le nouveau pipeline MVP 6 étapes
  - `docs/SESSION_STATUS.md` — Journal mis à jour avec les actions de cette session
- **Objectif** : Tout agent IA voit les règles immédiatement dès l'ouverture du repo

---

## 📅 Session du 5 avril 2026

### PR #52 — Mergée ✅
- Fix scan QR sur Hub et Relais (`scan_code` + `step` au lieu de `order_id` + `scan_type`)
- Bouton 🏷️ Print QR ajouté sur Hub
- Page `Komerce_QR_Print.html` créée (impression batch étiquettes QR)

### PR #53 — Mergée ✅
- Section **💵 Encaissement Cash** ajoutée sur `Komerce_Relais.html`
  - Input code cash + bouton Encaisser
  - Tableau des commandes `confirmed` en attente de paiement
- Endpoint `GET /api/orders/relais` modifié pour inclure les commandes `confirmed` cash_relais

### Vérifications
- Flux API complet testé : `confirmed → ordered → preparation → shipped → available → collected` ✅
- Infrastructure SMS déjà en place (Africa's Talking) — SMS envoyé automatiquement quand paiement cash confirmé ✅
- Base purgée (0 commandes, 50 produits)

## ⚠️ Bugs connus

### Format des IDs pour créer une commande
L'API `/api/orders` attend des **UUID strings**, pas des integers :
- `product_id` → doit être un UUID string (ex: `"7c19dde1-..."`)
- `delivery_relay_id` → doit être un UUID string (ex: `"02c78574-..."`)

### Structure réponse `/api/orders`
- Retourne un **array** directement, pas `{orders: [...]}`

### Relais IDs disponibles
```
"02c78574-0086-5905-a5cd-e0f48a4d134c" → Relais Moroni Volo-Volo
"7c19dde1-9142-5045-83eb-1c1162adb1b9" → Relais Domoni
"326a56cd-4efe-5721-a6a2-f5f4fa30d176" → Relais Mutsamudu Centre
"48224a8f-5f3f-509a-8a38-5bb153f69a59" → Relais Fomboni
```

## 🎯 Prochaine séance — TODO

### 1. Merger PR #62 et exécuter la migration
```bash
# 1. Exécuter la migration SQL sur Supabase
# 2. Merger PR #62
# 3. Vérifier que le déploiement Railway fonctionne
```

### 2. Aligner les autres routes sur le nouveau pipeline
- `payments.js` — vérifier les statuts utilisés après paiement
- `scans.js` — vérifier les steps vs nouveaux statuts
- `purchasing.js` — simplifier ou supprimer si le flux est allégé

### 3. Tester le flux complet avec les bons IDs
```bash
POST /api/orders { items: [{product_id: "uuid", quantity: 1}], delivery_relay_id: "uuid", payment_mode: "cash_relais" }
POST /api/payments/cash/confirm { cash_ref_code: "CODE" }
POST /api/scans { scan_code: "KOM-XXXX", step: "preparation" }
POST /api/scans { scan_code: "KOM-XXXX", step: "shipped" }
POST /api/scans { scan_code: "KOM-XXXX", step: "available" }
POST /api/scans { scan_code: "KOM-XXXX", step: "collected" }
```

### 4. Préparer les guides pour l'équipe
- Guide Agent Dubai (Hub)
- Guide Agent Relais
- Guide test client

## 📋 Pipeline validé (MVP 6 étapes)

```
🛍️ CLIENT commande sur la boutique (cash_relais)
   → Statut : confirmed
   → Reçoit un code cash
        ↓
💵 AGENT RELAIS encaisse le cash + entre le code
   → Statut : ordered
   → SMS confirmation envoyé au client
        ↓
🏭 HUB DUBAI
   🏷️ Imprime étiquette QR (Komerce_QR_Print.html)
   📱 Scan → preparation
   📱 Scan → shipped ✈️
        ↓
📦 RELAIS COMORES
   📱 Scan → available (SMS "disponible" envoyé au client)
   📱 Scan → collected (client vient chercher)
```

## 🔗 Ressources
- Backend : https://komerce-backend-production.up.railway.app/
- Admin : admin@komerce.km / USJQ9oRx6rSfzzqIubW3Nw
- GitHub : SamyrFateh/komerce-backend
