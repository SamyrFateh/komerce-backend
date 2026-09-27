-- @migration 246_market_delegation_market_config_update_central_held.sql
-- @domain    market-delegation
-- @purpose   Close P0b Gap 2: market_config.update has no delegable field left
--            after schema audit (135_markets_foundation.sql). code/currency/
--            minor_unit are central-reserved; is_active carries the same
--            authority as market.create and must stay central. Flip from
--            DELEGABLE/MISSING (implies a build backlog) to CENTRAL_ONLY/
--            CENTRAL_HELD (documents a deliberate, permanent non-delegation).

UPDATE capability_registry
   SET delegation_mode = 'CENTRAL_ONLY',
       status = 'CENTRAL_HELD',
       updated_at = NOW()
 WHERE capability = 'market_config.update';

COMMENT ON TABLE capability_registry IS
  'Executable market-delegation registry. Only class DELEGATION belongs to the autonomy KPI denominator. market_config.update: CENTRAL_HELD by design, no local field to delegate (see migration 246).';
