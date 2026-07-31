/**
 * KOMERCE — Tests Unitaires: validators/index.js (V2.6)
 *
 * Couvre les schémas Joi critiques.
 *
 * validators/index.js exporte deux formes selon les domaines :
 *   - Joi schema direct : Joi.object(...)
 *   - route schema container : { body?, params?, query? }
 *
 * Les tests valident donc le body schema quand il existe, sinon le schema direct.
 *
 * Run: npx jest tests/unit/validators.test.js
 */

const validators = require('../../validators');

function bodySchema(schema) {
  return schema?.body || schema;
}

function canValidate(schema) {
  return typeof bodySchema(schema)?.validate === 'function';
}

function validate(schema, payload) {
  return bodySchema(schema).validate(payload);
}

// ═══════════════════════════════════════════════════════════════════════════════
// orders validators
// ═══════════════════════════════════════════════════════════════════════════════

describe('orders.create', () => {
  const schema = validators.orders?.create;
  const runTest = canValidate(schema) ? test : test.skip;

  runTest('accepts valid order', () => {
    const valid = {
      items: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 2 }],
      relais_id: '00000000-0000-0000-0000-000000000002',
      payment_mode: 'cash_relais',
      recipient_name: 'Ali Mohamed',
      recipient_phone: '+2693210001',
    };
    const { error } = validate(schema, valid);
    expect(error).toBeUndefined();
  });

  // PAY-01 — paypal_eur doit être accepté par le validateur
  runTest('accepts paypal_eur as payment_mode', () => {
    const valid = {
      items: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 1 }],
      relais_id: '00000000-0000-0000-0000-000000000002',
      payment_mode: 'paypal_eur',
      recipient_name: 'Ali Mohamed',
      recipient_phone: '+2693210001',
    };
    const { error } = validate(schema, valid);
    expect(error).toBeUndefined();
  });

  runTest('rejects unknown payment_mode', () => {
    const { error } = validate(schema, {
      items: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 1 }],
      relais_id: '00000000-0000-0000-0000-000000000002',
      payment_mode: 'bitcoin',
    });
    expect(error).toBeDefined();
  });

  runTest('rejects empty items', () => {
    const { error } = validate(schema, {
      items: [],
      relais_id: '00000000-0000-0000-0000-000000000002',
      payment_mode: 'cash_relais',
    });
    expect(error).toBeDefined();
  });

  runTest('rejects missing payment_mode', () => {
    const { error } = validate(schema, {
      items: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 1 }],
      relais_id: '00000000-0000-0000-0000-000000000002',
    });
    expect(error).toBeDefined();
  });
});

describe('orders.cancelOrder', () => {
  const schema = validators.orders?.cancelOrder;
  const runTest = canValidate(schema) ? test : test.skip;

  runTest('accepts valid cancel with reason', () => {
    const { error } = validate(schema, { reason: 'Client changed mind' });
    expect(error).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// auth validators
// ═══════════════════════════════════════════════════════════════════════════════

describe('auth.register', () => {
  const schema = validators.auth?.register;
  const runTest = canValidate(schema) ? test : test.skip;

  runTest('accepts valid registration', () => {
    const { error } = validate(schema, {
      full_name: 'Ali Mohamed',
      email: 'ali@test.com',
      password: 'Test1234',
      phone: '+2693210001',
    });
    expect(error).toBeUndefined();
  });

  runTest('rejects missing email', () => {
    const { error } = validate(schema, {
      full_name: 'Ali Mohamed',
      password: 'Test1234',
      phone: '+2693210001',
    });
    expect(error).toBeDefined();
  });

  runTest('rejects weak password (too short)', () => {
    const { error } = validate(schema, {
      full_name: 'Ali',
      email: 'ali@test.com',
      phone: '+2693210001',
      password: '123',
    });
    expect(error).toBeDefined();
  });
});

describe('auth.login', () => {
  const schema = validators.auth?.login;
  const runTest = canValidate(schema) ? test : test.skip;

  runTest('accepts valid login', () => {
    const { error } = validate(schema, {
      email: 'ali@test.com',
      password: 'Test1234',
    });
    expect(error).toBeUndefined();
  });

  runTest('rejects missing password', () => {
    const { error } = validate(schema, { email: 'ali@test.com' });
    expect(error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// scans validators
// ═══════════════════════════════════════════════════════════════════════════════

describe('scans.create', () => {
  const schema = validators.scans?.create;
  const runTest = canValidate(schema) ? test : test.skip;

  runTest('accepts valid scan', () => {
    const { error } = validate(schema, {
      scan_code: 'KOM-2026-0001',
      step: 'preparation',
    });
    expect(error).toBeUndefined();
  });

  runTest('rejects missing scan_code', () => {
    const { error } = validate(schema, { step: 'preparation' });
    expect(error).toBeDefined();
  });

  runTest('rejects invalid step', () => {
    const { error } = validate(schema, {
      scan_code: 'KOM-2026-0001',
      step: 'invalid_step',
    });
    expect(error).toBeDefined();
  });
});

describe('scans.collect', () => {
  const schema = validators.scans?.collect;
  const runTest = canValidate(schema) ? test : test.skip;

  runTest('accepts valid 8-character canonical pickup_code without separators', () => {
    const { error } = validate(schema, { pickup_code: 'A7K3M9P2' });
    expect(error).toBeUndefined();
  });

  runTest('accepts valid pickup_code with presentation dashes', () => {
    const { error } = validate(schema, { pickup_code: 'A7K-3M9-P2' });
    expect(error).toBeUndefined();
  });

  runTest('rejects legacy 6-digit pickup_code', () => {
    const { error } = validate(schema, { pickup_code: '123456' });
    expect(error).toBeDefined();
  });

  runTest('rejects 4-character blind-search pickup_code', () => {
    const { error } = validate(schema, { pickup_code: '3MP2' });
    expect(error).toBeDefined();
  });

  runTest('rejects missing pickup_code', () => {
    const { error } = validate(schema, {});
    expect(error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// hub validators
// ═══════════════════════════════════════════════════════════════════════════════

describe('hub.scan', () => {
  const schema = validators.hub?.scan;
  const runTest = canValidate(schema) ? test : test.skip;

  runTest('accepts valid parcel_ref', () => {
    const { error } = validate(schema, { parcel_ref: 'PCL-2026-0001' });
    expect(error).toBeUndefined();
  });

  runTest('rejects missing parcel_ref', () => {
    const { error } = validate(schema, {});
    expect(error).toBeDefined();
  });
});

describe('hub.pack', () => {
  const schema = validators.hub?.pack;
  const runTest = canValidate(schema) ? test : test.skip;

  runTest('accepts valid pack request', () => {
    const { error } = validate(schema, {
      parcel_id: '00000000-0000-0000-0000-000000000001',
    });
    expect(error).toBeUndefined();
  });
});

describe('hub.seal', () => {
  const schema = validators.hub?.seal;
  const runTest = canValidate(schema) ? test : test.skip;

  runTest('accepts valid seal request', () => {
    const { error } = validate(schema, {
      parcel_id: '00000000-0000-0000-0000-000000000001',
    });
    expect(error).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// admin validators
// ═══════════════════════════════════════════════════════════════════════════════

describe('admin.reset', () => {
  const schema = validators.admin?.reset;
  const runTest = canValidate(schema) ? test : test.skip;

  runTest('accepts valid reset mode', () => {
    const { error } = validate(schema, { mode: 'orders', confirm: true });
    expect(error).toBeUndefined();
  });

  runTest('rejects invalid mode', () => {
    const { error } = validate(schema, { mode: 'everything' });
    expect(error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Schema existence checks (meta-test)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Schema registry', () => {
  test('validators exports expected groups', () => {
    expect(validators.orders).toBeDefined();
    expect(validators.auth).toBeDefined();
    expect(validators.scans).toBeDefined();
    expect(validators.hub).toBeDefined();
    expect(validators.admin).toBeDefined();
  });

  test('critical schemas exist', () => {
    const critical = [
      ['orders', 'create'],
      ['auth', 'register'],
      ['auth', 'login'],
      ['scans', 'create'],
      ['hub', 'scan'],
    ];
    for (const [group, name] of critical) {
      expect(validators[group]?.[name]).toBeDefined();
    }
  });
});
