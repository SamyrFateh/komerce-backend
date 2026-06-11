# D1 — Cartographie provider notifications
> Lot : L0-D · Sous-lot : D1 (lecture seule)  
> Date : 2026-06-11  
> Source : analyse code `backend.zip` v10.6.1  
> Objectif : trancher ambiguïté provider, identifier le legacy mort, préparer D2 (nettoyage) et D3 (sonde santé).

---

## 1. Matrice canal → provider

| Canal | Provider | Fichier | Statut | Variables d'env |
|---|---|---|---|---|
| WhatsApp templates (commandes, OTP, magic link) | **Authkey** | `services/authkey-client.js` | ✅ **ACTIF** — seul provider câblé dans `notification-service.js` | `AUTHKEY_API_KEY`, `AUTHKEY_ALLOWED_PHONES`, `AUTHKEY_COUNTRY_CODE`, `WID_*` |
| WhatsApp text libre (notifyText, OTP fallback) | **Authkey** | `services/authkey-client.js` → `callAuthKeyText` | ✅ **ACTIF** | idem |
| Webhook entrant Authkey (accusés de livraison) | **Authkey** | `server.js` → `middleware/verify-authkey-webhook.js` | ✅ **ACTIF** — sécurisé (F3 L0-C C2) | `AUTHKEY_WEBHOOK_SECRET` |
| WhatsApp API officielle Meta (Cloud API) | **Meta** | `services/whatsapp-meta.js`, `routes/meta-whatsapp.js` | ⚠️ **PRÉSENT MAIS NON CÂBLÉ** — jamais importé par `notification-service.js`. Route webhook Meta existe (`/api/meta/whatsapp`) mais aucune notification ne passe par ce provider. | `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_APP_SECRET`, `META_WA_VERIFY_TOKEN`, `META_WA_GRAPH_VERSION` |
| SMS Africa's Talking | **Africa's Talking** | absent du repo | 💀 **MORT** — `utils/sms.js` référencé dans `CARTOGRAPHY_360.md` §sms_log mais **le fichier n'existe pas**. `AT_API_KEY` dans `.env.example` uniquement. | `AT_API_KEY` |
| SMS/WhatsApp Twilio | **Twilio** | absent du repo | 💀 **MORT** — `TWILIO_*` dans `.env.example` uniquement, aucun fichier client, aucun import. | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` |
| Email (facture, confirmation) | **Non identifié** | `notification-service.js` signature `notifyOrderCreated` accepte `userEmail` | ⚠️ **PARAMÈTRE JAMAIS UTILISÉ** — `userEmail` et `emailItems` reçus mais aucun appel email dans le corps de la fonction. | — |

---

## 2. Flux réel de notification (chemin d'exécution confirmé)

```
notification-service.js
  └── authkey-client.js
        ├── callAuthKey()       → POST authkey.io/restapi/requestjson.php (templates WID)
        └── callAuthKeyText()   → POST authkey.io/restapi/requestjson.php (texte libre)

Webhook entrant :
  GET /webhook/authkey-whatsapp?token=<secret>
    └── middleware/verify-authkey-webhook.js  (timingSafeEqual)
```

`whatsapp-meta.js` est un module standalone **jamais appelé** par `notification-service.js`. Il pourrait être une migration en cours ou un code préparatoire abandonné.

---

## 3. Divergence doc/code

| Fichier | Affirmation | Réalité code |
|---|---|---|
| `CARTOGRAPHY_360.md` §8bis | `sms_log` consommée par `utils/sms.js` | `utils/sms.js` **n'existe pas**. `sms_log` est uniquement lue par `routes/admin.js` et `routes/relay-dashboard.js` (affichage). |
| `CARTOGRAPHY_360.md` §8bis | Providers : Authkey, Twilio, Africa's Talking | Twilio et Africa's Talking sont **morts** — aucun fichier client, aucun import. |
| `.env.example` | `AT_API_KEY`, `TWILIO_*` listées comme variables actives | Jamais consommées par aucun fichier du repo. |

---

## 4. Ambiguïté Meta — décision requise

`whatsapp-meta.js` et `routes/meta-whatsapp.js` sont présents et fonctionnels mais **déconnectés** du flux de notification.

**Deux cas possibles :**

| Scénario | Signification | Action D2 |
|---|---|---|
| **A — Migration en cours** | L'équipe prévoit de migrer d'Authkey vers Meta Cloud API (meilleure fiabilité, déliverabilité garantie) | Conserver `whatsapp-meta.js`, câbler dans `notification-service.js` en parallèle ou en remplacement d'Authkey |
| **B — Code préparatoire abandonné** | Le webhook Meta a été monté pour recevoir des statuts de livraison entrants, mais la migration envoi n'a jamais eu lieu | Supprimer ou archiver `whatsapp-meta.js` + `routes/meta-whatsapp.js` ; retirer les `META_WA_*` de `.env.example` |

**Recommandation :** trancher en D2 avant go-live. Authkey est stable — ne pas migrer pendant la fenêtre go-live sans tests E2E complets.

---

## 5. Variables d'environnement à auditer (D2)

### À conserver (provider actif)
```
AUTHKEY_API_KEY              # obligatoire — bloquant si absent
AUTHKEY_ALLOWED_PHONES       # staging whitelist
AUTHKEY_COUNTRY_CODE         # fallback indicatif pays (défaut 269)
AUTHKEY_WEBHOOK_SECRET       # sécurité webhook entrant (L0-C C2)
WID_ORDER_CREATED            # template WID (défaut hardcodé 32183)
WID_PAYMENT_CONFIRMED        # défaut 32182
WID_ORDER_SHIPPED            # défaut 32184
WID_ORDER_DELIVERED          # défaut 32185
WID_ORDER_CANCELLED          # défaut 32186
WID_ABANDONED_CART           # défaut 32187
WID_OTP                      # OTP WhatsApp (pas de défaut — OTP passe par texte libre si absent)
WID_MAGIC_LINK               # Magic link (fallback sur WID_OTP si absent)
```

### À supprimer de `.env.example` (providers morts)
```
AT_API_KEY                   # Africa's Talking — mort
TWILIO_ACCOUNT_SID           # Twilio — mort
TWILIO_AUTH_TOKEN            # Twilio — mort
TWILIO_WHATSAPP_FROM         # Twilio — mort
```

### À trancher (Meta — scénario A ou B)
```
META_WA_TOKEN
META_WA_PHONE_NUMBER_ID
META_WA_APP_SECRET
META_WA_VERIFY_TOKEN
META_WA_GRAPH_VERSION
```

---

## 6. Prochaines actions (D2 + D3)

| Sous-lot | Action | Effort | Dépendance |
|---|---|---|---|
| **D2a** | Supprimer `AT_API_KEY`, `TWILIO_*` de `.env.example` + corriger `CARTOGRAPHY_360.md` §sms_log | 15 min | Aucune |
| **D2b** | Trancher Meta : conserver ou archiver `whatsapp-meta.js` + `routes/meta-whatsapp.js` | 30 min | Décision équipe (scénario A ou B) |
| **D2c** | `AUTHKEY_API_KEY` dans `REQUIRED_ENV` si pas déjà fait | 5 min | Vérifier `bootstrap/env.js` |
| **D3** | `GET /api/health/notifications` — sonde envoi test + check `authkey_rejected` dans `notification_log` | 2h | D2 terminé |

---

## 7. Garde-fous (rappel pour D2/D3)

- Ne jamais bloquer la route principale sur une erreur de notification (invariant panier partagé : best-effort post-commit).
- OTP intouchable en surface : ne pas casser `routes/otp.js` ni `otp-test-mode.js`.
- Conserver la traçabilité `notification_log` / `sms_log` (même si `sms_log` n'est plus alimentée activement).
- Ne pas supprimer de tables DB.
