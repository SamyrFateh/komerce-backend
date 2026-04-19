const CACHE='komerce-v16';
const SHELL=['/Komerce_Boutique.html','/boutique.css','/boutique.js','/manifest.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(SHELL.some(s=>u.pathname.endsWith(s))){e.respondWith(fetch(r).then(res=>{if(res.ok){const cl=res.clone();caches.open(CACHE).then(c=>c.put(r,cl))}return res}).catch(()=>caches.match(r)))}else{e.respondWith(caches.match(r).then(c=>c||fetch(r)))}});
