-- Migration 130 — catalogue public : isoler les fixtures de stress déjà publiées
--
-- Avant cette correction, POST /api/products héritait des DEFAULT TRUE de
-- products.is_active/is_available lorsque le caller omettait ces champs. Les
-- scénarios API pouvaient donc exposer des fiches nommées "title <uuid>" avec
-- une description "desc-<uuid>", ou des lignes explicitement marquées
-- "Raw test product". La création est désormais brouillon par défaut ; cette
-- migration désactive uniquement les résidus reconnaissables sans les effacer.

BEGIN;

UPDATE products
   SET is_active = FALSE,
       is_available = FALSE,
       updated_at = NOW()
 WHERE is_active = TRUE
   AND (
     (
       name ~* '^title[[:space:]_-]+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND COALESCE(description, '') ~* '^desc[[:space:]_-]+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     )
     OR COALESCE(description, '') ~* '^Raw test product:'
   );

COMMIT;
