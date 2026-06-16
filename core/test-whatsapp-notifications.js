#!/usr/bin/env node

/**
 * @komerce-arch
 * @role         whatsapp-notification-manual-test
 * @domain       notifications
 * @layer        manual-test
 * @criticality  medium
 * @purpose      Script manuel de test des notifications WhatsApp/AuthKey.
 * @inputs       CLI phone argument, env vars AUTHKEY_API_KEY, WID_OTP, WID_MAGIC_LINK
 * @outputs      WhatsApp test messages, stdout report
 * @depends      services/authkey-client, services/notification-service
 * @used-by      manual-ops
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     none
 * @impact-areas whatsapp, notifications, otp
 */
/**
 * KOMERCE â€” Test complet des notifications WhatsApp
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * Usage :
 *   node test-whatsapp-notifications.js <ton_numero>
 *
 * Ex :
 *   node test-whatsapp-notifications.js +33612345678
 *
 * Ã€ exÃ©cuter dans l'environnement Railway (ou local avec mÃªmes env vars).
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 */

const phone = process.argv[2];
if (!phone) {
  log.error('âŒ Usage : node test-whatsapp-notifications.js <numero>');
  process.exit(1);
}

(async () => {
  log.info('\nðŸ§ª KOMERCE â€” Test notifications WhatsApp');
  log.info('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  log.info(`ðŸ“± NumÃ©ro      : ${phone}`);
  log.info(`ðŸ”‘ AUTHKEY_KEY : ${process.env.AUTHKEY_API_KEY ? 'âœ…' : 'âŒ MANQUANT'}`);
  log.info(`ðŸ†” WID_OTP     : ${process.env.WID_OTP || 'âŒ NON CONFIGURÃ‰ (OTP ne marchera pas)'}`);
  log.info('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n');

  const authkey = require('./services/authkey-client');
  const notifService = require('./services/notification-service');

  const tests = [
    {
      name: '1. Commande crÃ©Ã©e (WID 32183)',
      fn: () => authkey.notifyOrderCreated({
        mobile: phone, name: 'Test', orderRef: 'TEST-0001', amount: '15 000',
      }),
    },
    {
      name: '2. Paiement confirmÃ© (WID 32182)',
      fn: () => authkey.notifyPaymentConfirmed({
        mobile: phone, name: 'Test', orderRef: 'TEST-0001',
      }),
    },
    {
      name: '3. Colis expÃ©diÃ© (WID 32184)',
      fn: () => authkey.notifyOrderShipped({
        mobile: phone, name: 'Test', orderRef: 'TEST-0001', relayPoint: 'Relais Moroni',
      }),
    },
    {
      name: '4. Colis disponible (WID 32185)',
      fn: () => authkey.notifyOrderDelivered({
        mobile: phone, name: 'Test', orderRef: 'TEST-0001',
      }),
    },
    {
      name: '5. Commande annulÃ©e (WID 32186)',
      fn: () => authkey.notifyOrderCancelled({
        mobile: phone, name: 'Test', orderRef: 'TEST-0001',
      }),
    },
    {
      name: '6. Panier abandonnÃ© (WID 32187)',
      fn: () => authkey.notifyAbandonedCart({
        mobile: phone, name: 'Test', itemCount: 3,
      }),
    },
    {
      name: '7. OTP via sendOtpMessage (WID_OTP)',
      fn: () => notifService.sendOtpMessage({
        phone, code: '123456', name: 'Test', expiryMin: 10,
      }),
      expect: 'whatsapp',
    },
    {
      name: '8. Magic link via sendMagicLink (WID_MAGIC_LINK)',
      fn: () => notifService.sendMagicLink({
        phone,
        name: 'Test',
        magicLink: 'https://komerce.example.com/mon-compte?token=test_token_abc123',
        expiryMin: 15,
      }),
      expect: 'whatsapp',
    },
  ];

  for (const t of tests) {
    log.info(`\nâ–¶ ${t.name}`);
    try {
      const r = await t.fn();
      // Signatures diffÃ©rentes selon les helpers
      const ok = r.ok || r.success;
      const msgId = r.messageId || (r.success ? 'via sendOtpMessage' : null);
      if (ok) {
        log.info(`  âœ… ENVOYÃ‰ â€” messageId: ${msgId || 'n/a'}`);
        if (r.channel) log.info(`     channel: ${r.channel}`);
      } else {
        log.info(`  âŒ Ã‰CHEC â€” raison: ${r.error || r.reason}`);
        if (r.data) log.info(`     data: ${JSON.stringify(r.data).substring(0, 150)}`);
      }
    } catch (err) {
      log.info(`  ðŸ’¥ EXCEPTION : ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 2000)); // 2s entre chaque
  }

  log.info('\nâ”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  log.info('âœ… Test terminÃ©.');
  log.info('ðŸ‘‰ VÃ©rifie ton WhatsApp â€” tu devrais avoir reÃ§u 8 messages.');
  log.info('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n');

  process.exit(0);
})().catch(err => {
  log.error('ðŸ’¥ Erreur fatale :', err);
  process.exit(1);
});
