# KOMERCE — Variables d'environnement
# Copier en .env et remplir les valeurs réelles

# ── Serveur ───────────────────────────────────────────────────
NODE_ENV=development
PORT=3000

# ── Base de données PostgreSQL ────────────────────────────────
DATABASE_URL=postgresql://komerce_user:komerce2026@localhost:5432/komerce

# ── JWT ───────────────────────────────────────────────────────
JWT_SECRET=change_this_secret_min_32_chars_ici

# ── QR Code retrait ──────────────────────────────────────────
QR_SECRET=change_this_qr_secret_min_32_chars

# ── Africa's Talking (SMS) ────────────────────────────────────
AT_API_KEY=your_africas_talking_api_key
AT_USERNAME=komerce
AT_SENDER_ID=Komerce

# ── Twilio (WhatsApp) ─────────────────────────────────────────
# Trouvez ces valeurs sur https://console.twilio.com
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
# Numéro WhatsApp approuvé ex: whatsapp:+33XXXXXXXXX
# (sandbox Twilio = whatsapp:+14155238886, nécessite opt-in des destinataires)
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# ── Stripe (paiement diaspora EUR) ────────────────────────────
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# ── Cloudinary (images produits + colis) ─────────────────────
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# ── Taux de change (fallback si pas de service externe) ──────
RATE_EUR_KMF=492
RATE_AED_KMF=138

# ── URLs frontends ────────────────────────────────────────────
FRONTEND_URL=http://localhost:3000
