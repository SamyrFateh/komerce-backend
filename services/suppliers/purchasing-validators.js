/**
 * @komerce-arch
 * @role          purchasing-validators
 * @domain        purchasing
 * @layer         service
 * @criticality   medium
 * @inputs        request body/params for supplier + purchase order endpoints
 * @outputs       Joi validation schemas
 * @depends       services/suppliers/provider-authority.js
 * @used-by       (see files.tests in features/purchasing.feature.js — not yet
 *                 wired to routes/purchasing.js, which validates inline)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/gaps/GAP_SUPPLIER_CONNECTIVITY_ALIGNMENT.md
 * @impact-areas  purchasing
 * @version       2026-09
 *
 * Schémas Joi pour les endpoints purchasing (createSupplier, mapProduct,
 * confirmOrder, receive). Précédemment déclarés dans validators/index.js
 * (barrel partagé @domain infrastructure).
 *
 * Déplacés ici (GAP-1) parce que ce bloc importe provider-authority.js,
 * l'autorité canonique des providers supportés (@domain purchasing). Un
 * barrel infrastructure ne doit jamais importer un fichier de domaine
 * métier — c'est exactement l'invariant que le Feature Slice Guard /
 * ratchet OBSERVED-UNDECLARED-FEATURE-DEPENDENCY fait respecter, et que
 * ce repo a délibérément verrouillé à zéro ("Debt Zero absolute", cf.
 * governance/business-graph-drift-baseline.json). La bonne frontière est
 * donc : purchasing possède sa propre validation, y compris sa liste de
 * providers — pas l'inverse.
 *
 * Primitives Joi dupliquées depuis validators/index.js plutôt qu'importées :
 * ce sont des builders déclaratifs sans état, la duplication n'a aucun
 * risque comportemental et évite d'élargir la surface exportée du barrel
 * partagé pour ce seul besoin.
 */
'use strict';

const Joi = require('joi');
const { PROVIDERS: PLATFORMS } = require('./provider-authority');

const uuid    = Joi.string().uuid();
const safeStr = (max = 255) => Joi.string().trim().max(max);
const email   = Joi.string().trim().lowercase().email();
const phone   = Joi.string().trim().pattern(/^\+?[0-9\s\-().]{6,20}$/).message('Numéro de téléphone invalide');
const posInt  = Joi.number().integer().positive();
const posNum  = Joi.number().positive();
const url     = Joi.string().trim().uri({ scheme: ['http', 'https'] });

const purchasing = {
  createSupplier: { body: Joi.object({ name: safeStr(200).required(), platform: Joi.string().valid(...PLATFORMS).required(), contact_name: safeStr(100), contact_phone: phone, contact_email: email, api_key_enc: safeStr(500), api_secret_enc: safeStr(500), account_id: safeStr(100), auto_order: Joi.boolean().default(false), lead_time_days: Joi.number().integer().min(0).max(365).default(2), notes: safeStr(1000) }) },
  mapProduct: { params: Joi.object({ id: uuid.required() }), body: Joi.object({ product_id: uuid.required(), supplier_sku: safeStr(200).required(), supplier_url: url, supplier_price_aed: posNum.required(), min_order_qty: posInt.default(1), priority: Joi.number().integer().min(1).max(100).default(1), notes: safeStr(1000) }) },
  confirmOrder: { params: Joi.object({ order_id: uuid.required() }), body: Joi.object({ purchase_order_id: uuid.required(), supplier_order_id: safeStr(200), unit_price_aed: posNum, tracking_url: url, tracking_number: safeStr(100), notes: safeStr(1000) }) },
  receive: { params: Joi.object({ id: uuid.required() }), body: Joi.object({ qty_recue: Joi.number().integer().min(0).max(10000) }) },
};

module.exports = { purchasing };
