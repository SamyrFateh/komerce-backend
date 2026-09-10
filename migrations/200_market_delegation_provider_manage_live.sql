-- @migration 200_market_delegation_provider_manage_live.sql
-- @domain    market-delegation
-- @purpose   provider.manage passe MISSING -> LIVE. Aucune migration de
--            schéma requise : la table providers (providers-services) porte
--            déjà market_id, status (pending|active|suspended) et ses
--            contraintes de non-blanc — le manque était l'orchestration
--            (capability check + audit), pas la donnée.

UPDATE capability_registry
   SET status = 'LIVE', updated_at = NOW()
 WHERE capability IN ('provider.manage');
