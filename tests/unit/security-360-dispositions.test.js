'use strict';

const {
  ALLOWED_KINDS,
  DISPOSITIONS,
  getDisposition,
  validateDispositions,
} = require('../../scripts/security-360-dispositions');

describe('Security 360 route dispositions', () => {
  test('historical signal inventory is explicit and structurally valid', () => {
    expect(Object.keys(DISPOSITIONS)).toHaveLength(44);
    expect(validateDispositions()).toEqual([]);
    for (const [key, disposition] of Object.entries(DISPOSITIONS)) {
      expect(key).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \//);
      expect(ALLOWED_KINDS.has(disposition.kind)).toBe(true);
      expect(disposition.evidence.length).toBeGreaterThan(4);
      expect(disposition.rationale.length).toBeGreaterThan(19);
    }
  });

  test('sensitive public surfaces are never mislabeled as plain public by accident', () => {
    expect(getDisposition('POST /api/auth/admin-reset').kind).toBe('APPLICATION_GUARD');
    expect(getDisposition('POST /webhook/meta-whatsapp').kind).toBe('APPLICATION_GUARD');
    expect(getDisposition('GET /api/orders/retrait/{token}').kind).toBe('CAPABILITY_TOKEN');
    expect(getDisposition('POST /api/tracking/{token}/verify-pickup').kind).toBe('CAPABILITY_TOKEN');
    expect(getDisposition('POST /api/auth/otp/test-reset').kind).toBe('TEST_ONLY');
    expect(getDisposition('POST /api/auth/guest-checkout').kind).toBe('RETIRED');
  });

  test('an unlisted route has no implicit disposition', () => {
    expect(getDisposition('POST /api/future/public-mutation')).toBeNull();
  });
});
