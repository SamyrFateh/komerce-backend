-- ============================================================================
-- KOMERCE — Migration: Ajout du statut 'pending' à order_status
-- ============================================================================
-- 
-- CONTEXTE:
--   Le flux business est cash-driven. Il manquait un statut pour représenter
--   "commande créée, en attente de paiement" AVANT 'confirmed'.
--
-- AVANT (bugué):
--   Création → 'confirmed' → Webhook Stripe → 'ordered' (saute une étape)
--
-- APRÈS (corrigé):
--   Création → 'pending' → Paiement OK → 'confirmed' → 'ordered'
--
-- ROLLBACK:
--   Les ENUMs PostgreSQL ne supportent pas DROP VALUE.
--   Pour rollback, il faudrait recréer l'ENUM (migration complexe).
--   Tester en staging avant prod !
-- ============================================================================

-- 1. Ajouter 'pending' à l'ENUM order_status (AVANT 'confirmed')
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'pending' BEFORE 'confirmed';

-- 2. Ajouter timestamp pour le nouveau statut (optionnel mais cohérent)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pending_at TIMESTAMPTZ;

-- 3. Backfill : les commandes 'confirmed' avec payment_status='pending' 
--    sont en réalité des commandes 'pending' (pas encore payées)
-- 
-- ⚠️  ATTENTION: Exécuter cette partie APRÈS déploiement du nouveau code
--     sinon les commandes vont changer de statut mais le code ne sera pas prêt
--
-- UPDATE orders 
-- SET status = 'pending', pending_at = created_at
-- WHERE status = 'confirmed' 
--   AND payment_status = 'pending';

-- 4. Vérification
SELECT enumlabel 
FROM pg_enum e 
JOIN pg_type t ON t.oid = e.enumtypid 
WHERE t.typname = 'order_status'
ORDER BY e.enumsortorder;
