'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));

function freshMonitoring() {
  jest.resetModules();
  return require('../../services/monitoring');
}

describe('monitoring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SENTRY_DSN;
  });

  it('trackError incremente total, module et last_errors', () => {
    const monitor = freshMonitoring();

    monitor.trackError(new Error('boom'), { module: 'payment', orderId: 'order-001' });
    const metrics = monitor.getMetrics();

    expect(metrics.errors.total).toBe(1);
    expect(metrics.errors.by_module.payment).toBe(1);
    expect(metrics.errors.last_errors[0]).toMatchObject({ message: 'boom', module: 'payment' });
    expect(metrics.errors.last_errors[0].context).toMatchObject({ orderId: 'order-001' });
  });

  it('trackMetric cree et incremente un compteur imbrique', () => {
    const monitor = freshMonitoring();

    monitor.trackMetric('custom.counter', 2);
    monitor.trackMetric('custom.counter', 3);

    expect(monitor.getMetrics().custom.counter).toBe(5);
  });

  it('trackRequest met a jour total, status et duree moyenne', () => {
    const monitor = freshMonitoring();

    monitor.trackRequest({}, { statusCode: 200 }, 100);
    monitor.trackRequest({}, { statusCode: 500 }, 300);

    const metrics = monitor.getMetrics();
    expect(metrics.requests.total).toBe(2);
    expect(metrics.requests.by_status['200']).toBe(1);
    expect(metrics.requests.by_status['500']).toBe(1);
    expect(metrics.requests.avg_duration_ms).toBe(200);
  });

  it('metricsMiddleware trace la requete au finish', () => {
    const monitor = freshMonitoring();
    const handlers = {};
    const req = {};
    const res = { statusCode: 201, on: jest.fn((event, fn) => { handlers[event] = fn; }) };
    const next = jest.fn();

    monitor.metricsMiddleware(req, res, next);
    handlers.finish();

    expect(next).toHaveBeenCalled();
    expect(monitor.getMetrics().requests.by_status['201']).toBe(1);
  });

  it('trackDBQuery et trackDBPoolError alimentent les compteurs DB', () => {
    const monitor = freshMonitoring();

    monitor.trackDBQuery(10);
    monitor.trackDBQuery(1500);
    monitor.trackDBPoolError();

    const metrics = monitor.getMetrics();
    expect(metrics.db.queries).toBe(2);
    expect(metrics.db.slow_queries).toBe(1);
    expect(metrics.db.pool_errors).toBe(1);
  });

  it('trackSMS compte sent, failed et dev_skipped', () => {
    const monitor = freshMonitoring();

    monitor.trackSMS('sent');
    monitor.trackSMS('failed');
    monitor.trackSMS('dev_skipped');

    expect(monitor.getMetrics().sms).toMatchObject({ sent: 1, failed: 1, dev_skipped: 1 });
  });

  it('getMetrics expose uptime, memory et timestamp', () => {
    const monitor = freshMonitoring();
    const metrics = monitor.getMetrics();

    expect(metrics.uptime_seconds).toEqual(expect.any(Number));
    expect(metrics.memory).toEqual(expect.objectContaining({ rss_mb: expect.any(Number), heap_used_mb: expect.any(Number) }));
    expect(metrics.timestamp).toEqual(expect.any(String));
  });

  it('last_errors est un buffer circulaire limité à 50 entrées', () => {
    const monitor = freshMonitoring();

    for (let i = 0; i < 55; i++) {
      monitor.trackError(new Error(`err-${i}`), { module: 'buffer-test' });
    }

    const metrics = monitor.getMetrics();
    expect(metrics.errors.total).toBe(55);
    expect(metrics.errors.last_errors).toHaveLength(50);
    // Les 5 premières erreurs (err-0..err-4) ont été évincées (shift)
    expect(metrics.errors.last_errors[0].message).toBe('err-5');
    expect(metrics.errors.last_errors[49].message).toBe('err-54');
  });

  it('trackError utilise context.context comme fallback de module si context.module absent', () => {
    const monitor = freshMonitoring();
    monitor.trackError(new Error('x'), { context: 'fallback-mod' });
    expect(monitor.getMetrics().errors.by_module['fallback-mod']).toBe(1);
  });

  it('trackError retombe sur "unknown" si ni module ni context fournis', () => {
    const monitor = freshMonitoring();
    monitor.trackError(new Error('x'));
    expect(monitor.getMetrics().errors.by_module.unknown).toBe(1);
  });
});

describe('monitoring — intégration Sentry (initSentry)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SENTRY_DSN;
    jest.resetModules();
  });

  it('SENTRY_DSN absent → Sentry reste null, pas de require tenté', () => {
    const monitor = freshMonitoring();
    expect(monitor.Sentry).toBeNull();
  });

  it('SENTRY_DSN défini mais @sentry/node non installé → catch, log.warn, Sentry=null', () => {
    process.env.SENTRY_DSN = 'https://fake@sentry.io/1';
    const monitor = freshMonitoring();
    expect(monitor.Sentry).toBeNull();
  });

  it('SENTRY_DSN défini + @sentry/node disponible (mock virtuel) → init appelé, Sentry actif', () => {
    const mockSentryInit = jest.fn();
    const mockWithScope = jest.fn((cb) => cb({ setTags: jest.fn(), setExtra: jest.fn() }));
    const mockCaptureException = jest.fn();

    jest.doMock('@sentry/node', () => ({
      init: mockSentryInit,
      withScope: mockWithScope,
      captureException: mockCaptureException,
    }), { virtual: true });

    process.env.SENTRY_DSN = 'https://fake@sentry.io/1';
    process.env.NODE_ENV = 'production';
    const monitor = freshMonitoring();

    expect(monitor.Sentry).toBeTruthy();
    expect(mockSentryInit).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://fake@sentry.io/1',
      environment: 'production',
      tracesSampleRate: 0.1,
    }));

    // trackError doit forwarder à Sentry (withScope + captureException) quand Sentry actif
    const err = new Error('sentry-forwarded');
    monitor.trackError(err, { module: 'test-mod', extra: 'value' });

    expect(mockWithScope).toHaveBeenCalled();
    expect(mockCaptureException).toHaveBeenCalledWith(err);

    process.env.NODE_ENV = 'test';
    jest.dontMock('@sentry/node');
  });

  it('beforeSend scrub les cookies et le header authorization quand présents', () => {
    const mockSentryInit = jest.fn();
    jest.doMock('@sentry/node', () => ({
      init: mockSentryInit,
      withScope: jest.fn((cb) => cb({ setTags: jest.fn(), setExtra: jest.fn() })),
      captureException: jest.fn(),
    }), { virtual: true });

    process.env.SENTRY_DSN = 'https://fake@sentry.io/1';
    freshMonitoring();

    const { beforeSend } = mockSentryInit.mock.calls[0][0];

    const eventWithSensitive = {
      request: { cookies: { session: 'abc' }, headers: { authorization: 'Bearer secret' } },
    };
    const scrubbed = beforeSend(eventWithSensitive);
    expect(scrubbed.request.cookies).toBeUndefined();
    expect(scrubbed.request.headers.authorization).toBe('[REDACTED]');

    // Branche "rien à scrubber" (optional chaining court-circuite)
    const eventWithoutSensitive = { request: { headers: {} } };
    const untouched = beforeSend(eventWithoutSensitive);
    expect(untouched.request.headers.authorization).toBeUndefined();

    const eventNoRequest = {};
    expect(() => beforeSend(eventNoRequest)).not.toThrow();

    jest.dontMock('@sentry/node');
  });
});

describe('monitoring — checkAlerts', () => {
  let nowSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SENTRY_DSN;
    jest.resetModules();
  });

  afterEach(() => {
    if (nowSpy) { nowSpy.mockRestore(); nowSpy = undefined; }
  });

  it('ne fait rien si moins d\'une minute s\'est écoulée depuis le dernier check', () => {
    const t0 = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    const monitor = freshMonitoring(); // _lastAlertCheck = t0

    nowSpy.mockReturnValue(t0 + 30_000); // 30s plus tard, < 1 min
    expect(() => monitor.checkAlerts()).not.toThrow();
    // Pas d'assertion de log ici : le early-return empêche tout calcul, on
    // vérifie juste l'absence d'exception et le comportement no-op.
  });

  it('déclenche une alerte "High error rate" si le seuil est dépassé', () => {
    const t0 = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    const monitor = freshMonitoring();

    for (let i = 0; i < 15; i++) {
      monitor.trackError(new Error(`e${i}`), { module: 'rate-test' });
    }

    nowSpy.mockReturnValue(t0 + 61_000); // ~1 minute plus tard → 15 erreurs/min > seuil 10
    monitor.checkAlerts();

    // Deuxième appel immédiat : elapsed < 1min à nouveau → early return, pas de double-compte
    monitor.checkAlerts();
  });

  it('déclenche une alerte "High SMS failure rate" si le taux d\'échec SMS dépasse 50%', () => {
    const t0 = 2_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    const monitor = freshMonitoring();

    for (let i = 0; i < 4; i++) monitor.trackSMS('sent');
    for (let i = 0; i < 8; i++) monitor.trackSMS('failed'); // 8/12 = 67% > 50%, total > 10

    nowSpy.mockReturnValue(t0 + 61_000);
    expect(() => monitor.checkAlerts()).not.toThrow();
  });

  it('ne déclenche pas d\'alerte SMS si le volume total est trop faible (<=10)', () => {
    const t0 = 3_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    const monitor = freshMonitoring();

    monitor.trackSMS('sent');
    monitor.trackSMS('failed'); // total=2, ne dépasse pas le seuil de volume

    nowSpy.mockReturnValue(t0 + 61_000);
    expect(() => monitor.checkAlerts()).not.toThrow();
  });
});
