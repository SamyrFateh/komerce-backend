-- LOT 4E — business reference for catalog-owned supplier import batches.
-- Feature owner: catalog.

CREATE SEQUENCE IF NOT EXISTS catalog_import_ref_seq START 1;

ALTER TABLE supplier_catalog_imports
  ADD COLUMN IF NOT EXISTS import_ref TEXT;

UPDATE supplier_catalog_imports
   SET import_ref = 'KSI-' || LPAD(nextval('catalog_import_ref_seq')::text, 6, '0')
 WHERE import_ref IS NULL;

ALTER TABLE supplier_catalog_imports
  ALTER COLUMN import_ref SET DEFAULT ('KSI-' || LPAD(nextval('catalog_import_ref_seq')::text, 6, '0')),
  ALTER COLUMN import_ref SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_catalog_imports_import_ref
  ON supplier_catalog_imports(import_ref);
