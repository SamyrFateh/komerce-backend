-- ============================================================
-- Migration 019: Finance Columns on Orders
-- Date: 7 avril 2026
--
-- FIX-005: routes/finance.js (export CSV + rapport PDF) référence
--          4 colonnes qui n'existent pas sur la table orders.
--          Cette migration les ajoute avec des valeurs par défaut NULL.
--          Les colonnes seront remplies progressivement par le métier.
-- ============================================================

-- Coût réel d'achat/logistique en KMF
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cost_real_kmf NUMERIC(12,2);

-- Coût estimé (prévisionnel) en KMF
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cost_estimated_kmf NUMERIC(12,2);

-- Marge réelle en pourcentage (calculée : (total - coût) / total * 100)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS margin_real_pct NUMERIC(5,2);

-- Occasion de la commande (ex: anniversaire, fête, quotidien...)
-- Utilisé pour analytics marketing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_occasion TEXT;

-- ============================================================
-- FIN migration 019
-- ============================================================
