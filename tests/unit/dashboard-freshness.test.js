'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
describe('Canonical DashboardFreshness — intersession revalidation', () => {
  let active = [];
  let streams = [];
  let originalEventSource;
  let originalDocument;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    active = [];
    streams = [];
    originalEventSource = global.EventSource;
    originalDocument = global.document;
    global.document = {
      visibilityState: 'visible',
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
    global.EventSource = class FakeEventSource {
      constructor(url) {
        this.url = url;
        this.handlers = {};
        this.closed = false;
        streams.push(this);
      }
      addEventListener(type, handler) { this.handlers[type] = handler; }
      close() { this.closed = true; }
      emit(type) { this.handlers[type]?.({ data:'{}' }); }
    };
    delete global.KomerceDashboardFreshness;
    require('../../public/dashboards/canonical/js/dashboard-freshness');
  });

  afterEach(() => {
    active.forEach(watcher => watcher.stop());
    global.EventSource = originalEventSource;
    global.document = originalDocument;
    delete global.KomerceDashboardFreshness;
    jest.useRealTimers();
  });

  it('partage un seul flux SSE et relit les API des deux vues sans les modifier localement', async () => {
    const helper = global.KomerceDashboardFreshness;
    const one = jest.fn(async () => ({ version:2 }));
    const two = jest.fn(async () => ({ version:2 }));
    active.push(helper.watch({ root:{ isConnected:true }, refresh:one }));
    active.push(helper.watch({ root:{ isConnected:true }, refresh:two }));
    expect(streams).toHaveLength(1);
    expect(streams[0].url).toBe('/api/admin/dashboard/events');
    streams[0].emit('refresh');
    await jest.advanceTimersByTimeAsync(2200);
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
    streams[0].emit('refresh');
    await jest.advanceTimersByTimeAsync(2200);
    expect(one).toHaveBeenCalledTimes(2);
    expect(two).toHaveBeenCalledTimes(2);
    active.forEach(w => w.stop());
    expect(streams[0].closed).toBe(true);
  });

  it('ne lit pas un écran masqué et coupe un watcher démonté', async () => {
    const reload = jest.fn(async () => ({}));
    const root = { isConnected:true };
    active.push(global.KomerceDashboardFreshness.watch({ root, refresh:reload }));
    global.document.visibilityState = 'hidden';
    streams[0].emit('refresh');
    await jest.advanceTimersByTimeAsync(2300);
    expect(reload).not.toHaveBeenCalled();
    global.document.visibilityState = 'visible';
    streams[0].emit('refresh');
    await jest.advanceTimersByTimeAsync(2300);
    expect(reload).toHaveBeenCalledTimes(1);
    root.isConnected = false;
    streams[0].emit('refresh');
    await jest.advanceTimersByTimeAsync(2300);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(streams[0].closed).toBe(true);
  });
});
