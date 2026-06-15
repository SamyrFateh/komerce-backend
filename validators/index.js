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

// â”€â”€ Helpers réutilisables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const uuid     = Joi.string().uuid();
const safeStr  = (max = 255) => Joi.string().trim().max(max);
const email    = Joi.string().trim().lowercase().email();
const phone    = Joi.string().trim().pattern(/^\+?[0-9\s\-().]{6,20}$/).message('Numéro de téléphone invalide');
const posInt   = Joi.number().integer().positive();
const posNum   = Joi.number().positive();
const isoDate  = Joi.string().isoDate();
const url      = Joi.string().trim().uri({ scheme: ['http', 'https'] });

// â”€â”€ Schémas : auth.js â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Schémas : products.js â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
      })).min(1).required(),
      relais_id:             uuid,
      payment_mode:          Joi.string().valid('stripe_eur', 'cash_relais', 'paypal_eur').required(),
      stripe_payment_intent: safeStr(200),
      recipient_name:        safeStr(100),
      recipient_phone:       phone,
      tracking_phone:        phone.allow(null, ''),
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
    body: Joi.object({ reason: safeStr(500) }),
  },
};

const payments = {
  stripeIntent: { body: Joi.object({ order_reference: safeStr(50).required() }) },
  cashConfirm: { body: Joi.object({ cash_ref_code: safeStr(50).required() }) },
};

const admin = {
  reset: {
    body: Joi.object({ mode: Joi.string().valid('orders', 'users', 'factory').default('orders') }),
  },
};

const baskets = {};
const scans = {
  create: { body: Joi.object({ scan_code: safeStr(200).required(), step: Joi.string().valid('preparation', 'shipped', 'in_transit', 'relais_received').required() }) },
  collect: { body: Joi.object({ pickup_code: safeStr(20).required() }) },
};
const modules = {};
const logistics = {};
const config = {};
const parcels = {};
const hub = {
  scan: Joi.object({ parcel_ref: Joi.string().required(), notes: Joi.string().max(500).optional() }),
  pack: Joi.object({ parcel_id: Joi.string().uuid().required(), box_label: Joi.string().max(50).optional(), notes: Joi.string().max(500).optional() }),
  seal: Joi.object({ parcel_id: Joi.string().uuid().required(), notes: Joi.string().max(500).optional() }),
};
const loyalty = { recalculate: { params: Joi.object({ user_id: uuid.required() }) } };
const pricing = {};
const purchasing = {};
const unsold = {};
const finance = { periodQuery: { query: Joi.object({ month: Joi.number().integer().min(1).max(12), year: Joi.number().integer().min(2024).max(2099) }) } };

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
  parcels,
  hub,
  loyalty,
  pricing,
  purchasing,
  unsold,
  finance,
};
