-- Migration 023b: Add whatsapp_phone column to users table
-- Renommé depuis 023_whatsapp_phone.sql (LOT 5 — résolution doublon numéro 023)
-- Allows diaspora customers to receive WhatsApp notifications on their international number

ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT;

COMMENT ON COLUMN users.whatsapp_phone IS 'Numéro WhatsApp international (diaspora) pour les notifications. Si NULL, on utilise phone.';
