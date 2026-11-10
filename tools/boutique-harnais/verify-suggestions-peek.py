#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify-suggestions-peek.py — Vérifie que les cartes de suggestion "peekent"
sous la zone produit, en Desktop (≥1024px) et Mobile (<900px).
Basé sur harnais/render-modal.py (mêmes stubs, même flux d'ouverture).
"""
CONFIG = {
    "PUBLIC_DIR": "..",
    "PORT": 8124,
    "FIXTURE": "tests/fixtures/golden-elite-pro-detail.js",
    "PRICE_KMF": 18000,
    "OUT_DIR": "/tmp",
}
C = CONFIG

import json, re, subprocess, threading, functools, http.server, socketserver, time, sys

from playwright.sync_api import sync_playwright

raw = subprocess.check_output(
    ["node", "-e", f"console.log(JSON.stringify(require('./{C['FIXTURE']}')))"],
    text=True)
detail = json.loads(raw)
detail["inventory_model"] = "SIMPLE"
detail.setdefault("product", {})["inventory_model"] = "SIMPLE"
detail["delivery_options"] = [{"code": "SEA_STANDARD", "label": "Maritime",
                               "available": True, "eta_label": "3-5 semaines", "price_kmf": 0}]

p = detail["product"]
sp = {"id": p["id"], "name": p.get("name", "Produit test"), "price_kmf": C["PRICE_KMF"],
      "description": p.get("description", "Description test."), "images": p.get("images", []),
      "image_url": "", "category": p.get("category", "Sport"), "is_available": True,
      "stock": 12, "inventory_model": "SIMPLE"}

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=C["PUBLIC_DIR"])
class Server(socketserver.TCPServer):
    allow_reuse_address = True
    def handle_error(self, *a): pass
srv = Server(("127.0.0.1", C["PORT"]), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
time.sleep(0.5)

def measure(pg, viewport_h):
    return pg.evaluate("""(vh) => {
      const rect = s => { const e = document.querySelector(s);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; };
      const zone = document.querySelector('.k-modal-product-zone');
      const info = document.querySelector('.k-modal-info');
      const sugg = document.getElementById('k-modal-suggestions');
      const sugPeek = document.getElementById('k-modal-sugg-peek');
      const firstCard = document.querySelector('.k-sug-card');
      const scrollEl = document.querySelector('.k-modal-scroll');
      const zoneR = zone ? zone.getBoundingClientRect() : null;
      const suggR = sugg ? sugg.getBoundingClientRect() : null;
      const cardR = firstCard ? firstCard.getBoundingClientRect() : null;
      return {
        zone_h: zoneR ? Math.round(zoneR.height) : null,
        zone_maxHeight_css: zone ? getComputedStyle(zone).maxHeight : null,
        info_scrollHeight: info ? info.scrollHeight : null,
        info_clientHeight: info ? info.clientHeight : null,
        sugg_top_y: suggR ? Math.round(suggR.y) : null,
        sugg_peek_px: suggR ? Math.max(0, Math.round(vh - suggR.y)) : null,
        first_card_h: cardR ? Math.round(cardR.height) : null,
        sugg_peek_hint_visible: sugPeek ? !sugPeek.hidden : null,
        scrollEl_scrollHeight: scrollEl ? scrollEl.scrollHeight : null,
        scrollEl_clientHeight: scrollEl ? scrollEl.clientHeight : null,
      };
    }""", viewport_h)

def run_case(pw, label, viewport):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport=viewport, locale="fr-FR", device_scale_factor=2)
    page.route(re.compile(r"/api/"),
               lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    page.route(re.compile(r"/api/products(\?|$)"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps([sp])))
    page.route(re.compile(r"/api/products/[^/]+/detail"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(detail)))
    page.goto(f"http://127.0.0.1:{C['PORT']}/boutique/index.html", wait_until="domcontentloaded")
    page.wait_for_function("() => window._kbus && window._kstate", timeout=8000)
    page.evaluate("""(sp) => {
        if (!window._kstate.products.find(x => String(x.id) === String(sp.id)))
            window._kstate.products.push(sp);
        window._kbus.emit('modal:open', {id: sp.id});
    }""", sp)
    page.wait_for_selector("#k-modal", state="visible", timeout=6000)
    time.sleep(1.4)
    result = measure(page, viewport["height"])
    page.screenshot(path=f"{C['OUT_DIR']}/verify_{label}.png")
    print(f"\n=== {label} ({viewport['width']}x{viewport['height']}) ===")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    browser.close()
    return result

with sync_playwright() as pw:
    run_case(pw, "desktop_1280x800", {"width": 1280, "height": 800})
    run_case(pw, "desktop_1024x760", {"width": 1024, "height": 760})
    run_case(pw, "mobile_390x844", {"width": 390, "height": 844})

srv.shutdown()
print(f"\nCaptures dans {C['OUT_DIR']}/verify_*.png")
