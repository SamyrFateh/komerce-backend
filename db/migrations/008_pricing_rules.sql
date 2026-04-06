-- Migration 008: Add pricing parameter rules to business_rules
-- These rules allow runtime configuration of all pricing constants
-- previously hardcoded in utils/pricing.js.
--
-- Safe to run multiple times (ON CONFLICT DO NOTHING).
-- Date: 2026-04-07

INSERT INTO business_rules (category, key, value, value_type, label_fr, description, min_value, max_value)
VALUES
  ('pricing', 'COMMISSION_AGENT_PCT',            '{"value": 5}',    'number', 'Commission agent S1 (%)',          'Pourcentage commission agent source S1',                       0, 30),
  ('pricing', 'TRANSPORT_DXB_KMF',               '{"value": 500}',  'number', 'Transport intra-Dubai (KMF)',      NULL,                                                           0, 5000),
  ('pricing', 'TRANSITAIRE_PCT',                  '{"value": 2}',    'number', 'Commission transitaire (%)',       NULL,                                                           0, 20),
  ('pricing', 'TRANSITAIRE_FIXED_KMF',            '{"value": 450}',  'number', 'Frais fixes transitaire (KMF)',    NULL,                                                           0, 5000),
  ('pricing', 'PORTUAIRES_KMF',                   '{"value": 1200}', 'number', 'Frais portuaires (KMF)',           NULL,                                                           0, 10000),
  ('pricing', 'TRANSPORT_RELAIS_KMF',             '{"value": 840}',  'number', 'Transport relais (KMF)',           NULL,                                                           0, 5000),
  ('pricing', 'COMMISSION_RELAIS_STANDARD_KMF',   '{"value": 500}',  'number', 'Commission relais standard (KMF)', NULL,                                                           0, 5000),
  ('pricing', 'COMMISSION_RELAIS_SHOWROOM_KMF',   '{"value": 750}',  'number', 'Commission relais showroom (KMF)', NULL,                                                           0, 5000),
  ('pricing', 'FRAIS_STRIPE_PCT',                 '{"value": 2.5}',  'number', 'Frais Stripe diaspora (%)',        NULL,                                                           0, 10),
  ('pricing', 'MARGE_PCT',                        '{"value": 12}',   'number', 'Marge commerciale (%)',            'Pourcentage de marge appliqué sur le prix final',              0, 50)
ON CONFLICT (key) DO NOTHING;
