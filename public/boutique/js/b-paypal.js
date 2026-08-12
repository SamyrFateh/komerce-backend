/**
 * @komerce-arch-lite
 * @role          payment-b-paypal
 * @domain        payment
 * @layer         ui-component
 * @owner         public/boutique/js/b-checkout.js
 * @purpose       supports public/boutique/js/b-checkout.js
 * @impact-areas  payment
 * @version       2026-06
 */
'use strict';

/**
 * @module b-paypal
 * @brief Bouton PayPal officiel — diaspora France + Pay-in-4
 *
 * Charge dynamiquement le SDK PayPal Buttons et expose `renderPayPalButton()`
 * pour l'intégration dans le checkout boutique.
 *
 * Doctrine :
 *   - Le SDK PayPal est chargé une seule fois (cache module-level)
 *   - PAYPAL_CLIENT_ID lu depuis /api/public/config (pas de hardcode front)
 *   - Pay-in-4 inclus via `enable-funding=paylater` (active automatiquement
 *     les options 4-fois éligibles côté SDK)
 *   - Flow : onClick (valider formulaire) → createOrder (créer ordre Komerce
 *     puis appeler /api/payments/paypal/create-order) → onApprove (capture)
 *   - Fallback : si le SDK échoue ou est bloqué (adblock), on log et l'utilisateur
 *     peut basculer sur Stripe (chip toujours visible)
 */

import { apiPost } from './b-utils.js';
import { showToast } from './b-cart-core.js';

let _sdkLoading = null;
let _sdkLoaded  = false;
let _config     = null;
let _configLoading = null;

const PAYMENT_PROVIDER_TIMEOUT_MS = 8000;

function withTimeout(promise, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), PAYMENT_PROVIDER_TIMEOUT_MS);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

async function getPublicConfig() {
  if (_config) return _config;
  if (_configLoading) return _configLoading;

  _configLoading = withTimeout(
    fetch('/api/public/config', { credentials: 'include' }).then(async (res) => {
      if (!res.ok) throw new Error('Config publique indisponible');
      return res.json();
    }),
    'Délai de chargement de la configuration PayPal dépassé'
  ).then((config) => {
    _config = config;
    return config;
  }).catch((error) => {
    _configLoading = null;
    throw error;
  });

  return _configLoading;
}

/**
 * Charge le SDK PayPal une seule fois.
 * Idempotent : retourne le même Promise si appelé plusieurs fois.
 */
export async function ensurePayPalSDK() {
  if (_sdkLoaded) return window.paypal;
  if (_sdkLoading) return _sdkLoading;

  _sdkLoading = (async () => {
    // 1. Récupérer config publique
    _config = await getPublicConfig();

    if (!_config.paypal_client_id) {
      throw new Error('PayPal non configuré (client_id absent)');
    }

    // 2. Injecter le script SDK avec Pay-in-4 (enable-funding=paylater)
    await withTimeout(new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const params = new URLSearchParams({
        'client-id':     _config.paypal_client_id,
        'currency':      'EUR',
        'intent':        'capture',
        'enable-funding': 'paylater', // Pay-in-4 France
        'locale':        'fr_FR',
        'components':    'buttons',
      });
      script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
      script.async = true;
      script.onload  = resolve;
      script.onerror = () => reject(new Error('Chargement SDK PayPal échoué (adblock ?)'));
      document.head.appendChild(script);
    }), 'Délai de chargement du SDK PayPal dépassé');

    if (!window.paypal) throw new Error('window.paypal non disponible après chargement');
    _sdkLoaded = true;
    return window.paypal;
  })().catch((error) => {
    _sdkLoading = null;
    throw error;
  });

  return _sdkLoading;
}

/**
 * Rend les boutons PayPal dans un container.
 *
 * @param {string} containerId — ID du container DOM
 * @param {object} opts
 * @param {function(): Promise<{ order_reference: string, order_id: string }>}
 *        opts.prepareKomerceOrder — Callback qui crée l'ordre Komerce
 *        (réutilise la même fonction submitOrder() côté b-checkout)
 *        et retourne la référence.
 * @param {function(string): boolean | Promise<boolean>}
 *        [opts.validateBeforeClick] — Validation pré-click (formulaire OK ?)
 * @param {function(object): void} [opts.onSuccess] — Appelée après capture OK
 * @param {function(Error): void}  [opts.onError]
 *
 * @returns {Promise<void>}
 */
export async function renderPayPalButton(containerId, opts = {}) {
  const container = document.getElementById(containerId);
  if (!container) throw new Error(`Container ${containerId} introuvable`);

  // Reset container (au cas où on re-rend)
  container.innerHTML = '';
  container.classList.add('k-paypal-loading');

  let paypal;
  try {
    paypal = await ensurePayPalSDK();
  } catch (err) {
    container.classList.remove('k-paypal-loading');
    container.innerHTML = '<div class="k-paypal-error">PayPal indisponible — utilisez la carte ou cash.</div>';
    if (opts.onError) opts.onError(err);
    return;
  }

  container.classList.remove('k-paypal-loading');

  const buttons = paypal.Buttons({
    fundingSource: paypal.FUNDING.PAYPAL, // FIX: force le bouton PayPal — évite isEligible() false sur compte sandbox restreint

    style: {
      layout: 'vertical',
      color:  'gold',
      shape:  'rect',
      label:  'paypal',
      height: 45,
    },

    // Validation pré-click (avant ouverture popup PayPal)
    onClick: async (data, actions) => {
      if (opts.validateBeforeClick) {
        try {
          const ok = await opts.validateBeforeClick();
          if (!ok) return actions.reject();
        } catch (err) {
          showToast('Vérifiez le formulaire avant de payer', 'error');
          return actions.reject();
        }
      }
      return actions.resolve();
    },

    // createOrder : appelé quand l'utilisateur clique sur le bouton PayPal
    createOrder: async () => {
      try {
        // 1. Créer l'ordre Komerce (réutilise la logique boutique)
        const komerce = await opts.prepareKomerceOrder();
        if (!komerce?.order_reference) {
          throw new Error('Ordre Komerce non créé');
        }

        // 2. Créer la PayPal Order côté serveur (réutilise total_eur de l'ordre Komerce)
        const res = await apiPost('/api/payments/paypal/create-order', {
          order_reference: komerce.order_reference,
        });
        if (!res?.paypal_order_id) {
          throw new Error('paypal_order_id manquant dans la réponse serveur');
        }

        return res.paypal_order_id;

      } catch (err) {
        console.error('[PAYPAL] createOrder failed', err);
        showToast(err.message || 'Erreur création paiement PayPal', 'error');
        if (opts.onError) opts.onError(err);
        throw err;
      }
    },

    // onApprove : utilisateur a approuvé dans la popup PayPal
    onApprove: async (data) => {
      try {
        const captureRes = await apiPost(`/api/payments/paypal/capture/${encodeURIComponent(data.orderID)}`, {});

        if (captureRes?.success || captureRes?.already_paid) {
          showToast('🎉 Paiement PayPal accepté !', 'success');
          if (opts.onSuccess) opts.onSuccess(captureRes);
        } else {
          throw new Error('Capture PayPal incomplète');
        }
      } catch (err) {
        console.error('[PAYPAL] onApprove/capture failed', err);
        showToast(err.message || 'Erreur capture PayPal — votre compte n\'a peut-être pas été débité', 'error');
        if (opts.onError) opts.onError(err);
      }
    },

    onCancel: () => {
      // L'utilisateur a fermé la popup — pas d'erreur, on log juste
      console.info('[PAYPAL] paiement annulé par l\'utilisateur');
    },

    onError: (err) => {
      console.error('[PAYPAL] erreur SDK', err);
      showToast('Erreur PayPal — réessayez ou utilisez la carte', 'error');
      if (opts.onError) opts.onError(err);
    },
  });

  if (!buttons.isEligible()) {
    container.innerHTML = '<div class="k-paypal-error">PayPal non éligible pour cette transaction.</div>';
    return;
  }

  await buttons.render(`#${containerId}`);
}

/**
 * Helper : vérifie si PayPal est disponible côté config (sans charger le SDK).
 * Utilisé pour afficher/cacher la chip PayPal dans le checkout.
 */
export async function isPayPalEnabled() {
  try {
    const cfg = await getPublicConfig();
    return !!cfg.paypal_client_id;
  } catch {
    return false;
  }
}
