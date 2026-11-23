/**
 * @komerce-arch
 * @role          logistics-relais-mutation-service
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        db_or_transaction_executor, relais payload
 * @outputs       relais read model, mutated relais row, stable relay short code
 * @depends       none (executor fourni par l'appelant)
 * @used-by       services/market-delegation-network-service.js
 * @db-read       relais
 * @db-write      relais
 * @db-txn        caller_transaction_preserved
 * @doctrine      writer_not_owner_boundary, suspend_not_delete
 * @impact-areas  logistics, market-delegation, orders
 * @version       2026-09
 */
'use strict';

const { ISLAND_ROUTED_MARKETS, DESTINATIONS } = require('./routing');

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('relais-mutation-service: executor.query requis');
  }
  return executor;
}

class RelaisValidationError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

function requiredText(value, field, { max = 500 } = {}) {
  const text = String(value == null ? '' : value).trim();
  if (!text.length) throw new RelaisValidationError('NETWORK_FIELD_REQUIRED', `${field} est requis.`, 400);
  if (text.length > max) throw new RelaisValidationError('NETWORK_FIELD_TOO_LONG', `${field} dépasse ${max} caractères.`, 400);
  return text;
}

function optionalText(value, max = 500) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text.length) return null;
  if (text.length > max) throw new RelaisValidationError('NETWORK_FIELD_TOO_LONG', `Champ dépasse ${max} caractères.`, 400);
  return text;
}

function optionalCoordinate(value, field, { min, max }) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new RelaisValidationError('NETWORK_COORDINATE_INVALID', `${field} doit être numérique.`, 400);
  if (n < min || n > max) throw new RelaisValidationError('NETWORK_COORDINATE_OUT_OF_RANGE', `${field} hors plage valide.`, 400);
  return n;
}

// GPS : les deux coordonnées ou aucune — reflète le CHECK SQL relais_gps_pair_check.
function normalizeGps(latitude, longitude) {
  const lat = optionalCoordinate(latitude, 'latitude', { min: -90, max: 90 });
  const lng = optionalCoordinate(longitude, 'longitude', { min: -180, max: 180 });
  if ((lat == null) !== (lng == null)) {
    throw new RelaisValidationError('NETWORK_GPS_PAIR_REQUIRED', 'latitude et longitude doivent être fournies ensemble ou omises ensemble.', 400);
  }
  return { latitude: lat, longitude: lng };
}

// Marché insulaire (même règle que resolveRoutingFromRelais) : island_code obligatoire et admis par le routage.
function isIslandMarket(marketCode) {
  return !!marketCode && ISLAND_ROUTED_MARKETS.includes(String(marketCode).toUpperCase());
}
function islandOptionsFor(marketCode) {
  return isIslandMarket(marketCode) ? [...DESTINATIONS] : [];
}
function assertIslandCode(marketCode, islandCode) {
  if (!isIslandMarket(marketCode)) return;
  const code = islandCode ? String(islandCode).trim().toUpperCase() : '';
  if (!code) throw new RelaisValidationError('NETWORK_ISLAND_CODE_REQUIRED', `island_code est requis pour le marché ${String(marketCode).toUpperCase()}.`, 400);
  if (!DESTINATIONS.includes(code)) throw new RelaisValidationError('NETWORK_ISLAND_CODE_INVALID', `island_code doit être l'une des valeurs : ${DESTINATIONS.join(', ')}.`, 400);
}

const RELAIS_COLUMNS = `id, market_id, name, agent_name, phone, address, zone, hours, island, island_code,
            is_active, latitude, longitude, photo_url, created_at`;

// Stable 4-character relay code, derived once from the REAL relay name.
// A rename does not silently change references already printed.
function relayCodeStem(name) {
  const omitted = new Set(['RELAIS', 'KOMERCE', 'CENTRE', 'CENTER', 'POINT', 'DE', 'DU', 'DES', 'LA', 'LE', 'LES']);
  const normalized = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z]+/g, ' ').trim().split(/\s+/)
    .filter(token => token && !omitted.has(token));
  if (!normalized.length) throw new RelaisValidationError('RELAY_SHORT_CODE_NAME_UNUSABLE', 'Nom de relais inutilisable pour le code court.');
  return (normalized[0] + 'XXX').slice(0, 3);
}

async function ensureRelaisShortCode(executor, { marketId, relaisId }) {
  const client = requireExecutor(executor);
  const { rows: [relay] } = await client.query(
    'SELECT id, name, short_code FROM relais WHERE id=$1 AND market_id=$2 AND is_active=TRUE FOR UPDATE',
    [relaisId, marketId]
  );
  if (!relay) throw new RelaisValidationError('NETWORK_RELAIS_NOT_FOUND', 'Relais introuvable.', 404);
  if (relay.short_code) return relay.short_code;
  const stem = relayCodeStem(relay.name);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['relay-short:' + marketId + ':' + stem]);
  const { rows: allocated } = await client.query(
    'SELECT short_code FROM relais WHERE market_id=$1 AND short_code LIKE $2',
    [marketId, stem + '%']
  );
  const used = new Set(allocated.map(r => r.short_code));
  for (let i = 1; i <= 9; i++) {
    const candidate = stem + i;
    if (used.has(candidate)) continue;
    const { rows: [assigned] } = await client.query(
      'UPDATE relais SET short_code=$3 WHERE id=$1 AND market_id=$2 AND short_code IS NULL RETURNING short_code',
      [relaisId, marketId, candidate]
    );
    if (assigned) return assigned.short_code;
  }
  throw new RelaisValidationError('RELAY_SHORT_CODE_EXHAUSTED', 'Neuf relais partagent le même préfixe dans ce marché : arbitrage de nom requis.', 409);
}

async function listRelais(executor, { marketId }) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(
    `SELECT ${RELAIS_COLUMNS} FROM relais WHERE market_id = $1::uuid ORDER BY is_active DESC, name`,
    [marketId]
  );
  return rows;
}

async function getOwnedRelais(executor, { marketId, relaisId }) {
  const db = requireExecutor(executor);
  const { rows } = await db.query(`SELECT ${RELAIS_COLUMNS} FROM relais WHERE id = $1::uuid`, [relaisId]);
  const relais = rows[0];
  if (!relais) throw new RelaisValidationError('NETWORK_RELAIS_NOT_FOUND', 'Relais introuvable.', 404);
  if (relais.market_id !== marketId) {
    // Un relais existe mais appartient à un autre marché : jamais de fuite
    // d'information cross-market, même sous forme de 403 explicite.
    throw new RelaisValidationError('NETWORK_RELAIS_NOT_FOUND', 'Relais introuvable.', 404);
  }
  return relais;
}

async function createRelais(executor, { marketId, marketCode = null, name, agentName, phone, address, zone, hours, island, islandCode, latitude, longitude, photoUrl }) {
  const db = requireExecutor(executor);
  const gps = normalizeGps(latitude, longitude);
  assertIslandCode(marketCode, islandCode);
  const payload = {
    name: requiredText(name, 'name', { max: 200 }),
    // L'identité structurelle du relais ne dépend pas d'une personne déjà
    // affectée. L'opérateur peut créer le point puis renseigner l'agent ensuite.
    agent_name: optionalText(agentName, 200),
    phone: requiredText(phone, 'phone', { max: 40 }),
    address: requiredText(address, 'address', { max: 500 }),
    zone: optionalText(zone, 200),
    hours: optionalText(hours, 200),
    island: optionalText(island, 100),
    island_code: optionalText(islandCode && String(islandCode).trim().toUpperCase(), 20),
    photo_url: optionalText(photoUrl, 1000),
    ...gps,
  };

  const { rows } = await db.query(
    `INSERT INTO relais (market_id, name, agent_name, phone, address, zone, hours, island, island_code, is_active, latitude, longitude, photo_url)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,$11,$12)
     RETURNING ${RELAIS_COLUMNS}`,
    [marketId, payload.name, payload.agent_name, payload.phone, payload.address, payload.zone,
      payload.hours, payload.island, payload.island_code, payload.latitude, payload.longitude, payload.photo_url]
  );
  return rows[0];
}

async function updateRelais(executor, { marketId, marketCode = null, relaisId, patch = {} }) {
  const db = requireExecutor(executor);
  const before = await getOwnedRelais(db, { marketId, relaisId });

  const next = {
    name: patch.name !== undefined ? requiredText(patch.name, 'name', { max: 200 }) : before.name,
    agent_name: patch.agentName !== undefined ? optionalText(patch.agentName, 200) : before.agent_name,
    phone: patch.phone !== undefined ? requiredText(patch.phone, 'phone', { max: 40 }) : before.phone,
    address: patch.address !== undefined ? requiredText(patch.address, 'address', { max: 500 }) : before.address,
    zone: patch.zone !== undefined ? optionalText(patch.zone, 200) : before.zone,
    hours: patch.hours !== undefined ? optionalText(patch.hours, 200) : before.hours,
    island: patch.island !== undefined ? optionalText(patch.island, 100) : before.island,
    island_code: patch.islandCode !== undefined ? optionalText(patch.islandCode, 20) : before.island_code,
    photo_url: patch.photoUrl !== undefined ? optionalText(patch.photoUrl, 1000) : before.photo_url,
  };
  if (patch.islandCode !== undefined) next.island_code = optionalText(patch.islandCode && String(patch.islandCode).trim().toUpperCase(), 20);
  assertIslandCode(marketCode, next.island_code);
  const gps = (patch.latitude !== undefined || patch.longitude !== undefined)
    ? normalizeGps(
      patch.latitude !== undefined ? patch.latitude : before.latitude,
      patch.longitude !== undefined ? patch.longitude : before.longitude
    )
    : { latitude: before.latitude, longitude: before.longitude };

  const { rows } = await db.query(
    `UPDATE relais
        SET name=$2, agent_name=$3, phone=$4, address=$5, zone=$6, hours=$7,
            island=$8, island_code=$9, latitude=$10, longitude=$11, photo_url=$12
      WHERE id=$1::uuid AND market_id=$13::uuid
      RETURNING ${RELAIS_COLUMNS}`,
    [relaisId, next.name, next.agent_name, next.phone, next.address, next.zone, next.hours,
      next.island, next.island_code, gps.latitude, gps.longitude, next.photo_url, marketId]
  );
  return { before, after: rows[0] };
}

async function setRelaisActive(executor, { marketId, relaisId, active }) {
  const db = requireExecutor(executor);
  const before = await getOwnedRelais(db, { marketId, relaisId });
  if (before.is_active === active) return { before, after: before, changed: false };

  const { rows } = await db.query(
    `UPDATE relais SET is_active=$2 WHERE id=$1::uuid AND market_id=$3::uuid RETURNING ${RELAIS_COLUMNS}`,
    [relaisId, active, marketId]
  );
  return { before, after: rows[0], changed: true };
}

module.exports = {
  RelaisValidationError,
  isIslandMarket,
  islandOptionsFor,
  listRelais,
  relayCodeStem,
  ensureRelaisShortCode,
  getOwnedRelais,
  createRelais,
  updateRelais,
  setRelaisActive,
};
