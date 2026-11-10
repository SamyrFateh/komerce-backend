#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
render-modal.py — Harnais de rendu RÉEL de la modale produit Komerce.

Ouvre la vraie modale (CSS/JS servis depuis le repo), avec des données stubbées,
et joue le cycle CTA A -> B -> C en mesurant le DOM + en prenant des captures.
Aucun backend requis : l'API est interceptée par Playwright.

--------------------------------------------------------------------------------
PRÉREQUIS
    pip install playwright
    python -m playwright install chromium
    (node doit être dispo — sert à extraire la fixture golden, contrat détail valide)

LANCEMENT (depuis public/boutique) :
    python render-modal.py

SORTIES :
    - impression console : état A/B/C (positions boutons, stepper, pill livraison)
    - captures : /tmp/modal_A.png, /tmp/modal_B.png, /tmp/modal_C.png
      (change OUT_DIR ci-dessous si besoin sous Windows, ex. ".")

--------------------------------------------------------------------------------
CONFIG — édite ces valeurs
"""
CONFIG = {
    "PUBLIC_DIR": "..",           # racine servie (le dossier `public`, parent de `boutique`)
    "PORT": 8123,
    "VIEWPORT": {"width": 390, "height": 844},   # mobile. Desktop : {"width":1280,"height":800}
    "INVENTORY_MODEL": "SIMPLE",  # "SIMPLE" = stepper actif (cycle complet). "SKU" = stepper désactivé (doctrine PDC-6)
    "DELIVERY": "AIR",            # "AIR" (accent bleu, avion) ou "SEA" (neutre, bateau)
    "FIXTURE": "tests/fixtures/golden-elite-pro-detail.js",  # contrat détail réel (valide)
    "PRICE_KMF": 18000,
    "OUT_DIR": "/tmp",            # sous Windows, mets "." si /tmp n'existe pas
}
# --------------------------------------------------------------------------------

import json, re, subprocess, threading, functools, http.server, socketserver, time, sys, os
from playwright.sync_api import sync_playwright

C = CONFIG

# 1) Extraire la fixture golden via node → contrat détail VALIDE (évite les erreurs de rendu)
try:
    raw = subprocess.check_output(
        ["node", "-e", f"console.log(JSON.stringify(require('./{C['FIXTURE']}')))"],
        text=True)
    detail = json.loads(raw)
except Exception as e:
    print("ERREUR extraction fixture (node requis) :", e); sys.exit(1)

# 2) Patch inventory_model + livraison selon CONFIG
detail["inventory_model"] = C["INVENTORY_MODEL"]
detail.setdefault("product", {})["inventory_model"] = C["INVENTORY_MODEL"]
if C["DELIVERY"] == "AIR":
    detail["delivery_options"] = [{"code": "AIR_EXPRESS", "label": "Livraison express",
                                   "available": True, "eta_label": "Sous 5 jours", "price_kmf": 2500}]
else:
    detail["delivery_options"] = [{"code": "SEA_STANDARD", "label": "Maritime",
                                   "available": True, "eta_label": "3-5 semaines", "price_kmf": 0}]

p = detail["product"]
# 3) Produit "liste" minimal (le _kstate a besoin d'une entrée pour le paint provisoire)
sp = {"id": p["id"], "name": p.get("name", "Produit test"), "price_kmf": C["PRICE_KMF"],
      "description": p.get("description", "Description test."), "images": p.get("images", []),
      "image_url": "", "category": p.get("category", "Sport"), "is_available": True,
      "stock": 12, "inventory_model": C["INVENTORY_MODEL"]}

# 4) Serveur statique (sert PUBLIC_DIR ; on accède ensuite à /boutique/index.html)
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=C["PUBLIC_DIR"])
class Server(socketserver.TCPServer):
    allow_reuse_address = True
    def handle_error(self, *a): pass  # silence BrokenPipe (aborts navigateur bénins)
srv = Server(("127.0.0.1", C["PORT"]), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
time.sleep(0.5)

def inspect(pg):
    """Mesure l'état du CTA + la pill livraison (sans dépendre du viewer d'images)."""
    return pg.evaluate("""() => {
      const box = s => { const e = document.querySelector(s);
        if (!e || getComputedStyle(e).display === 'none') return null;
        const r = e.getBoundingClientRect();
        return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; };
      const a = document.querySelector('.k-modal-actions');
      const deliv = document.querySelector('.k-modal-delivery, .k-mdm-chip--delivery, .k-modal-shipping-pill');
      return {
        filled: a ? a.classList.contains('k-modal-actions--filled') : null,
        add: box('#k-add-cart-btn'),
        stepper: box('.k-qty'),
        buy: box('#k-buy-now-btn'),
        deliveryText: (deliv ? deliv.textContent : '').replace(/\\s+/g, ' ').trim().slice(0, 60),
        deliveryAir: !!document.querySelector('.k-mdm-chip--air, .k-modal-shipping-pill--air'),
      };
    }""")

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport=C["VIEWPORT"], locale="fr-FR", device_scale_factor=2)

    # Stubs API (ordre : dernier enregistré = priorité → detail passe avant la liste)
    page.route(re.compile(r"/api/"),
               lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    page.route(re.compile(r"/api/products(\?|$)"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps([sp])))
    page.route(re.compile(r"/api/products/[^/]+/detail"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(detail)))

    page.goto(f"http://127.0.0.1:{C['PORT']}/boutique/index.html", wait_until="domcontentloaded")
    # CLÉ : le bus et le state sont exposés (main.js / b-store.js) → ouverture directe,
    # sans passer par la grille (qui ne se peuple pas en statique, shop-schema vide).
    page.wait_for_function("() => window._kbus && window._kstate", timeout=8000)
    page.evaluate("""(sp) => {
        if (!window._kstate.products.find(x => String(x.id) === String(sp.id)))
            window._kstate.products.push(sp);
        window._kbus.emit('modal:open', {id: sp.id});
    }""", sp)
    page.wait_for_selector("#k-modal", state="visible", timeout=6000)
    time.sleep(1.2)

    out = C["OUT_DIR"]
    print("A (hors-panier):", json.dumps(inspect(page), ensure_ascii=False))
    page.screenshot(path=f"{out}/modal_A.png")

    # B : ajouter au panier (force disabled=false utile pour les produits SKU)
    page.evaluate("() => { const b = document.getElementById('k-add-cart-btn'); if (b){b.disabled=false; b.click();} }")
    time.sleep(0.9)
    print("B (au panier)  :", json.dumps(inspect(page), ensure_ascii=False))
    page.screenshot(path=f"{out}/modal_B.png")

    # C : décrémenter jusqu'à 0 → le bouton doit réapparaître (produit SIMPLE uniquement)
    page.evaluate("() => { const m = document.getElementById('k-qty-minus'); if (m) m.click(); }")
    time.sleep(0.9)
    print("C (retour 0)   :", json.dumps(inspect(page), ensure_ascii=False))
    page.screenshot(path=f"{out}/modal_C.png")

    browser.close()

srv.shutdown()
print(f"\nCaptures dans {C['OUT_DIR']}/modal_A|B|C.png")
