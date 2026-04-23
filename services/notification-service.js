'use strict';

/**
 * KOMERCE — services/notification-service.js
 * ═══════════════════════════════════════════════════════════════════════
 * Orchestre toutes les notifications clients (WhatsApp via AuthKey, SMS fallback, email).
 *
 * Fonctions publiques (signatures préservées pour compatibilité) :
 *   - notifyOrderCreated(order, smsPhones, userEmail, emailItems, relais, cashSmsText)
 *   - notifyPaymentConfirmed(orderId, orderReference)
 *   - notifyStatusChange(order, newStatus)
 *   - notifyCancellation(order, smsRefundInfo)
 *
 * Toutes les notifications sont non-bloquantes et loggées en DB (notification_log).
 * ═══════════════════════════════════════════════════════════════════════
 */

const db = require('../db');
const {
  notifyOrderCreated: waOrderCreated,
  notifyPaymentConfirmed: waPaymentConfirmed,
  notifyOrderShipped: waOrderShipped,
  notifyOrderDelivered: waOrderDelivered,
  notifyOrderCancelled: waOrderCancelled,
  callAuthKey,
  WID,
} = require('./authkey-client');

// WID dédié OTP — à configurer dans Railway env : WID_OTP=xxxxx
// Si non configuré, l'OTP passera par un canal de fallback (SMS, etc. selon config)
const WID_OTP = process.env.WID_OTP || null;

// WID dédié magic link — template texte qui contient un lien cliquable
// À configurer dans Railway : WID_MAGIC_LINK=xxxxx
// Fallback : si non configuré, réutilise WID_OTP (moins idéal mais fonctionne)
const WID_MAGIC_LINK = process.env.WID_MAGIC_LINK || null;

// ─── Logger interne ────────────────────────────────────────────────────
async function logNotification({ orderRef, parcelRef, channel, event, recipient, status, detail }) {
  try {
    await db.query(
      `INSERT INTO notification_log
         (order_ref, parcel_ref, channel, event, recipient, status, detail, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [orderRef || null, parcelRef || null, channel, event, recipient || null,
       status, detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null]
    );
  } catch (err) {
    if (err.code === '42P01') {
      // Table pas encore créée — on ignore
      console.warn('[notification-service] table notification_log absente, log skipped');
    } else {
      console.error('[notification-service] log error', err.message);
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

function firstName(fullName) {
  if (!fullName) return 'Client';
  return String(fullName).trim().split(/\s+/)[0];
}

function formatAmount(kmf) {
  if (kmf == null) return '';
  return Number(kmf).toLocaleString('fr-FR').replace(/,/g, ' ');
}

function pickPhone(order, fallback) {
  // [LEGACY] Priorité : tracking_phone > recipient_phone > phone_payer > user_phone > fallback
  // Conservée pour rétro-compat. Les nouvelles fonctions utilisent pickRecipients().
  return order.tracking_phone
      || order.recipient_phone        // via JOIN users r ON r.id = o.recipient_id
      || order.phone_payer            // via JOIN users u ON u.id = o.user_id
      || order.user_phone
      || (Array.isArray(fallback) ? fallback[0] : fallback)
      || null;
}

/**
 * Retourne la liste des téléphones qui doivent recevoir la notif selon l'événement.
 * 
 * Stratégie Komerce (payeur diaspora ≠ bénéficiaire Comores) :
 *   - order_created    → payeur + bénéficiaire (si différents) : les deux doivent savoir
 *   - payment_confirmed → payeur uniquement : seul lui a besoin de rassurance débit
 *   - order_shipped    → payeur + bénéficiaire : les deux suivent la progression
 *   - order_delivered  → bénéficiaire uniquement : c'est lui qui vient chercher
 *   - order_cancelled  → payeur uniquement : remboursement le concerne
 *   - abandoned_cart   → payeur uniquement : remarketing
 * 
 * Dédoublonne automatiquement : si payeur === bénéficiaire (achat local), on envoie 1 seule fois.
 */
function pickRecipients(order, event) {
  // payeur : tracking_phone (prioritaire) > phone_payer (migration 040) > user_phone
  // bénéficiaire : recipient_phone (via JOIN users r) > phone_beneficiary > user_phone si pas de recipient distinct
  const payer = order.tracking_phone
             || order.phone_payer
             || order.user_phone
             || null;
  const benef = order.recipient_phone
             || order.phone_beneficiary
             || null;

  const result = [];
  const seen = new Set();
  const add = (phone, role) => {
    if (!phone) return;
    if (seen.has(phone)) return;
    seen.add(phone);
    result.push({ phone, role });
  };

  switch (event) {
    case 'order_created':
    case 'order_shipped':
      add(payer, 'payer');
      add(benef, 'beneficiary');
      break;

    case 'payment_confirmed':
    case 'order_cancelled':
    case 'abandoned_cart':
      add(payer, 'payer');
      // Si pas de payeur distinct (achat local), on utilise le bénéficiaire
      if (result.length === 0) add(benef, 'beneficiary');
      break;

    case 'order_delivered':
    case 'order_collected':
      add(benef, 'beneficiary');
      // Fallback : si pas de bénéficiaire, on notifie le payeur
      if (result.length === 0) add(payer, 'payer');
      break;

    default:
      // Fallback générique : l'un ou l'autre
      add(payer, 'payer');
      if (result.length === 0) add(benef, 'beneficiary');
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════
//  1. Commande créée
// ═══════════════════════════════════════════════════════════════════════
async function notifyOrderCreated(order, smsPhones, userEmail, emailItems, relais, cashSmsText) {
  const recipients = pickRecipients(order, 'order_created');
  const name = firstName(order.recipient_name || order.user_full_name);

  if (recipients.length === 0) {
    // Fallback array smsPhones si rien dans l'order
    const fb = Array.isArray(smsPhones) ? smsPhones[0] : smsPhones;
    if (fb) recipients.push({ phone: fb, role: 'fallback' });
  }

  if (recipients.length === 0) {
    console.warn('[notif][order-created] no phone', order.reference);
    await logNotification({
      orderRef: order.reference, channel: 'whatsapp', event: 'order_created',
      status: 'skipped', detail: 'no_phone'
    });
    return;
  }

  // Envoi à chaque destinataire (payeur + bénéficiaire si différents)
  for (const { phone, role } of recipients) {
    try {
      const result = await waOrderCreated({
        mobile: phone,
        name,
        orderRef: order.reference,
        amount: formatAmount(order.total_kmf),
      });

      await logNotification({
        orderRef: order.reference,
        channel: 'whatsapp',
        event: 'order_created',
        recipient: phone,
        status: result.ok ? 'sent' : 'failed',
        detail: result.ok
          ? { messageId: result.messageId, role }
          : { error: result.error, role },
      });
    } catch (err) {
      console.error(`[notif][order-created][${role}]`, err.message);
      await logNotification({
        orderRef: order.reference, channel: 'whatsapp', event: 'order_created',
        recipient: phone, status: 'failed', detail: { error: err.message, role },
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  2. Paiement confirmé
// ═══════════════════════════════════════════════════════════════════════
async function notifyPaymentConfirmed(orderId, orderReference) {
  try {
    // Récupère le contact depuis la DB car la signature n'a pas l'objet complet
    const { rows: [order] } = await db.query(
      `SELECT
         o.id, o.reference,
         o.tracking_phone,
         o.user_id, o.recipient_id,
         u.phone         AS user_phone,
         u.full_name     AS user_full_name,
         u.phone_payer,
         u.phone_beneficiary,
         r.phone         AS recipient_phone,
         r.full_name     AS recipient_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN users r ON r.id = o.recipient_id
       WHERE o.id = $1`,
      [orderId]
    );

    if (!order) {
      console.warn('[notif][payment-confirmed] order not found', orderId);
      return;
    }

    const phone = pickPhone(order);
    const name = firstName(order.recipient_name || order.user_full_name);

    if (!phone) {
      await logNotification({
        orderRef: orderReference, channel: 'whatsapp', event: 'payment_confirmed',
        status: 'skipped', detail: 'no_phone'
      });
      return;
    }

    const result = await waPaymentConfirmed({
      mobile: phone,
      name,
      orderRef: orderReference,
    });

    await logNotification({
      orderRef: orderReference,
      channel: 'whatsapp',
      event: 'payment_confirmed',
      recipient: phone,
      status: result.ok ? 'sent' : 'failed',
      detail: result.ok ? { messageId: result.messageId } : { error: result.error },
    });
  } catch (err) {
    console.error('[notif][payment-confirmed]', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  3. Changement de statut (shipped, delivered, collected...)
// ═══════════════════════════════════════════════════════════════════════
async function notifyStatusChange(order, newStatus) {
  // Map des statuts Komerce → fonction AuthKey
  const mapping = {
    shipped:   { fn: waOrderShipped,   event: 'order_shipped' },
    delivered: { fn: waOrderDelivered, event: 'order_delivered' },
    collected: { fn: waOrderDelivered, event: 'order_collected' }, // même template
  };

  const entry = mapping[newStatus];
  if (!entry) {
    // Pas de notif pour ce statut (paid, processing, etc.)
    return;
  }

  const recipients = pickRecipients(order, entry.event);
  const name = firstName(order.recipient_name || order.user_full_name);

  if (recipients.length === 0) {
    await logNotification({
      orderRef: order.reference, channel: 'whatsapp', event: entry.event,
      status: 'skipped', detail: 'no_phone'
    });
    return;
  }

  for (const { phone, role } of recipients) {
    try {
      const params = {
        mobile: phone,
        name,
        orderRef: order.reference,
      };

      // Pour 'shipped', ajouter le point relais
      if (newStatus === 'shipped') {
        params.relayPoint = order.relais_name || 'votre point relais';
      }

      const result = await entry.fn(params);

      await logNotification({
        orderRef: order.reference,
        channel: 'whatsapp',
        event: entry.event,
        recipient: phone,
        status: result.ok ? 'sent' : 'failed',
        detail: result.ok ? { messageId: result.messageId, role } : { error: result.error, role },
      });
    } catch (err) {
      console.error(`[notif][${entry.event}][${role}]`, err.message);
      await logNotification({
        orderRef: order.reference, channel: 'whatsapp', event: entry.event,
        recipient: phone, status: 'failed', detail: { error: err.message, role },
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  4. Annulation
// ═══════════════════════════════════════════════════════════════════════
async function notifyCancellation(order, smsRefundInfo) {
  const phone = pickPhone(order);
  const name = firstName(order.recipient_name || order.user_full_name);

  if (!phone) {
    await logNotification({
      orderRef: order.reference, channel: 'whatsapp', event: 'order_cancelled',
      status: 'skipped', detail: 'no_phone'
    });
    return;
  }

  try {
    const result = await waOrderCancelled({
      mobile: phone,
      name,
      orderRef: order.reference,
    });

    await logNotification({
      orderRef: order.reference,
      channel: 'whatsapp',
      event: 'order_cancelled',
      recipient: phone,
      status: result.ok ? 'sent' : 'failed',
      detail: result.ok ? { messageId: result.messageId, refund: smsRefundInfo } : { error: result.error },
    });
  } catch (err) {
    console.error('[notif][cancellation]', err.message);
    await logNotification({
      orderRef: order.reference, channel: 'whatsapp', event: 'order_cancelled',
      recipient: phone, status: 'failed', detail: err.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  5. Helper : charge l'order complet à partir d'un parcelId
//  ─────────────────────────────────────────────────────────────────────
//  Permet de réutiliser notifyStatusChange (qui attend un order complet)
//  depuis les appelants qui n'ont qu'un parcelId (scan-engine, parcel-api,
//  transitaire-api) — sans dupliquer la logique payeur/bénéficiaire.
// ═══════════════════════════════════════════════════════════════════════
async function _loadOrderFromParcel(parcelId) {
  try {
    const { rows } = await db.query(
      `SELECT
         o.id,
         o.reference,
         o.tracking_phone,
         o.user_id, o.recipient_id,
         u.phone       AS user_phone,
         u.full_name   AS user_full_name,
         u.phone_payer,
         u.phone_beneficiary,
         r.phone       AS recipient_phone,
         r.full_name   AS recipient_name,
         o.total_kmf,
         rel.name      AS relais_name,
         p.reference AS parcel_reference
       FROM parcels p
       LEFT JOIN orders o   ON o.id = p.order_id
       LEFT JOIN users u    ON u.id = o.user_id
       LEFT JOIN users r    ON r.id = o.recipient_id
       LEFT JOIN relais rel ON rel.id = o.relais_id
       WHERE p.id = $1
       LIMIT 1`,
      [parcelId]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('[notif][load-order-from-parcel]', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  6. Notification de scan colis — façade vers notifyStatusChange
//  ─────────────────────────────────────────────────────────────────────
//  Appelée par scan-engine.js, parcel-api-v2.js, transitaire-api.js
//  quand un colis change de statut.
//
//  Signature : notifyParcelScan(parcelId, parcelReference, parcelStatus)
//    parcelId        — ID UUID du colis
//    parcelReference — Référence humaine (ex: "CLK-2026-0123")
//    parcelStatus    — 'in_transit' | 'shipped' | 'available'
//
//  Mapping parcel status → order status (pour réutiliser notifyStatusChange) :
//    in_transit / shipped → 'shipped'    (colis en route vers relais)
//    available            → 'delivered'  (colis prêt au relais à récupérer)
//
//  Délègue à notifyStatusChange qui gère payeur + bénéficiaire via pickRecipients.
// ═══════════════════════════════════════════════════════════════════════
async function notifyParcelScan(parcelId, parcelReference, parcelStatus) {
  if (!parcelId || !parcelStatus) {
    console.warn('[notif][parcel-scan] missing params', { parcelId, parcelStatus });
    return;
  }

  // Map parcel → order status
  const statusMap = {
    in_transit: 'shipped',
    shipped:    'shipped',
    available:  'delivered',
  };

  const orderStatus = statusMap[parcelStatus];
  if (!orderStatus) {
    console.warn('[notif][parcel-scan] unmapped status', parcelStatus);
    return;
  }

  // Charger l'order complet pour avoir les téléphones payeur + bénéficiaire
  const order = await _loadOrderFromParcel(parcelId);
  if (!order) {
    console.warn('[notif][parcel-scan] order not found for parcel', parcelReference);
    await logNotification({
      parcelRef: parcelReference,
      channel: 'whatsapp',
      event: `parcel_${parcelStatus}`,
      status: 'skipped',
      detail: { reason: 'order_not_found', parcelId },
    });
    return;
  }

  console.log('[notif][parcel-scan] ▶', {
    parcelRef: parcelReference,
    orderRef: order.reference,
    parcelStatus,
    orderStatus,
  });

  // Délègue : notifyStatusChange gère déjà payeur/bénéficiaire + log DB
  return notifyStatusChange(order, orderStatus);
}

// ═══════════════════════════════════════════════════════════════════════
//  7. Envoi OTP via WhatsApp (fallback SMS si échec)
//  ─────────────────────────────────────────────────────────────────────
//  Utilisée par routes/otp.js pour envoyer un code à 6 chiffres.
//
//  Signature : sendOtpMessage({ phone, code, name, expiryMin })
//    → Promise<{ success, channel, messageId?, reason?, error? }>
//
//  channel = 'whatsapp' | 'sms' | 'none'
//  Cette fonction ne lance JAMAIS d'exception — elle retourne toujours
//  un objet avec success:false en cas de problème pour ne pas casser le flow.
// ═══════════════════════════════════════════════════════════════════════
async function sendOtpMessage({ phone, code, name, expiryMin }) {
  if (!phone || !code) {
    return { success: false, channel: 'none', reason: 'missing_params' };
  }

  const customerName = firstName(name);

  // ── 1. Tentative WhatsApp via AuthKey (template dédié OTP si dispo) ──
  if (WID_OTP) {
    try {
      const result = await callAuthKey({
        wid: WID_OTP,
        mobile: phone,
        variables: {
          name: customerName,
          code,
          otp: code,
          expiry: String(expiryMin || 10),
        },
      });

      await logNotification({
        channel: 'whatsapp',
        event: 'otp_sent',
        recipient: phone,
        status: result.ok ? 'sent' : 'failed',
        detail: result.ok
          ? { messageId: result.messageId, via: 'template_otp' }
          : { error: result.error },
      });

      if (result.ok) {
        return {
          success: true,
          channel: 'whatsapp',
          messageId: result.messageId,
        };
      }

      console.warn('[wa-otp] template OTP failed, no fallback configured:', result.error);
      return {
        success: false,
        channel: 'whatsapp',
        error: result.error,
        reason: 'authkey_rejected',
      };
    } catch (err) {
      console.error('[wa-otp] exception:', err.message);
      await logNotification({
        channel: 'whatsapp',
        event: 'otp_sent',
        recipient: phone,
        status: 'failed',
        detail: { error: err.message, via: 'template_otp' },
      });
      return {
        success: false,
        channel: 'whatsapp',
        error: err.message,
        reason: 'exception',
      };
    }
  }

  // ── 2. Pas de WID_OTP configuré → on log et on return l'erreur ──
  //    (fallback SMS à implémenter ici si besoin via un autre provider)
  console.warn('[wa-otp] WID_OTP not configured in env — cannot send OTP');
  await logNotification({
    channel: 'whatsapp',
    event: 'otp_sent',
    recipient: phone,
    status: 'skipped',
    detail: { reason: 'no_wid_otp' },
  });

  return {
    success: false,
    channel: 'none',
    reason: 'no_wid_otp',
    error: 'WID_OTP env var not configured — impossible d\'envoyer l\'OTP',
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  8. Notification colis créé (commande passée en préparation)
//  ─────────────────────────────────────────────────────────────────────
//  Appelée par order-api-v2.js quand un colis est créé pour une commande.
//  Envoie une notification "📦 Votre commande a été préparée".
//
//  Signature : notifyParcelCreated(parcelRef, orderId, orderReference)
//
//  Implémentation : réutilise notifyStatusChange avec statut 'preparation'
//  → si aucun template n'est mappé à 'preparation' dans notifyStatusChange,
//    l'appel est un no-op silencieux (comportement déjà géré).
//  Log quand même l'événement pour audit.
// ═══════════════════════════════════════════════════════════════════════
async function notifyParcelCreated(parcelRef, orderId, orderReference) {
  if (!orderId) {
    console.warn('[notif][parcel-created] missing orderId');
    return;
  }

  try {
    // Charge l'order complet pour bénéficier de pickRecipients
    const { rows: [order] } = await db.query(
      `SELECT
         o.id, o.reference, o.tracking_phone,
         o.user_id, o.recipient_id,
         u.phone       AS user_phone,
         u.full_name   AS user_full_name,
         u.phone_payer,
         u.phone_beneficiary,
         r.phone       AS recipient_phone,
         r.full_name   AS recipient_name,
         o.total_kmf,
         rel.name      AS relais_name
       FROM orders o
       LEFT JOIN users u    ON u.id = o.user_id
       LEFT JOIN users r    ON r.id = o.recipient_id
       LEFT JOIN relais rel ON rel.id = o.relais_id
       WHERE o.id = $1`,
      [orderId]
    );

    if (!order) {
      console.warn('[notif][parcel-created] order not found', orderId);
      await logNotification({
        orderRef: orderReference,
        parcelRef,
        channel: 'whatsapp',
        event: 'parcel_created',
        status: 'skipped',
        detail: { reason: 'order_not_found' },
      });
      return;
    }

    console.log('[notif][parcel-created] ▶', {
      parcelRef, orderRef: order.reference,
    });

    // Délègue à notifyStatusChange avec 'preparation'.
    // Si aucun template ne correspond dans notifyStatusChange.mapping,
    // on log juste un 'skipped' mais on ne crash pas.
    await logNotification({
      orderRef: order.reference,
      parcelRef,
      channel: 'whatsapp',
      event: 'parcel_created',
      status: 'logged',
      detail: { info: 'colis cree, statut commande passe en preparation' },
    });

    // Optionnel : si tu veux vraiment envoyer une notif WhatsApp ici,
    // il faut créer un template dédié 'parcel_created' et l'ajouter au mapping
    // dans notifyStatusChange. Pour l'instant on se contente de logger.

    return { success: true, logged_only: true };
  } catch (err) {
    console.error('[notif][parcel-created]', err.message);
    await logNotification({
      orderRef: orderReference, parcelRef,
      channel: 'whatsapp', event: 'parcel_created',
      status: 'failed', detail: { error: err.message },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  9. Envoi magic link via WhatsApp (reconnexion 1-clic)
//  ─────────────────────────────────────────────────────────────────────
//  Utilisée par routes/client-auth.js quand un user veut revenir sur
//  son espace "Mes commandes" après expiration du JWT.
//
//  Signature : sendMagicLink({ phone, name, magicLink, expiryMin })
//    phone      — numéro E.164 du user
//    name       — nom d'affichage (pour personnalisation)
//    magicLink  — URL complète "https://komerce.xyz/mon-compte?token=xxx"
//    expiryMin  — durée de validité (défaut 15 minutes)
//
//  → Promise<{ success, channel, messageId?, reason?, error? }>
//
//  Stratégie de fallback :
//    1. Template WID_MAGIC_LINK si configuré (recommandé Meta)
//    2. Sinon, tente WID_OTP en réutilisant la variable (moins propre)
//    3. Sinon, retourne success:false avec reason explicite (pas de crash)
// ═══════════════════════════════════════════════════════════════════════
async function sendMagicLink({ phone, name, magicLink, expiryMin }) {
  if (!phone || !magicLink) {
    return { success: false, channel: 'none', reason: 'missing_params' };
  }

  const customerName = firstName(name);
  const expiry = String(expiryMin || 15);

  // Choisir le WID : magic link dédié > OTP (fallback) > rien
  const wid = WID_MAGIC_LINK || WID_OTP;

  if (!wid) {
    console.warn('[wa-magic-link] Aucun template WID_MAGIC_LINK ni WID_OTP configuré');
    await logNotification({
      channel: 'whatsapp',
      event: 'magic_link_sent',
      recipient: phone,
      status: 'skipped',
      detail: { reason: 'no_template_configured' },
    });
    return {
      success: false,
      channel: 'none',
      reason: 'no_template_configured',
      error: 'Aucun template WhatsApp configuré pour le magic link',
    };
  }

  try {
    const result = await callAuthKey({
      wid,
      mobile: phone,
      variables: {
        name: customerName,
        link: magicLink,
        magic_link: magicLink,
        url: magicLink,
        expiry,
      },
    });

    await logNotification({
      channel: 'whatsapp',
      event: 'magic_link_sent',
      recipient: phone,
      status: result.ok ? 'sent' : 'failed',
      detail: result.ok
        ? { messageId: result.messageId, wid, via: WID_MAGIC_LINK ? 'dedicated' : 'fallback_otp' }
        : { error: result.error, wid },
    });

    if (result.ok) {
      console.log(`[wa-magic-link] ✅ → ${phone} (messageId: ${result.messageId})`);
      return {
        success: true,
        channel: 'whatsapp',
        messageId: result.messageId,
      };
    }

    console.warn(`[wa-magic-link] ❌ ${phone}: ${result.error}`);
    return {
      success: false,
      channel: 'whatsapp',
      error: result.error,
      reason: 'authkey_rejected',
    };
  } catch (err) {
    console.error('[wa-magic-link] exception:', err.message);
    await logNotification({
      channel: 'whatsapp',
      event: 'magic_link_sent',
      recipient: phone,
      status: 'failed',
      detail: { error: err.message },
    });
    return {
      success: false,
      channel: 'whatsapp',
      error: err.message,
      reason: 'exception',
    };
  }
}

// ─── Notification fidélité — cadeau éligible ───────────────────────────────────
/**
 * Notifie un client qu'il est éligible au cadeau de fidélité.
 * Appelé par loyalty-service.js quand le seuil de gros paniers est atteint.
 *
 * @param {object} opts - { userId, userName, phone, orderRef, basketCount }
 */
async function notifyLoyaltyEarned({ userId, userName, phone, orderRef, basketCount }) {
  if (!phone) {
    console.warn('[loyalty-notif] Pas de téléphone pour user', userId);
    return { success: false, reason: 'no_phone' };
  }

  const name = firstName(userName);
  const message = `🎉 Bravo ${name} ! Vous avez atteint ${basketCount} gros paniers chez Komerce ! Un cadeau de fidélité vous attend. Notre équipe vous contactera bientôt. Merci de votre confiance ! 🇰🇲`;

  try {
    // Utiliser le WID générique (pas de template dédié pour l'instant)
    const result = await callAuthKey({
      wid: WID,
      phone,
      text: message,
    });

    await logNotification({
      orderRef,
      channel: 'whatsapp',
      event: 'loyalty_earned',
      recipient: phone,
      status: result.ok ? 'sent' : 'failed',
      detail: { basketCount, userId },
    });

    if (result.ok) {
      console.log(`[loyalty-notif] ✅ → ${phone} (${basketCount} paniers)`);
    } else {
      console.warn(`[loyalty-notif] ❌ ${phone}: ${result.error}`);
    }

    return { success: result.ok };
  } catch (err) {
    console.error('[loyalty-notif] exception:', err.message);
    await logNotification({
      channel: 'whatsapp',
      event: 'loyalty_earned',
      recipient: phone,
      status: 'failed',
      detail: { error: err.message, basketCount, userId },
    });
    return { success: false, error: err.message };
  }
}

module.exports = {
  // Fonctions historiques (flux commande)
  notifyOrderCreated,
  notifyPaymentConfirmed,
  notifyStatusChange,
  notifyCancellation,

  // Nouvelles fonctions (flux colis + OTP)
  notifyParcelCreated,
  notifyParcelScan,
  sendOtpMessage,
  sendMagicLink,

  // Fidélité
  notifyLoyaltyEarned,

  // Helper interne exposé pour tests
  _loadOrderFromParcel,
};
