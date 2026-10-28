'use strict';
/**
 * V2.3 adversarial NEGATIVE CONTROL ONLY. This is intentionally NOT a fix.
 *
 * A superficial pre-PSP check of a completed refund is enough to pass the
 * sequential cancellation->PayPal test, but cannot reserve the refund right.
 * In the concurrent schedule both owners can pass the preflight check before
 * either publishes its financial outcome.
 *
 * Do not import into any production service/route. Used only by the
 * disposable-PostgreSQL V2.3 research child process.
 */
function preflightOnly(owner) {
  if (typeof owner !== 'function') throw Error('TOOL_ERROR: owner function required');
  return async function v23UnsafePreflight(input) {
    if (!input?.orderId || typeof input.db?.query !== 'function')
      throw Error('TOOL_ERROR: invalid refund probe input');
    const response = await input.db.query(
      "SELECT id FROM refunds WHERE order_id = $1 AND status = 'completed' LIMIT 1",
      [input.orderId]
    );
    if (!Array.isArray(response?.rows))
      throw Error('TOOL_ERROR: missing preflight evidence');
    if (response.rows.length)
      return {status:409,body:{code:'KBA_V23_PREFLIGHT_REJECT',
        error:'Refund completed (insufficient research mutant guard)'}};
    return owner(input);
  };
}
module.exports={preflightOnly};
