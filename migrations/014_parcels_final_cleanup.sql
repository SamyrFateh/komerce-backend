-- Migration 014: Parcels final cleanup — remove legacy columns, add indexes
-- Add indexes for common parcel queries
CREATE INDEX IF NOT EXISTS idx_parcels_order_id ON parcels(order_id);
CREATE INDEX IF NOT EXISTS idx_parcels_status ON parcels(status);
CREATE INDEX IF NOT EXISTS idx_parcels_shipment_id ON parcels(shipment_id);
CREATE INDEX IF NOT EXISTS idx_parcels_reference ON parcels(reference);
CREATE INDEX IF NOT EXISTS idx_parcel_items_parcel_id ON parcel_items(parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcel_items_order_item_id ON parcel_items(order_item_id);
-- Cleanup: remove legacy sub_orders references if they exist
DROP TABLE IF EXISTS sub_order_items CASCADE;
DROP TABLE IF EXISTS sub_orders CASCADE;
