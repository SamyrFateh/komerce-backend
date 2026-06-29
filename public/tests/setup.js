'use strict';

// Stub global minimal, écrasé par jest.fn() dans chaque test si besoin.
if (typeof global.fetch !== 'function') {
  global.fetch = () => Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: () => Promise.resolve('{}'),
  });
}

// jsdom ne fournit pas matchMedia — certains composants UI peuvent y faire appel.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}
