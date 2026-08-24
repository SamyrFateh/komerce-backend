'use strict';

const GOOGLE_MAPS_SEARCH_URL = 'https://www.google.com/maps/search/?api=1&query=';

function cleanLocationPart(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/**
 * Produit un lien cartographique sans dépendre d'un géocodeur externe.
 * Le nom et l'adresse publics du relais forment la recherche Google Maps.
 */
function buildRelayMapUrl({ name, address } = {}) {
  const query = [cleanLocationPart(name), cleanLocationPart(address)]
    .filter(Boolean)
    .join(', ');

  return query ? `${GOOGLE_MAPS_SEARCH_URL}${encodeURIComponent(query)}` : null;
}

function formatRelayPoint({ name, address } = {}) {
  const label = cleanLocationPart(name) || 'votre point relais';
  const mapUrl = buildRelayMapUrl({ name, address });
  return mapUrl ? `${label} — Localiser : ${mapUrl}` : label;
}

function appendRelayLocation(message, relay) {
  const mapUrl = buildRelayMapUrl(relay);
  return mapUrl ? `${message}\n📍 Localiser le relais : ${mapUrl}` : message;
}

module.exports = { buildRelayMapUrl, formatRelayPoint, appendRelayLocation };
