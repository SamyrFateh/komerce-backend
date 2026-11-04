/**
 * @komerce-arch
 * @role          staff-password-recovery-ui
 * @domain        auth-identity
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        credential_token_or_verified_account_context
 * @outputs       verified_token_or_authorized_result
 * @depends       auth-identity
 * @used-by       V1 account activation and password recovery
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      credential_secret_never_persisted_in_cleartext
 * @impact-areas  auth-identity, account-security
 * @version       2026-11
 */
'use strict';
(function () {
  const form = document.getElementById('forgot-form');
  const message = document.getElementById('message');
  const button = document.getElementById('send-button');
  const email = document.getElementById('email');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    button.disabled = true;
    try {
      await fetch('/api/auth/password-reset/request', {
        method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value.trim() }),
      });
      form.hidden = true;
      // Identical text whether account exists or not; no account enumeration.
      message.textContent = 'Si cette adresse est connue, un lien de réinitialisation sera envoyé.';
    } catch (_) {
      message.textContent = 'Le service est temporairement indisponible. Réessayez.';
    } finally { button.disabled = false; }
  });
}());