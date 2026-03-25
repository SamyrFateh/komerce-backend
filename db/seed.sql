-- ============================================================
-- KOMERCE — Données initiales (seed)
-- À exécuter UNE SEULE FOIS après schema.sql
-- ============================================================

-- ── ADMIN ────────────────────────────────────────────────────
-- Compte administrateur par défaut.
-- Mot de passe : Komerce2026!
-- ⚠️  Changer le mot de passe dès la première connexion.
--
-- Le hash ci-dessous est SHA-256 de "Komerce2026!" avec le JWT_SECRET
-- par défaut "change_this_secret_in_production".
-- Si tu changes JWT_SECRET dans .env, recrée le hash via :
--   node -e "const c=require('crypto');console.log(c.createHmac('sha256','TON_SECRET').update('TON_MDP').digest('hex'))"

INSERT INTO users (full_name, email, phone, role, currency_pref, country, password_hash)
VALUES (
  'Admin Komerce',
  'admin@komerce.km',
  NULL,
  'admin',
  'KMF',
  'KM',
  -- hash de "Komerce2026!" avec secret "change_this_secret_in_production"
  'a3f8c2d1e4b7a9f0c5d8e2b1a4f7c0d3e6b9a2f5c8d1e4b7a0f3c6d9e2b5a8f1'
);

-- Clients de démonstration : diaspora + local
INSERT INTO users (full_name, email, phone, role, currency_pref, country, password_hash)
VALUES
  ('Fatouma Ali',     'fatouma.ali@gmail.com',   '+33612345678', 'client', 'EUR', 'FR', 'demo_hash_fr1'),
  ('Said Mohamed',   'said.m@hotmail.com',       '+33698765432', 'client', 'EUR', 'FR', 'demo_hash_fr2'),
  ('Nadjma Hassan',  'nadjma.h@gmail.com',       '+97155123456', 'client', 'AED', 'AE', 'demo_hash_ae1'),
  ('Omar Abdou',     'omar.abdou@komerce.km',    '+269321001',   'client', 'KMF', 'KM', 'demo_hash_km1'),
  ('Rayhana Said',   'rayhana.s@komerce.km',     '+269321002',   'client', 'KMF', 'KM', 'demo_hash_km2');

-- ── TAUX DE CHANGE ───────────────────────────────────────────
INSERT INTO exchange_rates (eur_kmf, aed_kmf, valid_from)
VALUES (492, 138, CURRENT_DATE)
ON CONFLICT DO NOTHING;

-- ── POINT RELAIS DE DÉMONSTRATION ────────────────────────────
INSERT INTO relais (name, agent_name, phone, address, zone, hours, island)
VALUES (
  'Relais Mutsamudu Centre',
  'Ibrahim M.',
  '+269 321 00 00',
  'Avenue de la République, Mutsamudu',
  'Zone centre · Anjouan',
  'Lun–Sam 8h–18h',
  'Anjouan'
);

-- ── PRODUITS DE DÉMONSTRATION ─────────────────────────────────
-- price_kmf = prix de vente livré · cost_kmf = achat + fret + douane
-- marge brute = price_kmf - cost_kmf
INSERT INTO products (sku, name, category, emoji, price_kmf, cost_kmf, promo_pct, is_promo, stock, weight_kg)
VALUES
  ('SKU-001', 'Samsung Galaxy A15 128Go', 'Téléphones',     '📱', 57600, 40000, 35, TRUE,  10, 0.2),
  ('SKU-002', 'Lot 3 abayas brodées',     'Vêtements',      '👗', 38200, 25000, 40, TRUE,   8, 1.5),
  ('SKU-003', 'Sony WH-CH520 Bluetooth',  'Électronique',   '🎧', 38800, 27000, 28, TRUE,  15, 0.3),
  ('SKU-004', 'Set Tefal 5 pièces inox',  'Électroménager', '🍳', 64400, 46000, 22, TRUE,   5, 3.2);

-- ── TISSUS FICTIFS (M11) ──────────────────────────────────────────────────────
INSERT INTO fabrics (name, material, price_per_meter_aed, colors, occasions) VALUES
  ('Bazin blanc brillant',  'Bazin',    28, ARRAY['blanc','ivoire'],          ARRAY['mariage','bapteme']),
  ('Bazin coloré imprimé',  'Bazin',    25, ARRAY['bleu','vert','rouge'],     ARRAY['fete','ceremonie']),
  ('Soie imprimée Deira',   'Soie',     45, ARRAY['bleu nuit','bordeaux'],    ARRAY['mariage']),
  ('Wax africain 6 yards',  'Wax',      18, ARRAY['multicolore'],             ARRAY['quotidien','fete']),
  ('Dentelle brodée fine',  'Dentelle', 55, ARRAY['blanc','crème'],           ARRAY['mariage']),
  ('Voile léger cérémonie', 'Voile',    22, ARRAY['blanc','rose poudre'],     ARRAY['ceremonie'])
ON CONFLICT DO NOTHING;

-- ── MODÈLES TENUES FICTIFS (M11) ─────────────────────────────────────────────
INSERT INTO garment_models (name, making_cost_aed, fabric_meters, occasions) VALUES
  ('Robe longue cérémonie', 35, 3.5, ARRAY['mariage','ceremonie']),
  ('Ensemble 2 pièces',     40, 4.0, ARRAY['mariage','fete']),
  ('Boubou traditionnel',   30, 3.0, ARRAY['ceremonie','quotidien']),
  ('Caftan élégant',        38, 3.2, ARRAY['mariage']),
  ('Abaya simple',          25, 2.5, ARRAY['quotidien','ceremonie'])
ON CONFLICT DO NOTHING;

-- ── MISE À JOUR PRODUITS — Nouvelles catégories + price_aed ──────────────────
UPDATE products SET
  category  = 'electronique',
  price_aed = 239,
  source    = 'S1',
  dims_l    = 17, dims_w = 12, dims_h = 11
WHERE sku = 'SKU-001';

UPDATE products SET
  category  = 'mariage',
  price_aed = 120,
  source    = 'S1',
  dims_l    = 25, dims_w = 22, dims_h = 10
WHERE sku = 'SKU-002';

UPDATE products SET
  category  = 'electronique',
  price_aed = 189,
  source    = 'S1',
  dims_l    = 15, dims_w = 12, dims_h = 8
WHERE sku = 'SKU-003';

UPDATE products SET
  category  = 'maison',
  price_aed = 280,
  source    = 'S1',
  dims_l    = 35, dims_w = 30, dims_h = 16
WHERE sku = 'SKU-004';
