/**
 * @komerce-arch
 * @role          providers-services-providers-service
 * @domain        providers-services
 * @layer         service
 * @criticality   high
 * @inputs        provider_id, service_id, inquiry_id, market_id, texte libre
 * @outputs       provider_row, service_row, inquiry_row
 * @depends       db
 * @used-by       (aucun — shadow, appel direct scripts/tests dans cette PR)
 * @db-read       providers, services, inquiries, markets
 * @db-write      providers, services, inquiries
 * @db-txn        single_statement_sufficient
 * @doctrine      IMPACT_FEATURE_FIRST_DISCOVERY_LOCALE.md §Providers-services,
 *                ARBITRAGE_RECHALLENGE_SONNET.md (second principal payable),
 *                RECHALLENGE_MODELE_MINIMAL.md §6/§7 (demander != réserver)
 * @impact-areas  providers-services
 * @version       2026-08
 */

'use strict';

/**
 * ═══════════════════════════════════════════════════════════════
 * PROVIDERS-SERVICES — Vague 1 Shadow (PR B)
 *
 * Provider = le second principal payable. PAS une ligne users, PAS un
 * user_role — identité vérifiée par téléphone, pas d'authentification app
 * à ce stade (le contact réel se fait par WhatsApp, hors périmètre ici).
 *
 * Service = une proposition d'un provider, jamais exposée tant que
 * commercial_exposure reste DISABLED (même patron que les rails transport).
 *
 * Inquiry = une DEMANDE, jamais une réservation. Avant que le provider
 * réponde, aucune ressource n'est engagée — voir RECHALLENGE_MODELE_MINIMAL
 * §6/§7. Cycle : sent -> answered -> accepted | declined.
 *
 * SHADOW STRICT : aucune route HTTP dans cette PR, aucun consommateur
 * Boutique/checkout, aucun paiement, aucune commission.
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../db');

const PROVIDER_STATUS = Object.freeze({
  PENDING:   'pending',
  ACTIVE:    'active',
  SUSPENDED: 'suspended',
});

const SERVICE_STATUS = Object.freeze({
  DRAFT:     'draft',
  ACTIVE:    'active',
  SUSPENDED: 'suspended',
});

const INQUIRY_STATUS = Object.freeze({
  SENT:     'sent',
  ANSWERED: 'answered',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
});

// ── Provider ─────────────────────────────────────────────────────────────

/**
 * Crée un provider. Statut initial toujours 'pending' — validation
 * identité (pas légalité), jamais actif par défaut.
 *
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.phone
 * @param {string} params.marketId
 * @returns {Promise<object>}
 */
async function createProvider({ name, phone, marketId }) {
  if (!name || !phone) {
    throw new Error('createProvider: name et phone sont requis');
  }
  if (!marketId) {
    throw new Error('createProvider: market_id est requis');
  }
  const { rows: marketRows } = await db.query(
    'SELECT id FROM markets WHERE id = $1 AND is_active = true',
    [marketId]
  );
  if (!marketRows.length) {
    throw new Error(`createProvider: marché introuvable ou inactif (${marketId})`);
  }

  const { rows } = await db.query(
    `INSERT INTO providers (name, phone, market_id, status)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, phone, market_id, status, created_at, updated_at`,
    [name, phone, marketId, PROVIDER_STATUS.PENDING]
  );
  return rows[0];
}

/**
 * Change le statut d'un provider. C'est le seul levier de sanction
 * disponible dans l'informel (visibilité, pas pénalité financière) —
 * réversible, immédiat, sans validation centrale (CHALLENGE_SERVICES_
 * TWO_TRACK §T2).
 *
 * @param {string} providerId
 * @param {'pending'|'active'|'suspended'} status
 * @returns {Promise<object>}
 */
async function setProviderStatus(providerId, status) {
  if (!Object.values(PROVIDER_STATUS).includes(status)) {
    throw new Error(`setProviderStatus: statut invalide (${status})`);
  }
  const { rows } = await db.query(
    `UPDATE providers SET status = $2, updated_at = now()
     WHERE id = $1
     RETURNING id, name, phone, market_id, status, created_at, updated_at`,
    [providerId, status]
  );
  if (!rows.length) throw new Error(`setProviderStatus: provider introuvable (${providerId})`);
  return rows[0];
}

async function getProvider(providerId) {
  const { rows } = await db.query('SELECT * FROM providers WHERE id = $1', [providerId]);
  return rows[0] || null;
}

// ── Service ──────────────────────────────────────────────────────────────

/**
 * Crée une proposition de service pour un provider. exposure toujours
 * DISABLED à la création — jamais exposée par défaut (même patron que
 * commercial_exposure sur les rails transport, DOCTRINE_TRANSPORT_RAILS.md).
 *
 * Refuse la création si le provider n'est pas 'active' — un service ne
 * peut pas exister avant que son provider ait été validé.
 *
 * @param {object} params
 * @param {string} params.providerId
 * @param {string} params.title
 * @param {string} [params.description]
 * @param {string} params.marketId
 * @param {string} [params.zone]
 * @returns {Promise<object>}
 */
async function createService({ providerId, title, description = null, marketId, zone = null }) {
  if (!providerId || !title) {
    throw new Error('createService: provider_id et title sont requis');
  }
  if (!marketId) {
    throw new Error('createService: market_id est requis');
  }

  const provider = await getProvider(providerId);
  if (!provider) throw new Error(`createService: provider introuvable (${providerId})`);
  if (provider.status !== PROVIDER_STATUS.ACTIVE) {
    throw new Error(`createService: provider non actif (statut=${provider.status})`);
  }

  const { rows: marketRows } = await db.query(
    'SELECT id FROM markets WHERE id = $1 AND is_active = true',
    [marketId]
  );
  if (!marketRows.length) {
    throw new Error(`createService: marché introuvable ou inactif (${marketId})`);
  }

  const { rows } = await db.query(
    `INSERT INTO services (provider_id, title, description, market_id, zone, status, commercial_exposure)
     VALUES ($1, $2, $3, $4, $5, $6, 'DISABLED')
     RETURNING id, provider_id, title, description, market_id, zone, status, commercial_exposure, created_at, updated_at`,
    [providerId, title, description, marketId, zone, SERVICE_STATUS.DRAFT]
  );
  return rows[0];
}

async function getService(serviceId) {
  const { rows } = await db.query('SELECT * FROM services WHERE id = $1', [serviceId]);
  return rows[0] || null;
}

/**
 * Un service n'est exposable (côté Discovery, Vague 2) que si TOUTES ces
 * conditions tiennent : le service lui-même est actif, son exposition est
 * activée, ET son provider est actif. Le statut provider gouverne toujours
 * l'exposition, jamais l'inverse — un provider suspendu masque
 * immédiatement tous ses services, sans avoir à les toucher un par un.
 *
 * @param {string} serviceId
 * @returns {Promise<boolean>}
 */
async function isServiceExposable(serviceId) {
  const { rows } = await db.query(
    `SELECT s.status AS service_status, s.commercial_exposure, p.status AS provider_status
       FROM services s
       JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1`,
    [serviceId]
  );
  if (!rows.length) return false;
  const r = rows[0];
  return r.service_status === SERVICE_STATUS.ACTIVE
    && r.commercial_exposure === 'ENABLED'
    && r.provider_status === PROVIDER_STATUS.ACTIVE;
}

// ── Inquiry ──────────────────────────────────────────────────────────────

/**
 * Crée une demande. Jamais une réservation — aucune ressource n'est
 * engagée à cet instant (RECHALLENGE_MODELE_MINIMAL §6/§7). requestedWindow
 * est du texte libre ("demain matin"), jamais un créneau structuré.
 *
 * @param {object} params
 * @param {string} params.serviceId
 * @param {string} params.requesterPhone
 * @param {string} [params.requestedWindow]
 * @returns {Promise<object>}
 */
async function createInquiry({ serviceId, requesterPhone, requestedWindow = null }) {
  if (!serviceId || !requesterPhone) {
    throw new Error('createInquiry: service_id et requester_phone sont requis');
  }
  const service = await getService(serviceId);
  if (!service) throw new Error(`createInquiry: service introuvable (${serviceId})`);

  const { rows } = await db.query(
    `INSERT INTO inquiries (service_id, requester_phone, requested_window, status)
     VALUES ($1, $2, $3, $4)
     RETURNING id, service_id, requester_phone, requested_window, proposed_window,
               status, sent_at, answered_at, created_at, updated_at`,
    [serviceId, requesterPhone, requestedWindow, INQUIRY_STATUS.SENT]
  );
  return rows[0];
}

/**
 * Le provider répond — sans encore trancher. Peut porter une contre-
 * proposition (proposedWindow). Fixe answered_at, mesure clé du shadow
 * test (délai de confirmation, CHALLENGE_SERVICES_TWO_TRACK §9-bis).
 *
 * @param {string} inquiryId
 * @param {string} [proposedWindow]
 * @returns {Promise<object>}
 */
async function answerInquiry(inquiryId, proposedWindow = null) {
  const inquiry = await getInquiry(inquiryId);
  if (!inquiry) throw new Error(`answerInquiry: demande introuvable (${inquiryId})`);
  if (inquiry.status !== INQUIRY_STATUS.SENT) {
    throw new Error(`answerInquiry: statut invalide pour répondre (${inquiry.status})`);
  }

  const { rows } = await db.query(
    `UPDATE inquiries
        SET status = $2, proposed_window = $3, answered_at = now(), updated_at = now()
      WHERE id = $1
      RETURNING id, service_id, requester_phone, requested_window, proposed_window,
                status, sent_at, answered_at, created_at, updated_at`,
    [inquiryId, INQUIRY_STATUS.ANSWERED, proposedWindow]
  );
  return rows[0];
}

/**
 * Décision finale — accepted ou declined. Seule transition qui fait
 * réellement naître un engagement (le "booking" au sens de
 * RECHALLENGE_MODELE_MINIMAL §7 n'est jamais un objet séparé au shadow,
 * juste cet état).
 *
 * @param {string} inquiryId
 * @param {'accepted'|'declined'} decision
 * @returns {Promise<object>}
 */
async function decideInquiry(inquiryId, decision) {
  if (![INQUIRY_STATUS.ACCEPTED, INQUIRY_STATUS.DECLINED].includes(decision)) {
    throw new Error(`decideInquiry: décision invalide (${decision})`);
  }
  const inquiry = await getInquiry(inquiryId);
  if (!inquiry) throw new Error(`decideInquiry: demande introuvable (${inquiryId})`);
  if (inquiry.status !== INQUIRY_STATUS.ANSWERED) {
    throw new Error(`decideInquiry: statut invalide pour décider (${inquiry.status})`);
  }

  const { rows } = await db.query(
    `UPDATE inquiries SET status = $2, updated_at = now()
      WHERE id = $1
      RETURNING id, service_id, requester_phone, requested_window, proposed_window,
                status, sent_at, answered_at, created_at, updated_at`,
    [inquiryId, decision]
  );
  return rows[0];
}

async function getInquiry(inquiryId) {
  const { rows } = await db.query('SELECT * FROM inquiries WHERE id = $1', [inquiryId]);
  return rows[0] || null;
}

module.exports = {
  PROVIDER_STATUS,
  SERVICE_STATUS,
  INQUIRY_STATUS,
  createProvider,
  setProviderStatus,
  getProvider,
  createService,
  getService,
  isServiceExposable,
  createInquiry,
  answerInquiry,
  decideInquiry,
  getInquiry,
};
