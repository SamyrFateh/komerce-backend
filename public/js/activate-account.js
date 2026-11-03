/**
 * @komerce-arch
 * @role          staff-account-activation-ui
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
  const form = document.getElementById('activation-form');
  const message = document.getElementById('message');
  const button = document.getElementById('activate-button');
  const password = document.getElementById('new-password');
  const confirmation = document.getElementById('confirm-password');
  // A fragment is not sent to Komerce or third-party servers as part of a GET.
  const params = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : '');
  const token = params.get('token') || '';
  history.replaceState(null, '', location.pathname);
  if (!/^[a-f0-9]{64}$/.test(token)) {
    form.hidden = true;
    message.textContent = 'Ce lien est invalide. Demandez une nouvelle invitation.';
    return;
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (password.value !== confirmation.value) {
      message.textContent = 'Les mots de passe ne correspondent pas.';
      return;
    }
    if (password.value.length < 8 || !/[A-Z]/.test(password.value) || !/[0-9]/.test(password.value)) {
      message.textContent = 'Choisissez au moins 8 caractères, une majuscule et un chiffre.';
      return;
    }
    button.disabled = true;
    try {
      const response = await fetch('/api/auth/activate-account', {
        method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: password.value }),
      });
      if (!response.ok) {
        message.textContent = 'Activation impossible : lien expiré, déjà utilisé ou compte déjà activé.';
        return;
      }
      password.value = '';
      confirmation.value = '';
      form.hidden = true;
      message.textContent = 'Votre compte est activé. Vous pouvez maintenant vous connecter.';
    } catch (_) {
      message.textContent = 'Erreur de connexion. Réessayez.';
    } finally {
      button.disabled = false;
    }
  });
}());
