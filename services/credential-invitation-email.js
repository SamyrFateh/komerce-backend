/**
 * @komerce-arch
 * @role credential-invitation-delivery
 * @domain auth-identity
 * @layer service
 * @criticality high
 * @doctrine secret_never_logged_or_returned_from_public_routes
 */
'use strict';

const { PURPOSES } = require('./credential-link-token');

function credentialLink(token, purpose) {
  if (!PURPOSES.includes(purpose) || !/^[a-f0-9]{64}$/.test(token || '')) {
    throw new TypeError('Invalid credential invitation');
  }
  if (!process.env.APP_URL) throw new Error('APP_URL must be configured for credential emails');
  const base = new URL(process.env.APP_URL);
  if (base.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && base.hostname === 'localhost')) {
    throw new Error('Credential invitation origin must use HTTPS');
  }
  const pathname = purpose === 'account_activation' ? '/activate-account.html' : '/reset-password.html';
  const target = new URL(pathname, base);
  // Fragment is never sent to the web server as part of the HTTP request.
  target.hash = 'token=' + token;
  return target.toString();
}

async function sendCredentialLink({ email, token, purpose }) {
  const apiKey = process.env.BREVO_API_KEY;
  const sender = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !sender) return { sent: false, reason: 'email_not_configured' };
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { sent: false, reason: 'invalid_email' };
  }
  let link;
  try { link = credentialLink(token, purpose); }
  catch (_) { return { sent: false, reason: 'origin_not_configured' }; }
  const activation = purpose === 'account_activation';
  const subject = activation ? 'Activez votre accès Komerce' : 'Réinitialisation du mot de passe Komerce';
  const expiration = activation ? '24 heures' : '30 minutes';
  const htmlContent = [
    '<!doctype html><html><body><h2>Komerce</h2>',
    '<p>Une demande sécurisée concernant votre compte a été enregistrée.</p>',
    '<p><a href="' + link + '">', activation ? 'Activer mon compte' : 'Choisir un nouveau mot de passe', '</a></p>',
    '<p>Ce lien est valable ' + expiration + ' et ne peut être utilisé qu’une fois.</p>',
    '<p>Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.</p>',
    '</body></html>',
  ].join('');
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Komerce', email: sender },
        to: [{ email }],
        subject,
        htmlContent,
      }),
    });
    return { sent: response.ok, reason: response.ok ? null : 'provider_rejected' };
  } catch (_) {
    return { sent: false, reason: 'provider_unavailable' };
  }
}
module.exports = { credentialLink, sendCredentialLink };
