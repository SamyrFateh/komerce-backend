/**
 * @komerce-arch
 * @role         request-validation-schemas
 * @domain        infrastructure
 * @layer        validators
 * @criticality  high
 * @purpose      Schémas Joi centralisés pour valider body, params et query des routes API.
 * @inputs       HTTP request payloads, route params, query strings
 * @outputs      Joi validation schemas
 * @depends      joi
 * @used-by      routes/*
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     API_CONTRACTS
 * @impact-areas api, validation, security
 */
/**
 * KOMERCE – Schémas de validation Joi v2.0 (Vague 1)
 * 
 * Organisation : un objet exporté par route-file.
 * Chaque schéma définit { body?, params?, query? } avec des règles Joi.
 * 
 * Convention : 
 *   · Strings : trimmed, min 1, max raisonnable
 *   · Nombres : positifs, bornés
 *   · UUIDs : format strict (toute version)
 *   · Enums : .valid() avec les valeurs de l'app
 *   · Dates : format ISO ou timestamp
 *
 * v2.0 – Added validators for: loyalty, pricing, purchasing, unsold, finance
 */

'use strict';

const Joi = require('joi');

const uuid     = Joi.string().uuid();
const safeStr  = (max = 255) => Joi.string().trim().max(max);
const email    = Joi.string().trim().lowercase().email();
const phone    = Joi.string().trim().pattern(/^\+?[0-9\s\-().]{6,20}$/).message('Numéro de téléphone invalide');
const posInt   = Joi.number().integer().positive();
const posNum   = Joi.number().positive();
const isoDate  = Joi.string().isoDate();
const url      = Joi.string().trim().uri({ scheme: ['http', 'https'] });

// market_id n'est jamais un champ mutable par le client (freeze §DATABASE :
// "règle Joi jamais market_id en update"). stripUnknown retire déjà market_id
// des payloads qui ne le déclarent pas, mais silencieusement — un schéma
// d'update qui manipule une ressource scopée par marché doit déclarer ce
// champ explicitement en .forbidden() : l'erreur devient visible et testable
// au lieu d'être un retrait muet. Vérifié par scripts/check-no-market-id-mutation.js.
const forbidMarketId = Joi.forbidden().messages({
  'any.unknown': 'market_id ne peut jamais être fourni par le client — résolu serveur uniquement (requireMarketScope, freeze §3)',
});

const auth = {
  register: {
    body: Joi.object({
      email:     email.required(),
      password:  safeStr(128).min(8).required(),
      full_name: safeStr(100).required(),
      phone:     phone.required(),
      role:      Joi.string().valid('client').default('client'),
      currency_pref: Joi.string().valid('KMF', 'EUR').default('KMF'),
    }),
  },
  login: {
    body: Joi.object({
      email:    email,
      phone:    phone,
      password: safeStr(128).required(),
    }).or('email', 'phone'),
  },
  updateProfile: {
    // Lot 4 §3.4 — le WhatsApp vérifié n'est pas un champ texte éditable.
    // Toute modification d'identité vérifiée passe par le parcours OTP
    // existant (routes/otp.js), jamais par ce PUT générique. `phone` est
    // volontairement absent : stripUnknown (middleware/validate.js) le
    // neutralise avant que la route ne le voie.
    body: Joi.object({
      full_name:     safeStr(100),
      currency_pref: Joi.string().valid('KMF', 'EUR'),
    }).min(1),
  },
  // Lot 5 — autorisation nominative de retrait exceptionnel. Les deux champs
  // sont obligatoires : une autorisation active exige toujours prénoms + nom
  // (invariant porté aussi en DB, migration 121).
  pickupAuthorization: {
    body: Joi.object({
      given_names: safeStr(100).required(),
      family_name: safeStr(100).required(),
    }),
  },
  guestCheckout: {
    body: Joi.object({
      full_name: safeStr(100).required(),
      phone:     phone.required(),
      email:     email,
      country:   Joi.string().length(2).default('KM'),
    }),
  },
  autoRegister: {
    body: Joi.object({
      full_name: safeStr(100).required(),
      phone:     phone.required(),
      email:     email,
      role:      Joi.string().valid('client').default('client'),
    }),
  },
  adminReset: {
    body: Joi.object({
      key:          safeStr(128).required(),
      new_password: safeStr(128).min(8).required(),
    }),
  },
};

// product_ref : KPR-XXXXXX — référence interne Komerce stable (RANK-02)
const productRef = Joi.string().trim().pattern(/^KPR-\d{6,}$/).max(50)
  .messages({ 'string.pattern.base': 'product_ref doit respecter le format KPR-XXXXXX (ex: KPR-000001)' });

const products = {
  create: {
    body: Joi.object({
      name:        safeStr(200).required(),
      description: safeStr(2000),
      category:    safeStr(100).required(),
      subcategory: safeStr(100),
      price_aed:   posNum,
      promo_pct:   Joi.number().min(0).max(100),
      price_kmf:   posNum.required(),
      cost_kmf:    posNum,
      weight_g:    posNum.max(100000),
      stock:       Joi.number().integer().min(0).max(999999),
      is_active:   Joi.boolean().default(true),
      image_url:   url,
      tags:        Joi.array().items(safeStr(50)).max(20),
      module_type:        safeStr(50),
      origin_country:     safeStr(50),
      hs_code:            safeStr(20),
      min_order_qty:      posInt,
      product_ref:        productRef,  // optionnel — généré auto via séquence DB si absent
    }),
  },
  update: {
    params: Joi.object({ id: uuid.required() }),
    body: Joi.object({
      name:        safeStr(200),
      description: safeStr(2000),
      category:    safeStr(100),
      subcategory: safeStr(100),
      price_aed:   posNum,
      promo_pct:   Joi.number().min(0).max(100),
      price_kmf:   posNum,
      cost_kmf:    posNum,
      weight_g:    posNum.max(100000),
      stock:       Joi.number().integer().min(0).max(999999),
      is_active:   Joi.boolean(),
      image_url:   url,
      tags:        Joi.array().items(safeStr(50)).max(20),
      module_type:        safeStr(50),
      origin_country:     safeStr(50),
      hs_code:            safeStr(20),
      min_order_qty:      posInt,
      product_ref:        productRef,  // optionnel — doit rester unique si fourni
    }).min(1),
  },
  delete: {
    params: Joi.object({ id: uuid.required() }),
  },
};

const MODULE_TYPES = [
  'mariage', 'couture', 'lunettes', 'parfum', 'bijoux',
  'electronique', 'cosmetique', 'alimentaire', 'autre',
];
const CONFECTION_TYPES = [
  'aucun', 'couture_standard', 'sur_mesure', 'lunettes_vue',
  'lunettes_soleil', 'broderie', 'retouche', 'autre',
];

const orders = {
  create: {
    body: Joi.object({
      items: Joi.array().items(Joi.object({
        product_id: uuid.required(),
        quantity:   posInt.max(100).default(1),
        // Code canonique du rail demandé par le client (null = aucun choix explicite).
        // Ne pas déduire SEA_STANDARD par défaut : c'est l'orchestrateur qui assigne.
        requested_transport_rail: Joi.string()
          .valid('SEA_STANDARD', 'AIR_EXPRESS')
          .allow(null)
          .default(null),
        module_type:       Joi.string().valid(...MODULE_TYPES),
        module_fabric_id:  uuid,
        module_fabric_type: safeStr(100),
        module_size:       safeStr(20),
        module_retouche:   Joi.boolean(),
        module_qty_meters: posNum.max(1000),
        module_accessories: Joi.array().items(safeStr(100)).max(10),
        variant_combo: Joi.object().pattern(
          Joi.string().min(1).max(50),
          Joi.string().min(1).max(50)
        ).max(10).allow(null),
        // Boutique First (D2/D4) — rattachement optionnel à un article de
        // liste partagée. L'unicité est arbitrée en base (migration 123),
        // pas ici : ce champ ne fait que transporter la référence.
        shared_cart_item_id: uuid.allow(null),
      })).min(1).required(),
      relais_id:             uuid,
      payment_mode:          Joi.string().valid('stripe_eur', 'cash_relais', 'paypal_eur').required(),
      stripe_payment_intent: safeStr(200),
      tracking_phone:        phone.allow(null, ''),
      // Liste partagée : intention uniquement, jamais un téléphone fourni
      // par le client. Le serveur résout l'utilisateur vérifié.
      pickup_code_recipient: Joi.string().valid('buyer', 'organizer').default('buyer'),
      confection_type:           Joi.string().valid(...CONFECTION_TYPES).default('aucun'),
      confection_instructions:   safeStr(1000),
      confection_delay_days:     Joi.number().integer().min(0).max(365).default(0),
      confection_artisan_id:     uuid,
      module_type:               Joi.string().valid(...MODULE_TYPES),
      module_fabric_id:          uuid,
      module_fabric_type:        safeStr(100),
      module_size:               safeStr(20),
      module_retouche:           Joi.boolean().default(false),
      module_qty_meters:         posNum.max(1000),
      module_accessories:        Joi.array().items(safeStr(100)).max(10),
      order_occasion:            safeStr(50),
      use_wallet:                Joi.boolean().default(false),
      // Indice de CONTEXTE marché (freeze P3, invariant 3/4) — jamais un
      // montant, jamais une autorisation. Le serveur résout le montant
      // lui-même via utils/currency.js ; un code absent/invalide ne bloque
      // jamais la commande (repli sur relais_fallback dans la route).
      // Liste blanche plutôt que safeStr libre : défense en profondeur,
      // cohérent avec l'esprit de forbidMarketId ci-dessous.
      display_market_code:      Joi.string().valid('KM', 'YT', 'CM', 'CG').allow(null),
      market_id:                 forbidMarketId,
    }),
  },
  updateStatus: {
    params: Joi.object({ id: uuid.required() }),
    body: Joi.object({ status: safeStr(30).required(), note: safeStr(500), market_id: forbidMarketId }),
  },
  updateCost: {
    params: Joi.object({ id: uuid.required() }),
    body: Joi.object({
      cost_real_kmf:        posNum.required(),
      customs_real_kmf:     posNum,
      customs_agent_id:     uuid,
      customs_notes:        safeStr(500),
      sh_category:          safeStr(50),
      supplier_name:        safeStr(200),
      supplier_invoice_url: url,
      market_id:            forbidMarketId,
    }),
  },
  cancelOrder: {
    params: Joi.object({ id: uuid.required() }),
    body: Joi.object({ reason: safeStr(500) }),
  },
  markAvailability: {
    params: Joi.object({ id: uuid.required() }),
    body: Joi.object({
      items: Joi.array().items(Joi.object({
        order_item_id: uuid.required(),
        status: Joi.string().valid('available', 'delayed', 'backorder').required(),
        reason: safeStr(500),
        estimated_available_at: isoDate,
      })).min(1).required(),
    }),
  },
  partialShip: {
    params: Joi.object({ id: uuid.required() }),
    body: Joi.object({
      available_items: Joi.array().items(Joi.object({
        order_item_id: uuid.required(),
        quantity: posInt.max(1000).required(),
      })).min(1).required(),
      notes: safeStr(1000),
    }),
  },
  parcelStatus: {
    params: Joi.object({ parcelId: uuid.required() }),
    body: Joi.object({
      status: Joi.string().valid(
        'draft', 'preparation', 'shipped', 'in_transit', 'arrived', 'available', 'collected', 'cancelled'
      ).required(),
      note: safeStr(500),
      tracking_ref: safeStr(100),
    }),
  },
  cancelBackorder: {
    params: Joi.object({ id: uuid.required() }),
    body: Joi.object({
      parcel_id: uuid.optional(), sub_order_id: uuid.optional(),
      reason: safeStr(500),
    }).or('parcel_id', 'sub_order_id'),
  },
};

const payments = {
  stripeIntent: { body: Joi.object({ order_reference: safeStr(50).required() }) },
  cashConfirm: { body: Joi.object({ cash_ref_code: safeStr(50).required() }) },
};

const VALID_PARTNER_TYPES = ['relais', 'agent_hub', 'sourcing', 'personnalise', 'logistique'];
const VALID_CURRENCIES    = ['KMF', 'EUR', 'USD', 'AED', 'CNY'];
const VALID_ISLANDS       = ['Grande Comore', 'Anjouan', 'Mohéli', 'Mayotte'];

const admin = {
  createPartner: {
    body: Joi.object({
      name:           safeStr(200).required(),
      partner_type:   Joi.string().valid(...VALID_PARTNER_TYPES).required(),
      contact_name:   safeStr(100).allow('', null),
      contact_phone:  Joi.alternatives().try(phone, Joi.string().allow('', null)),
      contact_email:  Joi.alternatives().try(email, Joi.string().allow('', null)),
      whatsapp_url:   safeStr(500).allow('', null),
      website_url:    safeStr(500).allow('', null),
      address:        safeStr(500).allow('', null),
      island:         Joi.string().valid(...VALID_ISLANDS).allow('', null),
      zone:           safeStr(100).allow('', null),
      country_code:   safeStr(5).allow('', null),
      country_label:  safeStr(100).allow('', null),
      currency:        Joi.string().valid(...VALID_CURRENCIES).allow('', null),
      lead_time_days:  Joi.number().integer().min(0).max(365).allow(null),
      payment_terms:   safeStr(500).allow('', null),
      commission_kmf:  Joi.number().integer().min(0).allow(null),
      product_categories: Joi.array().items(safeStr(100)).max(20),
      pricing_notes:   safeStr(1000).allow('', null),
      rating:          Joi.number().integer().min(1).max(5).allow(null),
      notes:           safeStr(2000).allow('', null),
      is_active:       Joi.boolean().default(true),
    }),
  },
  updatePartner: {
    params: Joi.object({ id: uuid.required() }),
    body: Joi.object({
      name:           safeStr(200),
      partner_type:   Joi.string().valid(...VALID_PARTNER_TYPES),
      contact_name:   safeStr(100).allow('', null),
      contact_phone:  Joi.alternatives().try(phone, Joi.string().allow('', null)),
      contact_email:  Joi.alternatives().try(email, Joi.string().allow('', null)),
      whatsapp_url:   safeStr(500).allow('', null),
      website_url:    safeStr(500).allow('', null),
      address:        safeStr(500).allow('', null),
      island:         Joi.string().valid(...VALID_ISLANDS).allow('', null),
      zone:           safeStr(100).allow('', null),
      country_code:   safeStr(5).allow('', null),
      country_label:  safeStr(100).allow('', null),
      currency:       Joi.string().valid(...VALID_CURRENCIES).allow('', null),
      lead_time_days: Joi.number().integer().min(0).max(365).allow(null),
      payment_terms:  safeStr(500).allow('', null),
      commission_kmf: Joi.number().integer().min(0).allow(null),
      product_categories: Joi.array().items(safeStr(100)).max(20),
      pricing_notes:  safeStr(1000).allow('', null),
      rating:         Joi.number().integer().min(1).max(5).allow(null),
      notes:          safeStr(2000).allow('', null),
      is_active:      Joi.boolean(),
    }).min(1),
  },
  deletePartner: { params: Joi.object({ id: uuid.required() }) },
  reset: { body: Joi.object({ mode: Joi.string().valid('orders', 'users', 'factory').default('orders'), confirm: Joi.boolean().valid(true).required() }) },
  seedTest: { body: Joi.object({ confirm: Joi.boolean().valid(true).required(), months: Joi.number().integer().min(1).max(24).default(3) }) },
};

const baskets = {
  share: { body: Joi.object({ items: Joi.array().items(Joi.object({ product_id: uuid.required(), quantity: posInt.max(100).default(1) })).min(1).required(), creator_name: safeStr(100) }) },
  updateBasket: { params: Joi.object({ code: safeStr(50).required() }), body: Joi.object({ add: Joi.array().items(Joi.object({ product_id: uuid.required(), quantity: posInt.max(100).default(1) })).default([]), remove: Joi.array().items(uuid).default([]), update_qty: Joi.object().pattern(uuid, posInt.max(100)).default({}) }) },
  gift: { body: Joi.object({ items: Joi.array().items(Joi.object({ product_id: uuid.required(), quantity: posInt.max(100).default(1) })).min(1).required(), recipient_phone: phone.required(), recipient_name: safeStr(100).required() }) },
  giftConfirm: { params: Joi.object({ code: safeStr(50).required() }), body: Joi.object({ recipient_phone: phone, recipient_name: safeStr(100), relais_name: safeStr(100), order_reference: safeStr(50) }) },
};

// Secret de retrait canonique (Lot 2C) : 8 caractères utiles dans
// l'alphabet sans ambiguïté visuelle (pas de 0/O/I/1/l — cohérent avec
// services/pickup-secret-service.js::CODE_ALPHABET). Tirets/espaces de
// présentation ("A7K-3M9-P2") sont acceptés mais retirés avant contrôle de
// longueur. Refuse explicitement les anciens codes numériques à 6 chiffres
// et toute recherche aveugle à 4 caractères (last4 seul n'est jamais une
// preuve suffisante — voir /api/scans/collect).
const PICKUP_CODE_ALPHABET_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;
const pickupCodeFull = Joi.string().trim().max(40).custom((value, helpers) => {
  const normalized = String(value || '').replace(/[-\s]/g, '').toUpperCase();
  if (normalized.length !== 8) {
    return helpers.error('pickupCode.length');
  }
  if (!PICKUP_CODE_ALPHABET_RE.test(normalized)) {
    return helpers.error('pickupCode.alphabet');
  }
  return value;
}, 'pickup code format (8 caractères canoniques)').messages({
  'pickupCode.length':   'Code attendu : 8 caractères complets (tirets/espaces de présentation autorisés)',
  'pickupCode.alphabet': 'Code invalide : caractères non reconnus',
});

const scans = {
  create: { body: Joi.object({ scan_code: safeStr(200).required(), step: Joi.string().valid('preparation', 'shipped', 'in_transit', 'relais_received').required(), location: safeStr(200), notes: safeStr(500), is_anomaly: Joi.boolean().default(false), latitude: Joi.number().min(-90).max(90), longitude: Joi.number().min(-180).max(180) }) },
  collect: { body: Joi.object({ pickup_code: pickupCodeFull.required() }) },
  hubReceive: { body: Joi.object({ qr_code: safeStr(200).required(), po_id: uuid }) },
  verifyQr: { body: Joi.object({ token: safeStr(500).required(), order_id: uuid }) },
};

const pickup = {
  exceptionalAvailability: {
    params: Joi.object({
      orderId: uuid.required(),
    }),
  },

  exceptionalCollect: {
    params: Joi.object({
      orderId: uuid.required(),
    }),

    body: Joi.object({
      given_names: safeStr(100).min(1).required(),
      family_name: safeStr(100).min(1).required(),

      // .strict() interdit la conversion automatique des chaînes
      // "true"/"false" en booléens.
      document_checked: Joi.boolean().strict().valid(true).required(),
    }),
  },
};

const modules = {
  calculatePrice: { body: Joi.object({ module_type: Joi.string().valid(...MODULE_TYPES).required(), fabric_id: uuid, fabric_type: safeStr(100), model_id: uuid, size: safeStr(20), qty_meters: posNum.max(1000), retouche: Joi.boolean().default(false), confection_type: Joi.string().valid(...CONFECTION_TYPES), accessories: Joi.array().items(safeStr(100)).max(10), quantity: posInt.max(100).default(1) }) },
  createFabric: { body: Joi.object({ name: safeStr(200).required(), type: safeStr(100).required(), price_per_m: posNum.required(), color: safeStr(50), origin: safeStr(50), stock_meters: Joi.number().min(0).max(99999), is_active: Joi.boolean().default(true) }) },
  createModel: { body: Joi.object({ name: safeStr(200).required(), category: safeStr(100).required(), base_price: posNum.required(), description: safeStr(1000), fabric_meters_required: posNum.max(100), image_url: url, is_active: Joi.boolean().default(true) }) },
};

const logistics = {
  createShipment: { body: Joi.object({ carrier: safeStr(100).required(), container_ref: safeStr(100), departed_at: isoDate, eta: isoDate, notes: safeStr(500) }) },
  updateShipment: { params: Joi.object({ id: uuid.required() }), body: Joi.object({ carrier: safeStr(100), container_ref: safeStr(100), departed_at: isoDate, eta: isoDate, arrived_at: isoDate, customs_cleared_at: isoDate, notes: safeStr(500) }).min(1) },
};

const config = {
  updateRule: { params: Joi.object({ key: safeStr(100).required() }), body: Joi.object({ value: Joi.alternatives().try(Joi.number(), Joi.boolean(), Joi.string().trim().max(255)).required(), reason: safeStr(500) }) },
};

const parcels = {
  list: Joi.object({ status: Joi.string().optional(), shipment_id: Joi.string().uuid().optional(), order_id: Joi.string().uuid().optional(), search: Joi.string().max(100).optional(), page: Joi.number().integer().min(1).default(1), limit: Joi.number().integer().min(1).max(100).default(50) }),
  create: Joi.object({ order_id: Joi.string().uuid().required(), type: Joi.string().valid('standard', 'fragile', 'volumineux', 'sur_mesure').default('standard'), notes: Joi.string().max(500).optional(), weight_kg: posNum.optional() }),
  updateStatus: Joi.object({ status: Joi.string().valid('preparation', 'shipped', 'in_transit', 'available', 'collected').required(), notes: Joi.string().max(500).optional() }),
  addItem: Joi.object({ order_item_id: Joi.string().uuid().required(), quantity: Joi.number().integer().min(1).required() }),
};

const hub = {
  scan: Joi.object({ parcel_ref: Joi.string().required(), notes: Joi.string().max(500).optional() }),
  pack: Joi.object({ parcel_id: Joi.string().uuid().required(), box_label: Joi.string().max(50).optional(), notes: Joi.string().max(500).optional() }),
  seal: Joi.object({ parcel_id: Joi.string().uuid().required(), notes: Joi.string().max(500).optional() }),
  // V-4 densité de valeur : saisie mesure volume (au moins une des deux)
  volume: Joi.object({
    product_id: Joi.string().uuid().required(),
    volume_cm3: Joi.number().positive().max(1000000),
    repack_volume_cm3: Joi.number().positive().max(1000000),
  }).or('volume_cm3', 'repack_volume_cm3'),
  // Q-1 non-conformité : photo de scellé (le fichier est validé par upload-hub)
  photo: Joi.object({
    parcel_id: Joi.string().uuid().required(),
    notes: Joi.string().max(500).allow('', null),
  }),
};

const loyalty = {
  updateTier: { params: Joi.object({ id: uuid.required() }), body: Joi.object({ label: safeStr(50), badge: safeStr(10), min_orders: Joi.number().integer().min(0).max(10000), discount_pct: Joi.number().min(0).max(100) }).min(1) },
  recalculate: { params: Joi.object({ user_id: uuid.required() }) },
};

const pricing = {
  calculate: { body: Joi.object({ product_id: uuid.required(), qty: posInt.max(1000).default(1), is_diaspora: Joi.boolean().default(false), relais_type: Joi.string().valid('standard', 'express', 'hub').default('standard') }) },
  couture: { body: Joi.object({ fabric_id: uuid.required(), model_id: uuid.required(), qty: posInt.max(100).default(1), is_diaspora: Joi.boolean().default(false) }) },
  updateRates: { body: Joi.object({ eur_kmf: posNum.min(1).max(10000).required(), aed_kmf: posNum.min(1).max(10000).required() }) },
};

const PLATFORMS = ['noon', 'amazon_uae', 'aliexpress', 'whatsapp', 'manual', 'local'];
const purchasing = {
  createSupplier: { body: Joi.object({ name: safeStr(200).required(), platform: Joi.string().valid(...PLATFORMS).required(), contact_name: safeStr(100), contact_phone: phone, contact_email: email, api_key_enc: safeStr(500), api_secret_enc: safeStr(500), account_id: safeStr(100), auto_order: Joi.boolean().default(false), lead_time_days: Joi.number().integer().min(0).max(365).default(2), notes: safeStr(1000) }) },
  mapProduct: { params: Joi.object({ id: uuid.required() }), body: Joi.object({ product_id: uuid.required(), supplier_sku: safeStr(200).required(), supplier_url: url, supplier_price_aed: posNum.required(), min_order_qty: posInt.default(1), priority: Joi.number().integer().min(1).max(100).default(1), notes: safeStr(1000) }) },
  confirmOrder: { params: Joi.object({ order_id: uuid.required() }), body: Joi.object({ purchase_order_id: uuid.required(), supplier_order_id: safeStr(200), unit_price_aed: posNum, tracking_url: url, tracking_number: safeStr(100), notes: safeStr(1000) }) },
  receive: { params: Joi.object({ id: uuid.required() }), body: Joi.object({ qty_recue: Joi.number().integer().min(0).max(10000) }) },
};

const UNSOLD_STATUSES = ['sold_whatsapp', 'sold_reseller', 'donated', 'destroyed'];
const UNSOLD_CHANNELS = ['whatsapp', 'reseller', 'both'];
const unsold = {
  update: { params: Joi.object({ id: uuid.required() }), body: Joi.object({ unsold_price_kmf: posNum, channel: Joi.string().valid(...UNSOLD_CHANNELS), notes: safeStr(1000) }).min(1) },
  resolve: { params: Joi.object({ id: uuid.required() }), body: Joi.object({ status: Joi.string().valid(...UNSOLD_STATUSES).required(), resolved_price_kmf: Joi.number().min(0), reseller_id: uuid, notes: safeStr(1000) }) },
};

const finance = {
  periodQuery: { query: Joi.object({ month: Joi.number().integer().min(1).max(12), year: Joi.number().integer().min(2024).max(2099) }) },
};

module.exports = {
  forbidMarketId,
  auth,
  products,
  orders,
  payments,
  admin,
  baskets,
  scans,
  pickup,
  modules,
  logistics,
  config,
  parcels,
  hub,
  loyalty,
  pricing,
  purchasing,
  unsold,
  finance,
};
