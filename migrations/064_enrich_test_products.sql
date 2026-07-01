-- @migration 064_enrich_test_products.sql
-- @domain    catalog
-- @purpose   Enrichissement product_variants de test
-- @added-header 2026-07-01 (audit gouvernance)

-- ─────────────────────────────────────────────────────────────────────────────
-- LOT 12 — Enrichissement produits test (images multi + variantes)
-- Enrichit 3 produits avec images Unsplash + descriptions riches + variantes.
-- IDEMPOTENT : ON CONFLICT DO NOTHING sur product_variants
-- ─────────────────────────────────────────────────────────────────────────────

SET client_encoding = 'UTF8';

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Caftan marocain brodé fil d'or
--    id : eb75a33d-58d6-415e-97f9-c67287aa1ac2
--    Variantes : Taille (S/M/L/XL/2XL) + Couleur (Or / Bordeaux / Noir)
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE products SET
  description = 'Caftan marocain d''exception, brode a la main avec des fils d''or 24 carats. Tissu satin fluide premium, coupe ajustee qui met en valeur la silhouette. Encolure ronde ornee de broderies florales traditionnelles, manches longues legerement evasees. Parfait pour mariages, fiancailles et occasions speciales. Livre avec sa ceinture assortie. Entretien : lavage main 30 degres, repassage vapeur. Fabrique artisanalement.',
  images = '["https://images.unsplash.com/photo-1585487000160-6ebcfceb0d03?w=600&q=80","https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&q=80","https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&q=80","https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=600&q=80","https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=600&q=80"]'::jsonb
WHERE id = 'eb75a33d-58d6-415e-97f9-c67287aa1ac2';

INSERT INTO product_variants (product_id, variant_type, variant_value, stock, display_order)
VALUES
  ('eb75a33d-58d6-415e-97f9-c67287aa1ac2', 'Taille', 'S',   18, 0),
  ('eb75a33d-58d6-415e-97f9-c67287aa1ac2', 'Taille', 'M',   25, 1),
  ('eb75a33d-58d6-415e-97f9-c67287aa1ac2', 'Taille', 'L',   22, 2),
  ('eb75a33d-58d6-415e-97f9-c67287aa1ac2', 'Taille', 'XL',  14, 3),
  ('eb75a33d-58d6-415e-97f9-c67287aa1ac2', 'Taille', '2XL',  6, 4)
ON CONFLICT (product_id, variant_type, variant_value) DO NOTHING;

INSERT INTO product_variants (product_id, variant_type, variant_value, stock, image_url, display_order)
VALUES
  ('eb75a33d-58d6-415e-97f9-c67287aa1ac2', 'Couleur', 'Or',      30, 'https://images.unsplash.com/photo-1585487000160-6ebcfceb0d03?w=600&q=80', 0),
  ('eb75a33d-58d6-415e-97f9-c67287aa1ac2', 'Couleur', 'Bordeaux',20, 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&q=80', 1),
  ('eb75a33d-58d6-415e-97f9-c67287aa1ac2', 'Couleur', 'Noir',    15, 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&q=80', 2)
ON CONFLICT (product_id, variant_type, variant_value) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Sneakers blanches semelle epaisse plateforme
--    id : 63db5b3a-b8fc-4a27-a6f7-72b307fa2507
--    Variantes : Pointure (36-41) + Couleur (Blanc / Beige / Noir)
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE products SET
  description = 'Sneakers tendance semelle compensee plateforme 5 cm — confort total toute la journee. Tige en cuir synthetique souple, semelle en caoutchouc antiderapante. Design chunky streetwear 2025. Compatible jeans, robes et jupes. Semelle interieure remboursee avec soutien voute plantaire. Fermeture lacets + zip lateral discret.',
  images = '["https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&q=80","https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600&q=80","https://images.unsplash.com/photo-1549298916-b41d501d3772?w=600&q=80","https://images.unsplash.com/photo-1607522370275-f6d7e38d5086?w=600&q=80","https://images.unsplash.com/photo-1575537302964-96cd47c06b1b?w=600&q=80"]'::jsonb
WHERE id = '63db5b3a-b8fc-4a27-a6f7-72b307fa2507';

INSERT INTO product_variants (product_id, variant_type, variant_value, stock, display_order)
VALUES
  ('63db5b3a-b8fc-4a27-a6f7-72b307fa2507', 'Pointure', '36',  8, 0),
  ('63db5b3a-b8fc-4a27-a6f7-72b307fa2507', 'Pointure', '37', 12, 1),
  ('63db5b3a-b8fc-4a27-a6f7-72b307fa2507', 'Pointure', '38', 15, 2),
  ('63db5b3a-b8fc-4a27-a6f7-72b307fa2507', 'Pointure', '39', 10, 3),
  ('63db5b3a-b8fc-4a27-a6f7-72b307fa2507', 'Pointure', '40',  6, 4),
  ('63db5b3a-b8fc-4a27-a6f7-72b307fa2507', 'Pointure', '41',  3, 5)
ON CONFLICT (product_id, variant_type, variant_value) DO NOTHING;

INSERT INTO product_variants (product_id, variant_type, variant_value, stock, image_url, display_order)
VALUES
  ('63db5b3a-b8fc-4a27-a6f7-72b307fa2507', 'Couleur', 'Blanc', 28, 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&q=80', 0),
  ('63db5b3a-b8fc-4a27-a6f7-72b307fa2507', 'Couleur', 'Beige', 14, 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600&q=80', 1),
  ('63db5b3a-b8fc-4a27-a6f7-72b307fa2507', 'Couleur', 'Noir',  10, 'https://images.unsplash.com/photo-1607522370275-f6d7e38d5086?w=600&q=80', 2)
ON CONFLICT (product_id, variant_type, variant_value) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Polo slim fit pique coton
--    id : 2855b932-861b-42ad-8212-e280d23b4ace
--    Variantes : Taille (S/M/L/XL) + Couleur (Blanc / Marine / Rouge / Olive)
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE products SET
  description = 'Polo slim fit classique en pique coton 100% naturel. Coupe ajustee valorisant la silhouette, col chemise 3 boutons nacres. Tissu respirant traitement anti-boulochage, resistant aux lavages repetes. Coutures renforcees epaules et emmanchures. Casual avec chino ou habille sous blazer. Lavage machine 40 degres, sechage plat recommande.',
  images = '["https://images.unsplash.com/photo-1586790170083-2f9ceadc732d?w=600&q=80","https://images.unsplash.com/photo-1625572539428-dea8ec21aca2?w=600&q=80","https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=600&q=80","https://images.unsplash.com/photo-1571945153237-4929e783af4a?w=600&q=80"]'::jsonb
WHERE id = '2855b932-861b-42ad-8212-e280d23b4ace';

INSERT INTO product_variants (product_id, variant_type, variant_value, stock, display_order)
VALUES
  ('2855b932-861b-42ad-8212-e280d23b4ace', 'Taille', 'S',  12, 0),
  ('2855b932-861b-42ad-8212-e280d23b4ace', 'Taille', 'M',  25, 1),
  ('2855b932-861b-42ad-8212-e280d23b4ace', 'Taille', 'L',  20, 2),
  ('2855b932-861b-42ad-8212-e280d23b4ace', 'Taille', 'XL',  8, 3)
ON CONFLICT (product_id, variant_type, variant_value) DO NOTHING;

INSERT INTO product_variants (product_id, variant_type, variant_value, stock, image_url, display_order)
VALUES
  ('2855b932-861b-42ad-8212-e280d23b4ace', 'Couleur', 'Blanc',  20, 'https://images.unsplash.com/photo-1586790170083-2f9ceadc732d?w=600&q=80', 0),
  ('2855b932-861b-42ad-8212-e280d23b4ace', 'Couleur', 'Marine', 18, 'https://images.unsplash.com/photo-1625572539428-dea8ec21aca2?w=600&q=80', 1),
  ('2855b932-861b-42ad-8212-e280d23b4ace', 'Couleur', 'Rouge',  10, 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=600&q=80', 2),
  ('2855b932-861b-42ad-8212-e280d23b4ace', 'Couleur', 'Olive',   6, 'https://images.unsplash.com/photo-1571945153237-4929e783af4a?w=600&q=80', 3)
ON CONFLICT (product_id, variant_type, variant_value) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verification finale
-- ═══════════════════════════════════════════════════════════════════════════
SELECT p.name, jsonb_array_length(p.images) AS nb_images, COUNT(pv.id)::int AS nb_variants
FROM products p
LEFT JOIN product_variants pv ON pv.product_id = p.id
WHERE p.id IN (
  'eb75a33d-58d6-415e-97f9-c67287aa1ac2',
  '63db5b3a-b8fc-4a27-a6f7-72b307fa2507',
  '2855b932-861b-42ad-8212-e280d23b4ace'
)
GROUP BY p.name, p.images;
