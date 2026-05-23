-- ============================================================
-- KOMERCE — Données initiales (seed)
-- À exécuter UNE SEULE FOIS après schema.sql
-- ============================================================

-- ── ADMIN ────────────────────────────────────────────────────
-- Compte administrateur par défaut.
-- ⚠️  Le mot de passe admin est défini via ADMIN_PASSWORD (variable d'env).
-- Le hash ci-dessous est un placeholder — il sera écrasé au démarrage par server.js.

INSERT INTO users (full_name, email, phone, role, currency_pref, country, password_hash)
VALUES (
  'Admin Komerce',
  'admin@komerce.km',
  NULL,
  'admin',
  'KMF',
  'KM',
  '$2b$10$PLACEHOLDER_ADMIN_HASH_SET_VIA_ADMIN_PASSWORD_ENV_VAR_000'
);

-- Clients de démonstration : diaspora + local
-- Comptes de démonstration — hash placeholder (différent par compte)
-- En dev: utiliser le endpoint POST /api/auth/register pour créer de vrais comptes
INSERT INTO users (full_name, email, phone, role, currency_pref, country, password_hash)
VALUES
  ('Fatouma Ali',     'fatouma.ali@example.com',   '+33600000001', 'client', 'EUR', 'FR', '$2b$10$demo1_fatouma_CHANGE_IN_PROD_aaaaaaaaaaaaaaaaaaaaaaaa'),
  ('Said Mohamed',   'said.m@example.com',       '+33600000002', 'client', 'EUR', 'FR', '$2b$10$demo2_said_CHANGE_IN_PRODUCTION_bbbbbbbbbbbbbbbbbbbbbbb'),
  ('Nadjma Hassan',  'nadjma.h@example.com',       '+97150000003', 'client', 'AED', 'AE', '$2b$10$demo3_nadjma_CHANGE_IN_PRODUCTION_cccccccccccccccccccccc'),
  ('Omar Abdou',     'omar.abdou@komerce.km',    '+269321001',   'client', 'KMF', 'KM', '$2b$10$demo4_omar_CHANGE_IN_PRODUCTION_dddddddddddddddddddddddd'),
  ('Rayhana Said',   'rayhana.s@komerce.km',     '+269321002',   'client', 'KMF', 'KM', '$2b$10$demo5_rayhana_CHANGE_IN_PROD_eeeeeeeeeeeeeeeeeeeeeeeee');

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

-- ── PRODUITS — Catalogue avec images réelles ─────────────────
INSERT INTO products (sku, name, category, emoji, price_kmf, cost_kmf, promo_pct, is_promo, stock, weight_kg, image_url)
VALUES
  -- ── Existants (mis à jour avec images) ──
  ('SKU-001', 'Samsung Galaxy A15 128Go',      'Téléphones',     '📱', 57600, 40000, 35, TRUE,  10, 0.2,
   'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=400&h=400&fit=crop&auto=format&q=80'),

  ('SKU-002', 'Lot 3 abayas brodées',          'Vêtements',      '👗', 38200, 25000, 40, TRUE,   8, 1.5,
   'https://images.unsplash.com/photo-1590156546946-ce55a12a6a3a?w=400&h=400&fit=crop&auto=format&q=80'),

  ('SKU-003', 'Sony WH-CH520 Bluetooth',       'Électronique',   '🎧', 38800, 27000, 28, TRUE,  15, 0.3,
   'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=400&h=400&fit=crop&auto=format&q=80'),

  ('SKU-004', 'Set Tefal 5 pièces inox',       'Électroménager', '🍳', 64400, 46000, 22, TRUE,   5, 3.2,
   'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=400&fit=crop&auto=format&q=80'),

  -- ── Nouveaux produits ──
  ('SKU-005', 'Enceinte JBL Flip 6',           'Électronique',   '🔊', 44200, 30000, 25, TRUE,  12, 0.5,
   'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=400&h=400&fit=crop&auto=format&q=80'),

  ('SKU-006', 'Parfum Oud Al Sultan 100ml',    'Beauté',         '✨', 28800, 18000, 30, TRUE,  20, 0.3,
   'https://images.unsplash.com/photo-1541643600914-78b084683601?w=400&h=400&fit=crop&auto=format&q=80'),

  ('SKU-007', 'Montre connectée Xiaomi Band 8','Électronique',   '⌚', 24600, 16000, 20, TRUE,  18, 0.1,
   'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=400&fit=crop&auto=format&q=80'),

  ('SKU-008', 'Lampe solaire LED extérieur',   'Maison',         '☀️', 14800, 8000,  35, TRUE,  25, 0.8,
   'https://images.unsplash.com/photo-1558449028-b53a39d100fc?w=400&h=400&fit=crop&auto=format&q=80'),

  ('SKU-009', 'Valise cabine 55cm rigide',     'Bagagerie',      '🧳', 34600, 22000, 28, TRUE,   7, 2.5,
   'https://images.unsplash.com/photo-1565026057447-bc90a3dceb87?w=400&h=400&fit=crop&auto=format&q=80'),

  ('SKU-010', 'Nike Air Max 90',               'Chaussures',     '👟', 52400, 36000, 30, TRUE,   6, 0.9,
   'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=400&fit=crop&auto=format&q=80'),

  ('SKU-011', 'Robot mixeur multifonction',     'Électroménager', '🥤', 42000, 28000, 25, TRUE,   8, 2.8,
   'https://images.unsplash.com/photo-1570222094114-d054a817e56b?w=400&h=400&fit=crop&auto=format&q=80'),

  ('SKU-012', 'Kofia brodé traditionnel',       'Vêtements',      '🧢', 9800,  5500,  15, FALSE, 30, 0.1,
   'https://images.unsplash.com/photo-1588850561407-ed78c334e67a?w=400&h=400&fit=crop&auto=format&q=80');

-- ── TISSUS FICTIFS (M11) ──────────────────────────────────────────────────────
INSERT INTO ceremony_fabrics (name, material, price_per_meter_aed, colors, occasions) VALUES
  ('Bazin blanc brillant',  'Bazin',    28, ARRAY['blanc','ivoire'],          ARRAY['mariage','bapteme']),
  ('Bazin coloré imprimé',  'Bazin',    25, ARRAY['bleu','vert','rouge'],     ARRAY['fete','ceremonie']),
  ('Soie imprimée Deira',   'Soie',     45, ARRAY['bleu nuit','bordeaux'],    ARRAY['mariage']),
  ('Wax africain 6 yards',  'Wax',      18, ARRAY['multicolore'],             ARRAY['quotidien','fete']),
  ('Dentelle brodée fine',  'Dentelle', 55, ARRAY['blanc','crème'],           ARRAY['mariage']),
  ('Voile léger cérémonie', 'Voile',    22, ARRAY['blanc','rose poudre'],     ARRAY['ceremonie'])
ON CONFLICT DO NOTHING;

-- ── MODÈLES TENUES FICTIFS (M11) ─────────────────────────────────────────────
INSERT INTO ceremony_models (name, making_cost_aed, fabric_meters, occasions) VALUES
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
