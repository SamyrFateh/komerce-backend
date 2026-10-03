-- 271_operator_market_scopes_projection_required.sql
-- B2 / M1 — operator_market_scopes devient une projection de compatibilité stricte.
--
-- NOT VALID préserve les lignes legacy historiques déjà présentes. PostgreSQL
-- applique néanmoins le CHECK à toute nouvelle ligne ou ligne modifiée :
-- une ligne active doit donc être reliée à assignment_memberships ; une ligne
-- legacy sans projection ne peut survivre qu'une fois révoquée.

ALTER TABLE operator_market_scopes
  ADD CONSTRAINT operator_market_scopes_projection_or_revoked_chk
  CHECK (projected_from_membership_id IS NOT NULL OR revoked_at IS NOT NULL)
  NOT VALID;
