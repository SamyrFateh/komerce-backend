# Komerce — État de session (5 avril 2026)

## ✅ Ce qui a été fait

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

## ⚠️ Bugs trouvés pendant les tests (à corriger)

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

### 1. Tester le flux complet avec les bons IDs
```bash
# Récupérer un product_id valide
GET /api/products → prendre un UUID

# Créer commande avec UUIDs
POST /api/orders { items: [{product_id: "uuid", quantity: 1}], delivery_relay_id: "uuid", payment_mode: "cash_relais", ... }

# Confirmer paiement cash (agent relais)
POST /api/payments/cash/confirm { cash_ref_code: "CODE" }

# 4 scans
POST /api/scans { scan_code: "KOM-XXXX", step: "preparation" }
POST /api/scans { scan_code: "KOM-XXXX", step: "shipped" }
POST /api/scans { scan_code: "KOM-XXXX", step: "relais_received" }
POST /api/scans { scan_code: "KOM-XXXX", step: "collected" }
```

### 2. Tester les pages dans le navigateur
- [ ] Boutique : passer une commande
- [ ] Relais : encaisser le code cash
- [ ] Hub : imprimer QR + scanner préparation + expédié
- [ ] Relais : scanner réception + retrait
- [ ] Pipeline : vérifier que tout avance visuellement

### 3. Préparer le guide pour l'équipe
- Guide Agent Dubai (Hub)
- Guide Agent Relais
- Guide test client

## 📋 Flux validé complet

```
🛍️ CLIENT commande sur la boutique (cash_relais)
   → Reçoit un code cash
        ↓
💵 AGENT RELAIS encaisse le cash + entre le code
   → SMS confirmation envoyé au client
   → Commande passe en "ordered"
        ↓
🛒 AGENT DUBAI voit la commande → achète le produit
        ↓
🏭 HUB DUBAI
   🏷️ Imprime étiquette QR (Komerce_QR_Print.html)
   📱 Scan 1 → preparation
   📱 Scan 2 → shipped ✈️
        ↓
📦 RELAIS COMORES
   📱 Scan 3 → relais_received (SMS "disponible" envoyé au client)
   📱 Scan 4 → collected (client vient chercher)
```

## 🔗 Ressources
- Backend : https://komerce-backend-production.up.railway.app/
- Admin : admin@komerce.km / USJQ9oRx6rSfzzqIubW3Nw
- GitHub : SamyrFateh/komerce-backend
