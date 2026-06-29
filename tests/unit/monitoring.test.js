'use strict';

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
});
