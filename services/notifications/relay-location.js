'use strict';

const GOOGLE_MAPS_SEARCH_URL = 'https://www.google.com/maps/search/?api=1&query=';

function cleanLocationPart(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function relayCoordinates({ latitude, longitude, lat, lng, lon } = {}) {
  const resolvedLat = Number(latitude ?? lat);
  const resolvedLng = Number(longitude ?? lng ?? lon);
  if (!Number.isFinite(resolvedLat) || !Number.isFinite(resolvedLng)) return null;
  if (resolvedLat < -90 || resolvedLat > 90 || resolvedLng < -180 || resolvedLng > 180) return null;
  return { latitude: resolvedLat, longitude: resolvedLng };
}

/**
 * Produit le lien canonique du relais.
 * GPS exact en priorité ; nom + adresse restent le fallback historique tant
 * que le relais n'a pas encore été enrichi par les opérations locales.
 */
function buildRelayMapUrl(relay = {}) {
  const coordinates = relayCoordinates(relay);
  if (coordinates) {
    return `https://www.google.com/maps?q=${coordinates.latitude},${coordinates.longitude}&z=17&hl=fr`;
  }

  const query = [cleanLocationPart(relay.name), cleanLocationPart(relay.address)]
    .filter(Boolean)
    .join(', ');

  return query ? `${GOOGLE_MAPS_SEARCH_URL}${encodeURIComponent(query)}` : null;
}

function formatRelayPoint(relay = {}) {
  const label = cleanLocationPart(relay.name) || 'votre point relais';
  const mapUrl = buildRelayMapUrl(relay);
  return mapUrl ? `${label} — Localiser : ${mapUrl}` : label;
}

function appendRelayLocation(message, relay) {
  const mapUrl = buildRelayMapUrl(relay);
  return mapUrl ? `${message}\n📍 Localiser le relais : ${mapUrl}` : message;
}

module.exports = { relayCoordinates, buildRelayMapUrl, formatRelayPoint, appendRelayLocation };
