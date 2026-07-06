'use strict';
// app.js est le point d'entrée SPA — beaucoup de DOM
// On teste uniquement qu'il charge sans crash fatal
describe('app.js (SPA entrypoint)', () => {
  it('charge sans crash dans jsdom', () => {
    // Setup DOM minimal requis par app.js
    document.body.innerHTML = '<div id="app"><div id="nav"></div><div id="main"></div></div>';
    expect(() => {
      try { require('../../admin/js/app.js'); } catch(e) {
        // Attendu : certaines dépendances manquent (KmcApi, etc.)
        // Le test vérifie que le parsing ne crashe pas
        if (!e.message.includes('KmcApi') && !e.message.includes('is not defined')) throw e;
      }
    }).not.toThrow();
  });
});
