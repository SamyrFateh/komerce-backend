/**
 * KOMERCE — Store Credits v1.0 (Point 6 Phase 3)
 *
 * Gestion des crédits boutique :
 *   - Création de crédits (remboursement cash, compensation, manuel)
 *   - Consultation du solde disponible
 *   - Application FIFO sur commande suivante
 *
 * Tables : store_credits (migration 007)
 */

'use strict';

/**
 * Crée un crédit boutique pour un utilisateur.
 * Doit être appelé dans une transaction existante.
 *
 * @param {Object} client  - DB transaction client
 * @param {Object} params
 * @param {string} params.userId        - UUID utilisateur
 * @param {number} params.amountKmf     - Montant en KMF
 * @param {string} params.reason        - 'cancellation_refund' | 'compensation' | 'manual'
 * @param {string} [params.sourceOrderId] - UUID commande source (optionnel)
 * @param {Date}   [params.expiresAt]     - Date d'expiration (optionnel)
 * @returns {Object} crédit créé
 */
async function createStoreCredit(client, { userId, amountKmf, reason, sourceOrderId, expiresAt }) {
  const { rows: [credit] } = await client.query(
    `INSERT INTO store_credits (user_id, amount_kmf, remaining_kmf, reason, source_order_id, expires_at)
     VALUES ($1, $2, $2, $3, $4, $5)
     RETURNING *`,
    [userId, amountKmf, reason, sourceOrderId || null, expiresAt || null]
  );
  return credit;
}

/**
 * Récupère le total des crédits disponibles pour un utilisateur.
 * Exclut les crédits épuisés et expirés.
 *
 * @param {Object} dbOrClient - DB pool ou transaction client
 * @param {string} userId     - UUID utilisateur
 * @returns {{ credits: Object[], total_kmf: number }}
 */
async function getAvailableCredits(dbOrClient, userId) {
  const { rows } = await dbOrClient.query(
    `SELECT id, amount_kmf, remaining_kmf, reason, source_order_id, created_at, expires_at
     FROM store_credits
     WHERE user_id = $1
       AND remaining_kmf > 0
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at ASC`,
    [userId]
  );
  const total_kmf = rows.reduce((sum, c) => sum + c.remaining_kmf, 0);
  return { credits: rows, total_kmf };
}

/**
 * Applique des crédits à une commande (FIFO — plus anciens d'abord).
 * Doit être appelé dans une transaction existante.
 *
 * @param {Object} client    - DB transaction client
 * @param {string} userId    - UUID utilisateur
 * @param {number} amountKmf - Montant à déduire
 * @returns {{ applied_kmf: number, credits_used: Array<{id: string, amount_used: number}> }}
 */
async function applyCredits(client, userId, amountKmf) {
  if (amountKmf <= 0) return { applied_kmf: 0, credits_used: [] };

  const { credits, total_kmf } = await getAvailableCredits(client, userId);
  if (total_kmf === 0) return { applied_kmf: 0, credits_used: [] };

  let remaining = Math.min(amountKmf, total_kmf);
  const creditsUsed = [];

  for (const credit of credits) {
    if (remaining <= 0) break;
    const useAmount = Math.min(remaining, credit.remaining_kmf);

    await client.query(
      'UPDATE store_credits SET remaining_kmf = remaining_kmf - $1 WHERE id = $2',
      [useAmount, credit.id]
    );

    creditsUsed.push({ id: credit.id, amount_used: useAmount });
    remaining -= useAmount;
  }

  return {
    applied_kmf: Math.min(amountKmf, total_kmf),
    credits_used: creditsUsed,
  };
}

module.exports = { createStoreCredit, getAvailableCredits, applyCredits };
