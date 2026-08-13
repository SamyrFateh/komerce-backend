'use strict';

/**
 * @komerce-arch
 * @role          staging-showcase-media-provider-contract
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        hosted_media_url, SHOWCASE_MEDIA_PROVIDER
 * @outputs       canonical_media_provider_verdict
 * @depends       none
 * @used-by       scripts/showcase-media-mirror.js, scripts/showcase-media-audit.js, scripts/showcase-v2-seed.js
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @doctrine      DOCTRINE_CATALOGUE.md, staging-only realistic fixtures
 * @version       2026-08-v1
 */

const CLOUDINARY_HOST = 'res.cloudinary.com';
const CLOUDINARY_CANONICAL_PATH = '/image/upload/';
const IMAGEKIT_HOST = 'ik.imagekit.io';
const PROVIDERS = Object.freeze(['cloudinary', 'imagekit']);

function resolveMediaProvider(value = process.env.SHOWCASE_MEDIA_PROVIDER || 'cloudinary') {
  const provider = String(value || '').trim().toLowerCase();
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`SHOWCASE_MEDIA_PROVIDER invalide: ${provider || '(vide)'}`);
  }
  return provider;
}

function isCanonicalCloudinaryUrl(value, namespace = null) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== CLOUDINARY_HOST || !url.pathname.includes(CLOUDINARY_CANONICAL_PATH)) {
      return false;
    }
    return !namespace || url.pathname.includes(`/komerce/staging/${namespace}/`);
  } catch {
    return false;
  }
}

function isCanonicalImageKitUrl(value, namespace = null) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== IMAGEKIT_HOST) return false;
    return !namespace || url.pathname.includes(`/komerce/staging/${namespace}/`);
  } catch {
    return false;
  }
}

function isCanonicalMediaUrl(value, provider = resolveMediaProvider(), namespace = null) {
  const resolved = resolveMediaProvider(provider);
  if (resolved === 'imagekit') return isCanonicalImageKitUrl(value, namespace);
  return isCanonicalCloudinaryUrl(value, namespace);
}

module.exports = {
  CLOUDINARY_HOST,
  IMAGEKIT_HOST,
  PROVIDERS,
  resolveMediaProvider,
  isCanonicalCloudinaryUrl,
  isCanonicalImageKitUrl,
  isCanonicalMediaUrl,
};
