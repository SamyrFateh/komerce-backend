/**
 * @komerce-arch
 * @role          product-media-storage
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        validated_product_image_buffer, product_id
 * @outputs       durable_https_image_url, provider_file_id
 * @depends       ImageKit upload API, IMAGEKIT_PRIVATE_KEY
 * @used-by       routes/products.js
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @doctrine      resolve_before_behavior_change, produit_reference_stable
 * @version       2026-11
 */
'use strict';

const crypto = require('crypto');
const path = require('path');

const UPLOAD_URL = 'https://upload.imagekit.io/api/v1/files/upload';
const FILES_URL = 'https://api.imagekit.io/v1/files';
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;

function authHeader(privateKey) {
  return `Basic ${Buffer.from(`${privateKey}:`, 'utf8').toString('base64')}`;
}

function imageKitPrivateKey(env = process.env) {
  const value = String(env.IMAGEKIT_PRIVATE_KEY || '').trim();
  if (!value) {
    const error = new Error('Le stockage image persistant est indisponible.');
    error.status = 503;
    error.code = 'PRODUCT_MEDIA_PROVIDER_UNAVAILABLE';
    throw error;
  }
  return value;
}

function safeExtension(originalname) {
  const ext = path.extname(String(originalname || '')).toLowerCase();
  return new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']).has(ext) ? ext : '.jpg';
}

function retryDelay(response, attempt) {
  const value = response?.headers?.get?.('retry-after');
  const seconds = Number(value);
  if (value && Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5000);
  return 250 * (attempt + 1);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function requestWithRetry(url, options, { fetchImpl = globalThis.fetch, sleepImpl = sleep, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch indisponible pour le stockage image.');
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
      lastError = error;
      clearTimeout(timer);
      if (attempt + 1 >= MAX_ATTEMPTS) throw error;
      await sleepImpl(250 * (attempt + 1));
      continue;
    }
    clearTimeout(timer);
    if (response.status !== 429 && response.status < 500) return response;
    lastError = new Error(`ImageKit indisponible (${response.status}).`);
    if (attempt + 1 >= MAX_ATTEMPTS) return response;
    await sleepImpl(retryDelay(response, attempt));
  }
  throw lastError || new Error('ImageKit upload échoué.');
}

async function uploadProductImage(file, productId, options = {}) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new TypeError('Le fichier image validé est requis.');
  }
  const privateKey = imageKitPrivateKey(options.env);
  const filename = `${crypto.randomUUID()}${safeExtension(file.originalname)}`;
  const form = new FormData();
  form.set('file', new Blob([file.buffer], { type: file.detectedMimeType || 'application/octet-stream' }), filename);
  form.set('fileName', filename);
  form.set('folder', `/komerce/products/${String(productId)}`);
  form.set('useUniqueFileName', 'false');

  const response = await requestWithRetry(UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: authHeader(privateKey) },
    body: form,
  }, options);
  const body = await response.json().catch(() => ({}));
  let url;
  try { url = new URL(body.url); } catch { url = null; }
  if (!response.ok || !url || url.protocol !== 'https:' || !body.fileId) {
    const error = new Error(`ImageKit upload échoué (${response.status}).`);
    error.status = 502;
    error.code = 'PRODUCT_MEDIA_UPLOAD_FAILED';
    throw error;
  }
  return { url: url.toString(), fileId: String(body.fileId) };
}

async function deleteProductImage(fileId, options = {}) {
  if (!fileId) return false;
  const privateKey = imageKitPrivateKey(options.env);
  const response = await requestWithRetry(`${FILES_URL}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: authHeader(privateKey) },
  }, options);
  if (response.status === 404) return true;
  if (!response.ok) throw new Error(`ImageKit cleanup échoué (${response.status}).`);
  return true;
}

module.exports = { uploadProductImage, deleteProductImage, authHeader, safeExtension };
