-- @migration 310_market_open_djibouti_provisioning.sql
-- @domain    market
-- @purpose   Lot 8 (stabilisation multi-pays) — Djibouti (DJ / DJF) créé UNIQUEMENT en PROVISIONING.
--            Même doctrine que 139–141 : ouvrir un marché est un INSERT, pas un ALTER, aucune branche par pays.
--
--            Ce que cette migration NE FAIT PAS (par construction) :
--              - aucune activation : lifecycle_status = PROVISIONING, is_active = false (le checkout répond
--                MARKET_NOT_ACTIVE) ; l'ouverture passe par la readiness centrale (équipe, plafonds, moyens
--                de paiement, politique cash, relais, attestation de livrabilité) ;
--              - aucune attestation de livrabilité, aucun transporteur, aucun tarif, aucun moyen d'encaissement
--                central (market_central_collection_modes), aucun relais, aucune équipe ;
--              - AUCUNE parité DJF dans currency_parities : le franc de Djibouti est rattaché au dollar US
--                (peg USD), pas à l'euro ; une parité vers EUR serait un taux flottant, interdit dans cette
--                table (freeze Currency Boundary, invariants 4/5/9 de la migration 142). Le gap générique
--                NO_CURRENCY_PARITY de la readiness bloque l'ouverture tant que le propriétaire n'a pas décidé
--                de la politique de change DJF/EUR.
--
--            DJF : minor_unit = 0 (pas de sous-unité en circulation).
--            Idempotent ; rollback : DELETE FROM markets WHERE code = 'DJ' (tant qu'aucune donnée n'y est rattachée).

INSERT INTO markets (code, name, currency, minor_unit, is_active, lifecycle_status)
VALUES ('DJ', 'Djibouti', 'DJF', 0, false, 'PROVISIONING')
ON CONFLICT (code) DO NOTHING;
