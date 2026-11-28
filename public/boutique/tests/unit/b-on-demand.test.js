'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const mockIdentity = jest.fn();
const mockBus = {on: jest.fn()};
jest.mock('../../js/b-identity.js', () => ({requireIdentity: mockIdentity}));
jest.mock('../../js/b-bus.js', () => ({bus: mockBus}));
const {openOnDemand, setupOnDemand} = require('../../js/b-on-demand.js');
test('anonymous cancellation never opens an inbox or fetches private data', async () => {
  mockIdentity.mockResolvedValue(null);
  await openOnDemand();
  expect(mockIdentity).toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(document.querySelector('dialog.k-on-demand')).toBeNull();
});
test('authenticated inbox uses private API and presents the three commercial motifs', async () => {
  mockIdentity.mockResolvedValue({id:'client-1'});
  fetch.mockResolvedValue({ok:true,json:async()=>({requests:[]})});
  const prototype = window.HTMLDialogElement.prototype;
  const old = prototype.showModal;
  prototype.showModal = function(){this.setAttribute('open','')};
  try {
    await openOnDemand();
    expect(fetch).toHaveBeenCalledWith('/api/client-requests',expect.objectContaining({credentials:'same-origin',cache:'no-store'}));
    const dialog = document.querySelector('dialog.k-on-demand');
    expect(dialog.textContent).toContain('Aucune demande');
    [...dialog.querySelectorAll('button')].find(b=>b.textContent==='Nouvelle demande').click();
    expect([...dialog.querySelector('select').options].map(o=>o.value)).toEqual(['auto_parts','express','other']);
    expect(dialog.querySelector('input[type=file]').accept).toBe('image/jpeg,image/png,image/webp');
  } finally { if(old) prototype.showModal=old; else delete prototype.showModal; }
});
test('runtime registers the notification deep-link once', () => {
  setupOnDemand(); setupOnDemand();
  expect(mockBus.on).toHaveBeenCalledTimes(1);
  expect(mockBus.on).toHaveBeenCalledWith('on-demand:open', expect.any(Function));
});
