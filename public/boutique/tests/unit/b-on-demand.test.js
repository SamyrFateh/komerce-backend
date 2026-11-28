'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const mockIdentity=jest.fn(),mockBus={on:jest.fn()};
jest.mock('../../js/b-identity.js',()=>({requireIdentity:mockIdentity}));
jest.mock('../../js/b-bus.js',()=>({bus:mockBus}));
const {openOnDemand,setupOnDemand}=require('../../js/b-on-demand.js');
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const dialog=()=>document.querySelector('dialog.k-on-demand');
const click=(label)=>[...dialog().querySelectorAll('button')].find(b=>b.textContent===label).click();
beforeAll(()=>{
 window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};
 window.HTMLDialogElement.prototype.show=function(){this.setAttribute('open','')};
 window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new Event('close'))};
});
afterEach(()=>{if(dialog()?.open)dialog().close();jest.clearAllMocks()});
test('anonymous cancellation does not access private API',async()=>{mockIdentity.mockResolvedValue(null);await openOnDemand();expect(fetch).not.toHaveBeenCalled();expect(dialog()?.open).toBeFalsy()});
test('internal identity gets staff guidance, never creates a client request',async()=>{mockIdentity.mockResolvedValue({role:'admin',id:'a'});await openOnDemand();expect(dialog().textContent).toContain('session interne');expect(dialog().textContent).not.toContain('Nouvelle demande');expect(fetch).not.toHaveBeenCalled()});
test('client can qualify optionally, review and submit through existing API',async()=>{
 mockIdentity.mockResolvedValue({id:'c',role:'client'});window.KomerceMarket={get:()=>({code:'KM'})};
 fetch.mockResolvedValueOnce({ok:true,json:async()=>({requests:[]})});
 await openOnDemand();expect(dialog().textContent).toContain('Aucune demande');
 click('Nouvelle demande');
 expect([...dialog().querySelectorAll('[data-motif]')].map(e=>e.dataset.motif)).toEqual(['auto_parts','express','other']);
 click('Pièce automobile');
 expect(dialog().querySelector('input[type=file]').accept).toBe('image/jpeg,image/png,image/webp');
 expect(dialog().querySelector('[capture]').getAttribute('capture')).toBe('environment');
 const input=dialog().querySelector('textarea');input.value='Alternateur';input.dispatchEvent(new Event('input'));
 click('Continuer');const vehicle=dialog().querySelector('input[type=text]');vehicle.value='Toyota Yaris';vehicle.dispatchEvent(new Event('input'));
 click('Vérifier ma demande');expect(dialog().textContent).toContain('Toyota Yaris');expect(fetch).toHaveBeenCalledTimes(1);
 fetch.mockResolvedValueOnce({ok:true,json:async()=>({request:{reference:'D-test'}})}).mockResolvedValueOnce({ok:true,json:async()=>({request:{motif:'auto_parts',status:'new'},messages:[]})});
 click('Envoyer ma demande');await flush();
 const request=fetch.mock.calls.find(([p,o])=>p==='/api/client-requests'&&o.method==='POST');
 expect(request[1].body.get('motif')).toBe('auto_parts');expect(request[1].body.get('market')).toBe('KM');expect(request[1].body.get('body')).toContain('Toyota Yaris');
});
test('changing market before send fails closed',async()=>{
 let market='KM';window.KomerceMarket={get:()=>({code:market})};mockIdentity.mockResolvedValue({id:'c',role:'client'});fetch.mockResolvedValueOnce({ok:true,json:async()=>({requests:[]})});
 await openOnDemand();click('Nouvelle demande');const input=dialog().querySelector('textarea');input.value='Pièce';input.dispatchEvent(new Event('input'));click('Continuer');click('Passer cette étape');market='CM';click('Envoyer ma demande');await flush();expect(fetch).toHaveBeenCalledTimes(1);expect(dialog().textContent).toContain('marché a changé');
});
test('notification deep-link registers once',()=>{setupOnDemand();setupOnDemand();expect(mockBus.on).toHaveBeenCalledTimes(1);expect(mockBus.on).toHaveBeenCalledWith('on-demand:open',expect.any(Function))});
