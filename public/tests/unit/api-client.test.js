'use strict';
global.fetch = jest.fn(() => Promise.resolve({
  ok: true, status: 200,
  json: () => Promise.resolve({ data: [{ id: 1 }] }), text: () => Promise.resolve(''),
}));

require('../../admin/js/api-client.js');

describe('KmcApi (api-client)', () => {
  beforeEach(() => {
    global.fetch.mockClear();
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ data: [] }), text: () => Promise.resolve('') });
  });

  it('KmcApi est attaché à window avec les méthodes clés', () => {
    expect(window.KmcApi).toBeDefined();
    expect(typeof window.KmcApi.getControlTower).toBe('function');
    expect(typeof window.KmcApi.getOps).toBe('function');
    expect(typeof window.KmcApi.getClients).toBe('function');
    expect(typeof window.KmcApi.getSales).toBe('function');
    expect(typeof window.KmcApi.getCosting).toBe('function');
  });

  it('getControlTower appelle fetch', async () => {
    await window.KmcApi.getControlTower({});
    expect(global.fetch).toHaveBeenCalled();
  });

  it('getClients appelle fetch', async () => {
    await window.KmcApi.getClients({});
    expect(global.fetch).toHaveBeenCalled();
  });

  it('clearCache est disponible', () => {
    expect(typeof window.KmcApi.clearCache).toBe('function');
  });

  it('fetch erreur → rejet', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({ error: 'fail' }), text: () => Promise.resolve('fail') });
    await expect(window.KmcApi.getControlTower({})).rejects.toBeDefined();
  });
});
