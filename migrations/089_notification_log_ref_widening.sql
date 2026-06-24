-- Migration 089 — notification_log : élargir order_ref et parcel_ref
-- Raison : notifyText passe des UUIDs (36 chars) dans order_ref varchar(30) → overflow
-- Le bug cause un "value too long for type character varying(30)" silencieux
-- → toutes les notifications invoice_ready ne sont pas loggées
-- Fix : varchar(30) → text (sans overhead sur PG, toujours indexable)

ALTER TABLE notification_log
  ALTER COLUMN order_ref  TYPE text,
  ALTER COLUMN parcel_ref TYPE text;
