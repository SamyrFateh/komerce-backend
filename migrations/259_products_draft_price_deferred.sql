-- @migration 259_products_draft_price_deferred.sql
-- @domain    catalog
-- @purpose   Le passage Sourcing -> Catalogue crée un brouillon canonique non
--            publié. Le prix de vente n'est pas une donnée de Sourcing :
--            il devient obligatoire au gate de publication/exposition, après
--            décision du moteur économique / marché.
--
--            Aucun faux prix (1 KMF, test_price, recommended_price, etc.) ne
--            doit être écrit pour satisfaire le schéma.
--
--            Doctrine :
--              * brouillon : lifecycle_status='candidate', is_active=false,
--                is_available=false, price_kmf peut être NULL ;
--              * publié/disponible/actif : price_kmf doit être > 0.
--
--            chk_products_price (price_kmf > 0) est conservé : PostgreSQL
--            autorise NULL dans un CHECK ; la contrainte ci-dessous borne NULL
--            au seul état brouillon non publié.

BEGIN;

ALTER TABLE public.products
  ALTER COLUMN price_kmf DROP NOT NULL;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS chk_products_unpriced_draft_only;

ALTER TABLE public.products
  ADD CONSTRAINT chk_products_unpriced_draft_only
  CHECK (
    price_kmf IS NOT NULL
    OR (
      COALESCE(is_active, FALSE) = FALSE
      AND COALESCE(is_available, FALSE) = FALSE
      AND COALESCE(lifecycle_status, 'candidate') <> 'active'
    )
  );

COMMENT ON COLUMN public.products.price_kmf IS
  'Prix de vente KMF. Nullable uniquement pour un brouillon Catalogue inactif/non disponible ; obligatoire avant publication/exposition.';

COMMIT;
