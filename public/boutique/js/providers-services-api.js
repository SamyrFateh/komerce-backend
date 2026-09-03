/**
 * @komerce-arch-lite
 * @role          providers-services-api
 * @domain        providers-services
 * @layer         adapter
 * @owner         public/boutique/js/providers-services-api.js
 * @purpose       Frontière frontend des mutations providers-services ; le téléphone reste exclusivement dérivé de la session serveur.
 * @impact-areas  boutique, discovery-rail, providers-services
 * @version       2026-09
 */
'use strict';

function currentMarketCode() {
  try {
    return window.KomerceMarket?.get()?.code || 'KM';
  } catch (_) {
    return 'KM';
  }
}

/**
 * Crée une Inquiry pour une cible locale. La cible elle-même porte le propos
 * connu ; intent choisit demande ou rappel et requesterNote ne fait que
 * préciser ce contexte. Aucun téléphone provider/requester n'est envoyé.
 */
export async function createProviderInquiry(
  kind,
  ref,
  requestedWindow = null,
  intent = 'request',
  requesterNote = null,
) {
  if (!ref || !['service', 'physical_offer'].includes(kind)) {
    return { ok: false, status: 400, code: 'invalid_target', error: 'Cible invalide' };
  }
  const normalizedIntent = String(intent || 'request').trim().toLowerCase();
  if (!['request', 'callback'].includes(normalizedIntent)) {
    return { ok: false, status: 400, code: 'invalid_intent', error: 'Intention invalide' };
  }

  const market = currentMarketCode();
  const body = kind === 'service'
    ? { service_id: ref }
    : { physical_offer_id: ref };

  body.intent = normalizedIntent;
  if (requestedWindow) body.requested_window = requestedWindow;
  if (requesterNote) body.requester_note = requesterNote;

  try {
    const response = await fetch(`/api/providers-services/inquiries?market=${encodeURIComponent(market)}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: payload?.code || null,
        error: payload?.error || 'Impossible d’envoyer la demande',
      };
    }

    if (!payload?.inquiry?.id) {
      return { ok: false, status: 502, code: 'invalid_response', error: 'Réponse de demande invalide' };
    }

    return { ok: true, inquiry: payload.inquiry };
  } catch (_) {
    return { ok: false, status: 0, code: 'network_error', error: 'Connexion impossible' };
  }
}
