#!/usr/bin/env node
/**
 * KOMERCE — Test complet des notifications WhatsApp
 * ═══════════════════════════════════════════════════════════════════════
 * Usage :
 *   node test-whatsapp-notifications.js <ton_numero>
 *
 * Ex :
 *   node test-whatsapp-notifications.js +33612345678
 *
 * À exécuter dans l'environnement Railway (ou local avec mêmes env vars).
 * ═══════════════════════════════════════════════════════════════════════
 */

const phone = process.argv[2];
if (!phone) {
  log.error('❌ Usage : node test-whatsapp-notifications.js <numero>');
  process.exit(1);
}

(async () => {
  log.info('\n🧪 KOMERCE — Test notifications WhatsApp');
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log.info(`📱 Numéro      : ${phone}`);
  log.info(`🔑 AUTHKEY_KEY : ${process.env.AUTHKEY_API_KEY ? '✅' : '❌ MANQUANT'}`);
  log.info(`🆔 WID_OTP     : ${process.env.WID_OTP || '❌ NON CONFIGURÉ (OTP ne marchera pas)'}`);
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const authkey = require('./services/authkey-client');
  const notifService = require('./services/notification-service');

  const tests = [
    {
      name: '1. Commande créée (WID 32183)',
      fn: () => authkey.notifyOrderCreated({
        mobile: phone, name: 'Test', orderRef: 'TEST-0001', amount: '15 000',
      }),
    },
    {
      name: '2. Paiement confirmé (WID 32182)',
      fn: () => authkey.notifyPaymentConfirmed({
        mobile: phone, name: 'Test', orderRef: 'TEST-0001',
      }),
    },
    {
      name: '3. Colis expédié (WID 32184)',
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
      name: '5. Commande annulée (WID 32186)',
      fn: () => authkey.notifyOrderCancelled({
        mobile: phone, name: 'Test', orderRef: 'TEST-0001',
      }),
    },
    {
      name: '6. Panier abandonné (WID 32187)',
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
    log.info(`\n▶ ${t.name}`);
    try {
      const r = await t.fn();
      // Signatures différentes selon les helpers
      const ok = r.ok || r.success;
      const msgId = r.messageId || (r.success ? 'via sendOtpMessage' : null);
      if (ok) {
        log.info(`  ✅ ENVOYÉ — messageId: ${msgId || 'n/a'}`);
        if (r.channel) log.info(`     channel: ${r.channel}`);
      } else {
        log.info(`  ❌ ÉCHEC — raison: ${r.error || r.reason}`);
        if (r.data) log.info(`     data: ${JSON.stringify(r.data).substring(0, 150)}`);
      }
    } catch (err) {
      log.info(`  💥 EXCEPTION : ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 2000)); // 2s entre chaque
  }

  log.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log.info('✅ Test terminé.');
  log.info('👉 Vérifie ton WhatsApp — tu devrais avoir reçu 8 messages.');
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  process.exit(0);
})().catch(err => {
  log.error('💥 Erreur fatale :', err);
  process.exit(1);
});
