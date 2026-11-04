/**
 * @komerce-arch
 * @role          staff-password-reset-ui
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
  const form = document.getElementById('reset-form');
  const message = document.getElementById('message');
  const button = document.getElementById('reset-button');
  const password = document.getElementById('new-password');
  const confirmation = document.getElementById('confirm-password');
  const token = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : '').get('token') || '';
  history.replaceState(null, '', location.pathname);
  if (!/^[a-f0-9]{64}$/.test(token)) {
    form.hidden = true;
    message.textContent = 'Lien invalide. Demandez une nouvelle réinitialisation.';
    return;
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (password.value !== confirmation.value ||
        password.value.length < 8 || !/[A-Z]/.test(password.value) ||
        !/[0-9]/.test(password.value)) {
      message.textContent = 'Vérifiez la confirmation, la majuscule, le chiffre et la longueur.';
      return;
    }
    button.disabled = true;
    try {
      const response = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password.value }),
      });
      if (!response.ok) {
        message.textContent = 'Réinitialisation impossible. Ce lien a expiré ou a déjà été utilisé.';
        return;
      }
      password.value = '';
      confirmation.value = '';
      form.hidden = true;
      message.textContent = 'Mot de passe modifié. Reconnectez-vous sur Komerce.';
    } catch (_) {
      message.textContent = 'Erreur réseau. Réessayez.';
    } finally { button.disabled = false; }
  });
}());