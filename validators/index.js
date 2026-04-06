/**
 * KOMERCE — Schémas de validation Joi
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
 */

'use strict';

const Joi = require('joi');

// ── Helpers réutilisables ────────────────────────────────────────────────────────

const uuid     = Joi.string().uuid();
const safeStr  = (max = 255) => Joi.string().trim().max(max);
const email    = Joi.string().trim().lowercase().email();
const phone    = Joi.string().trim().pattern(/^\+?[0-9\s\-().]{6,20}$/).message('Numéro de téléphone invalide');
const posInt   = Joi.number().integer().positive();
const posNum   = Joi.number().positive();
const isoDate  = Joi.string().isoDate();
const url      = Joi.string().trim().uri({ scheme: ['http', 'https'] });

// ── Schémas : auth.js ───────────────────────────────────────────────────────────

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
    body: Joi.object({
      full_name:     safeStr(100),
      phone:         phone,
      currency_pref: Joi.string().valid('KMF', 'EUR'),
    }).min(1),
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

  ordersByPhone: {
    body: Joi.object({
      phone: phone.required(),
    }),
  },

  adminReset: {
    body: Joi.object({
      key:          safeStr(128).required(),
      new_password: safeStr(128).min(8).required(),
    }),
  },
};

// ── Schémas : products.js ───────────────────────────────────────────────────────

const products = {
  create: {
    body: Joi.object({
      name:        safeStr(200).required(),
      description: safeStr(2000),
      category:    safeStr(100).required(),
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
    }),
  },

  update: {
    params: Joi.object({ id: uuid.required() }),
    body: Joi.object({
      name:        safeStr(200),
      description: safeStr(2000),
      category:    safeStr(100),
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
    }).min(1),
  },

  delete: {
    params: Joi.object({ id: uuid.required() }),
  },
};

// ── Schémas : orders.js ─────────────────────────────────────────────────────────

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
        module_type:       Joi.string().valid(...MODULE_TYPES),
        module_fabric_id:  uuid,
        module_fabric_type: safeStr(100),
        module_size:       safeStr(20),
        module_retouche:   Joi.boolean(),
        module_qty_meters: posNum.max(1000),
        module_accessories: Joi.array().items(safeStr(100)).max(10),
      })).min(1).required(),
      relais_id:             uuid,
      payment_mode:          Joi.string().valid('stripe_eur', 'cash_relais').required(),
      stripe_payment_intent: safeStr(200),
      recipient_name:        safeStr(100),
      recipient_phone:       phone,
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
    }),
  },

  updateStatus: {
    params: Joi.object({ id: uuid.required() }),
    body: Joi.object({
      status: safeStr(30).required(),
      note:   safeStr(500),
    }),
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
    }),
  },

  cancelOrder: {
    params: Joi.object({ id: uuid.required() }),
    body: Joi.object({
      reason: safeStr(500),
    }),
  },
};

// ── Schémas : payments.js ───────────────────────────────────────────────────────

const payments = {
  stripeIntent: {
    body: Joi.object({
      order_reference: safeStr(50).required(),
    }),
  },

  cashConfirm: {
    body: Joi.object({
      cash_ref_code: safeStr(50).required(),
    }),
  },
};

// ── Schémas : admin.js ──────────────────────────────────────────────────────────

const admin = {
  createPartner: {
    body: Joi.object({
      company_name:  safeStr(200).required(),
      contact_name:  safeStr(100),
      contact_email: email,
      contact_phone: phone,
      category:      safeStr(100),
      country:       safeStr(50),
      commission_pct: Joi.number().min(0).max(100),
      notes:         safeStr(1000),
    }),
  },

  updatePartner: {
    params: Joi.object({ id: uuid.required() }),
    body: Joi.object({
      company_name:  safeStr(200),
      contact_name:  safeStr(100),
      contact_email: email,
      contact_phone: phone,
      category:      safeStr(100),
      country:       safeStr(50),
      commission_pct: Joi.number().min(0).max(100),
      notes:         safeStr(1000),
      is_active:     Joi.boolean(),
    }).min(1),
  },

  reset: {
    body: Joi.object({
      mode: Joi.string().valid('orders', 'users', 'factory').default('orders'),
    }),
  },

  seedTest: {
    body: Joi.object({
      confirm: Joi.boolean().valid(true).required(),
      months:  Joi.number().integer().min(1).max(24).default(3),
    }),
  },
};

// ── Schémas : baskets.js ────────────────────────────────────────────────────────

const baskets = {
  share: {
    body: Joi.object({
      items: Joi.array().items(Joi.object({
        product_id: uuid.required(),
        quantity:   posInt.max(100).default(1),
      })).min(1).required(),
      creator_name: safeStr(100),
    }),
  },

  updateBasket: {
    params: Joi.object({ code: safeStr(50).required() }),
    body: Joi.object({
      add:        Joi.array().items(Joi.object({
        product_id: uuid.required(),
        quantity:   posInt.max(100).default(1),
      })).default([]),
      remove:     Joi.array().items(uuid).default([]),
      update_qty: Joi.object().pattern(uuid, posInt.max(100)).default({}),
    }),
  },

  gift: {
    body: Joi.object({
      items:           Joi.array().items(Joi.object({
        product_id: uuid.required(),
        quantity:   posInt.max(100).default(1),
      })).min(1).required(),
      recipient_phone: phone.required(),
      recipient_name:  safeStr(100).required(),
    }),
  },

  giftConfirm: {
    params: Joi.object({ code: safeStr(50).required() }),
    body: Joi.object({
      recipient_phone: phone,
      recipient_name:  safeStr(100),
      relais_name:     safeStr(100),
      order_reference: safeStr(50),
    }),
  },
};

// ── Schémas : scans.js ──────────────────────────────────────────────────────────

const scans = {
  create: {
    body: Joi.object({
      scan_code:  safeStr(200).required(),
      step:       Joi.string().valid(
        'preparation', 'shipped', 'relais_received', 'collected'
      ).required(),
      location:   safeStr(200),
      notes:      safeStr(500),
      is_anomaly: Joi.boolean().default(false),
      latitude:   Joi.number().min(-90).max(90),
      longitude:  Joi.number().min(-180).max(180),
    }),
  },

  collect: {
    body: Joi.object({
      pickup_code: safeStr(20).required(),
    }),
  },

  hubReceive: {
    body: Joi.object({
      qr_code: safeStr(200).required(),
      po_id:   uuid,
    }),
  },

  verifyQr: {
    body: Joi.object({
      token:    safeStr(500).required(),
      order_id: uuid.required(),
    }),
  },
};

// ── Schémas : modules.js ────────────────────────────────────────────────────────

const modules = {
  calculatePrice: {
    body: Joi.object({
      module_type:       Joi.string().valid(...MODULE_TYPES).required(),
      fabric_id:         uuid,
      fabric_type:       safeStr(100),
      model_id:          uuid,
      size:              safeStr(20),
      qty_meters:        posNum.max(1000),
      retouche:          Joi.boolean().default(false),
      confection_type:   Joi.string().valid(...CONFECTION_TYPES),
      accessories:       Joi.array().items(safeStr(100)).max(10),
      quantity:          posInt.max(100).default(1),
    }),
  },

  createFabric: {
    body: Joi.object({
      name:        safeStr(200).required(),
      type:        safeStr(100).required(),
      price_per_m: posNum.required(),
      color:       safeStr(50),
      origin:      safeStr(50),
      stock_meters: Joi.number().min(0).max(99999),
      is_active:   Joi.boolean().default(true),
    }),
  },

  createModel: {
    body: Joi.object({
      name:        safeStr(200).required(),
      category:    safeStr(100).required(),
      base_price:  posNum.required(),
      description: safeStr(1000),
      fabric_meters_required: posNum.max(100),
      image_url:   url,
      is_active:   Joi.boolean().default(true),
    }),
  },
};

// ── Schémas : logistics.js ──────────────────────────────────────────────────────

const logistics = {
  createShipment: {
    body: Joi.object({
      carrier:       safeStr(100).required(),
      container_ref: safeStr(100),
      departed_at:   isoDate,
      eta:           isoDate,
      notes:         safeStr(500),
    }),
  },

  updateShipment: {
    params: Joi.object({ id: uuid.required() }),
    body: Joi.object({
      carrier:            safeStr(100),
      container_ref:      safeStr(100),
      departed_at:        isoDate,
      eta:                isoDate,
      arrived_at:         isoDate,
      customs_cleared_at: isoDate,
      notes:              safeStr(500),
    }).min(1),
  },
};

// ── Schémas : config.js (règles métier admin) ───────────────────────────────────

const config = {
  updateRule: {
    params: Joi.object({ key: safeStr(100).required() }),
    body: Joi.object({
      value:  Joi.alternatives().try(
        Joi.number(),
        Joi.boolean(),
        Joi.string().trim().max(255)
      ).required(),
      reason: safeStr(500),
    }),
  },
};

// ── Export ───────────────────────────────────────────────────────────────────────

module.exports = {
  auth,
  products,
  orders,
  payments,
  admin,
  baskets,
  scans,
  modules,
  logistics,
  config,
};
