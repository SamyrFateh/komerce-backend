-- Migration 068 — Contrainte CHECK balance_kmf >= 0 sur wallets
-- R3 : filet de sécurité DB contre soldes négatifs (le guard applicatif
--       existe déjà dans wallet-service.js, mais une requête SQL directe
--       ou un bug pourrait contourner la couche applicative).
--
-- SAFE : NOT VALID valide uniquement les nouvelles lignes sans verrou full-table.
-- Après validation manuelle des données (vérifier qu'aucun wallet n'a
-- balance_kmf < 0), exécuter :
--   ALTER TABLE wallets VALIDATE CONSTRAINT chk_balance_non_negative;

ALTER TABLE wallets
  ADD CONSTRAINT chk_balance_non_negative
  CHECK (balance_kmf >= 0)
  NOT VALID;
