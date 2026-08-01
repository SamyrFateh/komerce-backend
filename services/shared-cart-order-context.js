/**
 * @komerce-arch
 * feature: shared-cart
 * role: shared list order linkage and pickup-recipient policy
 * owns:
 *   - validation of shared-cart order context
 *   - initial pickup-code recipient resolution for shared-cart orders
 * does_not_own:
 *   - payment processing
 *   - order creation
 *   - pickup secret generation
 *   - WhatsApp delivery
 *   - logistics state transitions
 */
'use strict';

class SharedCartOrderContextError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SharedCartOrderContextError';
    this.code = code;
  }
}

function normalizeVerifiedWhatsapp(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Build the minimal immutable context stored on an order created from a shared list.
 * This context is linkage only: it never represents a collective payment or a
 * future global order.
 */
function buildSharedCartOrderContext({ sharedCartId, sharedCartItemId, organizerUserId }) {
  if (!sharedCartId) {
    throw new SharedCartOrderContextError(
      'SHARED_CART_ID_REQUIRED',
      'sharedCartId is required for a shared-cart order'
    );
  }

  if (!sharedCartItemId) {
    throw new SharedCartOrderContextError(
      'SHARED_CART_ITEM_ID_REQUIRED',
      'sharedCartItemId is required for a shared-cart order'
    );
  }

  if (!organizerUserId) {
    throw new SharedCartOrderContextError(
      'ORGANIZER_USER_ID_REQUIRED',
      'organizerUserId is required for a shared-cart order'
    );
  }

  return Object.freeze({
    sharedCartId,
    sharedCartItemId,
    organizerUserId,
  });
}

/**
 * Resolve the initial recipient of a pickup code.
 *
 * Ordinary order: verified buyer WhatsApp.
 * Shared-cart order: verified organizer WhatsApp.
 *
 * The function deliberately does not fall back silently from organizer to buyer:
 * an unresolved organizer contact must become an operational exception rather
 * than leaking the code to an unintended recipient.
 */
function resolveInitialPickupCodeRecipient({
  sharedCartId = null,
  buyerVerifiedWhatsapp = null,
  organizerVerifiedWhatsapp = null,
}) {
  if (sharedCartId) {
    const organizer = normalizeVerifiedWhatsapp(organizerVerifiedWhatsapp);
    if (!organizer) {
      throw new SharedCartOrderContextError(
        'SHARED_CART_ORGANIZER_WHATSAPP_REQUIRED',
        'A verified organizer WhatsApp is required before sending a shared-cart pickup code'
      );
    }

    return Object.freeze({
      role: 'shared_cart_organizer',
      whatsapp: organizer,
    });
  }

  const buyer = normalizeVerifiedWhatsapp(buyerVerifiedWhatsapp);
  if (!buyer) {
    throw new SharedCartOrderContextError(
      'BUYER_WHATSAPP_REQUIRED',
      'A verified buyer WhatsApp is required before sending a pickup code'
    );
  }

  return Object.freeze({
    role: 'buyer',
    whatsapp: buyer,
  });
}

function isSharedCartOrder(order) {
  return Boolean(order && order.shared_cart_id);
}

module.exports = {
  SharedCartOrderContextError,
  buildSharedCartOrderContext,
  resolveInitialPickupCodeRecipient,
  isSharedCartOrder,
};
