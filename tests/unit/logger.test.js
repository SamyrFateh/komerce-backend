/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : utils/logger (Lot D4)
 *
 * pino est installé dans ce projet → la branche "try" (pino actif) est
 * exercée par défaut. NODE_ENV=test (Jest) ⇒ isDev=true, isTest=true ⇒
 * transport reste undefined ⇒ pino écrit en synchrone sur stdout, ce qui
 * permet d'intercepter process.stdout.write pour parser le JSON émis.
 *
 * La branche catch (pino non installé → fallback console) est exercée en
 * mockant require('pino') pour qu'il lève, avec jest.resetModules() pour
 * forcer une réévaluation du module logger.
 *
 * Run : npx jest tests/unit/logger.test.js
 */

'use strict';

function captureStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (chunk) => { chunks.push(chunk.toString()); return true; };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('utils/logger — pino actif (masquage PII + redact)', () => {
  let log;

  beforeAll(() => {
    jest.resetModules();
    log = require('../../utils/logger');
  });

  test('masque un numéro de téléphone (champ "phone")', () => {
    const [entry] = captureStdout(() => log.info({ phone: '+2690612345' }, 'test'));
    expect(entry.phone).toBe('+269•••45');
  });

  test('masque un email (champ "email")', () => {
    const [entry] = captureStdout(() => log.info({ email: 'sam@gmail.com' }, 'test'));
    expect(entry.email).toBe('s***@gmail.com');
  });

  test('masque les champs PII imbriqués (profondeur > 1)', () => {
    const [entry] = captureStdout(() =>
      log.info({ user: { phone: '+2690612345', name: 'Ali' } }, 'nested')
    );
    expect(entry.user.phone).toBe('+269•••45');
    expect(entry.user.name).toBe('Ali');
  });

  test('champ phone non-string → garde-fou typeof, laissé intact', () => {
    const [entry] = captureStdout(() => log.info({ phone: 12345 }, 'test'));
    expect(entry.phone).toBe(12345);
  });

  test('maskPhone : valeur trop courte (< 4 chars) → "•••"', () => {
    const [entry] = captureStdout(() => log.info({ phone: '12' }, 'test'));
    expect(entry.phone).toBe('•••');
  });

  test('maskEmail : valeur sans "@" → "•••"', () => {
    const [entry] = captureStdout(() => log.info({ email: 'not-an-email' }, 'test'));
    expect(entry.email).toBe('•••');
  });

  test('maskEmail : "@" en première position (indexOf < 1) → "•••"', () => {
    const [entry] = captureStdout(() => log.info({ email: '@gmail.com' }, 'test'));
    expect(entry.email).toBe('•••');
  });

  test('champ non-PII reste intact', () => {
    const [entry] = captureStdout(() => log.info({ orderId: 'order-1' }, 'test'));
    expect(entry.orderId).toBe('order-1');
  });

  test('serializer "req" : extrait method/url/id/ip uniquement', () => {
    const [entry] = captureStdout(() =>
      log.info({ req: { method: 'POST', url: '/api/orders', id: 'req-42', ip: '9.9.9.9', extra: 'ignored' } }, 'test')
    );
    expect(entry.req).toEqual({ method: 'POST', url: '/api/orders', id: 'req-42', ip: '9.9.9.9' });
  });

  test('serializer "res" : extrait statusCode uniquement', () => {
    const [entry] = captureStdout(() =>
      log.info({ res: { statusCode: 201, headers: { ignored: true } } }, 'test')
    );
    expect(entry.res).toEqual({ statusCode: 201 });
  });

  test('serializer "err" : sérialise une Error (stack/message présents)', () => {
    const [entry] = captureStdout(() => log.error({ err: new Error('boom') }, 'test'));
    expect(entry.err.message).toBe('boom');
    expect(entry.err.stack).toEqual(expect.any(String));
  });

  test('objet sans aucun champ PII → renvoyé sans copie (comportement observable via égalité de contenu)', () => {
    const [entry] = captureStdout(() => log.info({ a: 1, b: { c: 2 } }, 'test'));
    expect(entry.a).toBe(1);
    expect(entry.b.c).toBe(2);
  });

  test('redact : password/token/secret/creditCard → [REDACTED]', () => {
    const [entry] = captureStdout(() =>
      log.info({ password: 'x', token: 'y', secret: 'z', creditCard: '4111' }, 'test')
    );
    expect(entry.password).toBe('[REDACTED]');
    expect(entry.token).toBe('[REDACTED]');
    expect(entry.secret).toBe('[REDACTED]');
    expect(entry.creditCard).toBe('[REDACTED]');
  });

  test('redact : champs imbriqués via "*.password" etc.', () => {
    const [entry] = captureStdout(() =>
      log.info({ user: { password: 'x', token: 'y' } }, 'test')
    );
    expect(entry.user.password).toBe('[REDACTED]');
    expect(entry.user.token).toBe('[REDACTED]');
  });

  test('base fields service/env présents sur chaque entrée', () => {
    const [entry] = captureStdout(() => log.info('hello'));
    expect(entry.service).toBe('komerce-backend');
    expect(entry.env).toBe('test');
  });

  test('forModule ajoute le champ "module" au contexte du child logger', () => {
    const child = log.forModule('sms');
    const [entry] = captureStdout(() => child.info('ping'));
    expect(entry.module).toBe('sms');
  });

  test('forModule accepte un contexte supplémentaire fusionné', () => {
    const child = log.forModule('wallet', { userId: 'user-1' });
    const [entry] = captureStdout(() => child.info('ping'));
    expect(entry.module).toBe('wallet');
    expect(entry.userId).toBe('user-1');
  });

  test('child (alias legacy) fonctionne comme forModule', () => {
    const child = log.child({ module: 'orders' });
    const [entry] = captureStdout(() => child.info('ping'));
    expect(entry.module).toBe('orders');
  });
});

describe('utils/logger — httpLogger middleware', () => {
  let log;

  beforeAll(() => {
    jest.resetModules();
    log = require('../../utils/logger');
  });

  function makeReqRes(status, overrides = {}) {
    const handlers = {};
    const req = {
      method: 'GET',
      originalUrl: '/api/x',
      id: 'req-1',
      ip: '1.2.3.4',
      user: { id: 'user-1' },
      headers: {},
      ...overrides,
    };
    const res = { statusCode: status, on: jest.fn((event, fn) => { handlers[event] = fn; }) };
    return { req, res, handlers };
  }

  test('appelle next() immédiatement et log au "finish" avec method/url/status/duration_ms', () => {
    const { req, res, handlers } = makeReqRes(200);
    const next = jest.fn();

    const entries = captureStdout(() => {
      log.httpLogger(req, res, next);
      expect(next).toHaveBeenCalled();
      handlers.finish();
    });

    const entry = entries[0];
    expect(entry.method).toBe('GET');
    expect(entry.url).toBe('/api/x');
    expect(entry.status).toBe(200);
    expect(entry.duration_ms).toEqual(expect.any(Number));
    expect(entry.user_id).toBe('user-1');
    expect(entry.module).toBe('http');
  });

  test('status >= 500 → niveau error (50)', () => {
    const { req, res, handlers } = makeReqRes(500);
    const [entry] = captureStdout(() => { log.httpLogger(req, res, jest.fn()); handlers.finish(); });
    expect(entry.level).toBe(50);
  });

  test('status >= 400 (et < 500) → niveau warn (40)', () => {
    const { req, res, handlers } = makeReqRes(404);
    const [entry] = captureStdout(() => { log.httpLogger(req, res, jest.fn()); handlers.finish(); });
    expect(entry.level).toBe(40);
  });

  test('status < 400 → niveau info (30)', () => {
    const { req, res, handlers } = makeReqRes(200);
    const [entry] = captureStdout(() => { log.httpLogger(req, res, jest.fn()); handlers.finish(); });
    expect(entry.level).toBe(30);
  });

  test('req.id absent → fallback sur le header x-request-id', () => {
    const { req, res, handlers } = makeReqRes(200, { id: undefined, headers: { 'x-request-id': 'hdr-req-id' } });
    const [entry] = captureStdout(() => { log.httpLogger(req, res, jest.fn()); handlers.finish(); });
    expect(entry.request_id).toBe('hdr-req-id');
  });

  test('req.user absent → user_id à null (garde optional chaining)', () => {
    const { req, res, handlers } = makeReqRes(200, { user: undefined });
    const [entry] = captureStdout(() => { log.httpLogger(req, res, jest.fn()); handlers.finish(); });
    expect(entry.user_id).toBeNull();
  });
});

describe('utils/logger — fallback console (pino indisponible)', () => {
  afterEach(() => {
    jest.dontMock('pino');
    jest.restoreAllMocks();
  });

  test('require("pino") en échec → fallback console, pas de throw, warning émis', () => {
    jest.resetModules();
    jest.doMock('pino', () => { throw new Error('module not found'); });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy  = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});

    let log;
    expect(() => { log = require('../../utils/logger'); }).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pino not installed'));

    log.info('hello');
    expect(logSpy).toHaveBeenCalledWith('[komerce]', 'hello');

    log.warn('careful');
    expect(warnSpy).toHaveBeenCalledWith('[komerce]', 'careful');

    log.error('boom');
    expect(errSpy).toHaveBeenCalledWith('[komerce]', 'boom');

    log.fatal('dead');
    expect(errSpy).toHaveBeenCalledWith('💀', '[komerce]', 'dead');

    log.debug('verbose');
    expect(debugSpy).toHaveBeenCalledWith('[komerce]', 'verbose');

    log.trace('noop-branch'); // trace = noop, ne doit rien lever

    const child = log.child({ module: 'sms' });
    child.info('ping');
    expect(logSpy).toHaveBeenCalledWith('[sms]', 'ping');

    const grandchild = child.child({ extra: 'ctx' });
    grandchild.info('pong');
    expect(logSpy).toHaveBeenCalledWith('[sms]', 'pong');
  });

  test('httpLogger fonctionne aussi avec le logger de fallback (console)', () => {
    jest.resetModules();
    jest.doMock('pino', () => { throw new Error('module not found'); });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const log = require('../../utils/logger');
    const handlers = {};
    const req = { method: 'GET', originalUrl: '/x', headers: {} };
    const res = { statusCode: 200, on: jest.fn((event, fn) => { handlers[event] = fn; }) };
    const next = jest.fn();

    log.httpLogger(req, res, next);
    handlers.finish();

    expect(next).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[http]', expect.objectContaining({
      method: 'GET', url: '/x', status: 200,
    }), expect.stringContaining('GET /x → 200'));
  });
});
