-- Migration 014e — Routing columns foundation (LOT R2, DEBT-05)
--
-- Contexte : island_code (relais) et destination_island/routing_mode/
-- transit_hub (orders) n'ont jamais existé en tant que migration
-- versionnée — uniquement posées au boot par
-- services/routing.js::ensureRoutingColumns() (DDL runtime, catch-swallow
-- par colonne). Confirmé par LOT R1 (W0-1). Aucune migration existante ne
-- référence ces colonnes, donc aucune contrainte d'ordre héritée —
-- positionnée ici par cohérence avec 014c/014d.
--
-- Contrat reproduit EXACTEMENT depuis docs/db/railway-live-schema.sql
-- (VARCHAR(20), nullable, pas de défaut — identique au DDL runtime).

ALTER TABLE relais ADD COLUMN IF NOT EXISTS island_code VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_island VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS routing_mode VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS transit_hub VARCHAR(20);
