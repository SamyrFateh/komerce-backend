-- 023: Add whatsapp_phone column to users table
-- Allows diaspora customers to receive WhatsApp notifications on their international number
-- while keeping the local +269 number for the beneficiary

ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT;

COMMENT ON COLUMN users.whatsapp_phone IS 'Numéro WhatsApp international (diaspora) pour les notifications. Si NULL, on utilise phone.';
