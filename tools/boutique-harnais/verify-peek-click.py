#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, re, subprocess, threading, functools, http.server, socketserver, time
from playwright.sync_api import sync_playwright

raw = subprocess.check_output(["node","-e","console.log(JSON.stringify(require('./tests/fixtures/golden-elite-pro-detail.js')))"], text=True)
BASE_DETAIL = json.loads(raw)

def make_stubs(with_content):
    detail = json.loads(json.dumps(BASE_DETAIL))
    detail["inventory_model"] = "SIMPLE"
    detail.setdefault("product", {})["inventory_model"] = "SIMPLE"
    detail["delivery_options"] = [{"code":"SEA_STANDARD","label":"Maritime","available":True,"eta_label":"3-5 semaines","price_kmf":0}]
    if not with_content:
        detail["content"] = None
    p = detail["product"]
    sp = {"id": p["id"], "name": p.get("name","Produit test"), "price_kmf": 18000,
          "description": p.get("description","Description test."), "images": p.get("images", []),
          "image_url": "", "category": p.get("category","Sport"), "is_available": True,
          "stock": 12, "inventory_model": "SIMPLE"}
    extras = [{"id": f"sug-{i}", "name": f"Produit suggestion {i}", "price_kmf": 5000+i*500,
               "description": "Desc", "images": [], "image_url": "",
               "category": sp["category"], "is_available": True, "stock": 10,
               "inventory_model": "SIMPLE"} for i in range(6)]
    return detail, sp, extras

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory="..")
class Server(socketserver.TCPServer):
    allow_reuse_address = True
    def handle_error(self, *a): pass

def run_case(pw, label, viewport, with_content, port):
    detail, sp, extras = make_stubs(with_content)
    srv = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    time.sleep(0.3)
    browser = pw.chromium.launch()
    page = browser.new_page(viewport=viewport, locale="fr-FR", device_scale_factor=2)
    page.route(re.compile(r"/api/"), lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    page.route(re.compile(r"/api/products(\?|$)"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps([sp]+extras)))
    page.route(re.compile(r"/api/products/[^/]+/detail"), lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(detail)))
    page.goto(f"http://127.0.0.1:{port}/boutique/index.html", wait_until="domcontentloaded")
    page.wait_for_function("() => window._kbus && window._kstate", timeout=8000)
    page.evaluate("""(args) => {
        const {sp, extras} = args;
        [sp, ...extras].forEach(pr => {
            if (!window._kstate.products.find(x => String(x.id) === String(pr.id)))
                window._kstate.products.push(pr);
        });
        window._kbus.emit('modal:open', {id: sp.id});
    }""", {"sp": sp, "extras": extras})
    page.wait_for_selector("#k-modal", state="visible", timeout=6000)
    time.sleep(1.4)

    before = page.evaluate("""() => {
        const card = document.querySelector('.k-sug-card');
        const r = card ? card.getBoundingClientRect() : null;
        return r ? Math.round(r.y) : null;
    }""")

    peek = page.locator('#k-modal-sugg-peek')
    peek.click()
    time.sleep(1.0)  # laisser le smooth-scroll se terminer

    after = page.evaluate("""() => {
        const card = document.querySelector('.k-sug-card');
        const r = card ? card.getBoundingClientRect() : null;
        return r ? Math.round(r.y) : null;
    }""")

    print(f"\n=== {label} ({viewport['width']}x{viewport['height']}) content={with_content} ===")
    print(f"  1re carte AVANT clic : y={before}")
    print(f"  1re carte APRES clic : y={after}  →  visible={0 <= after < viewport['height'] if after is not None else None}")
    page.screenshot(path=f"/tmp/click_{label}.png")
    browser.close()
    srv.shutdown()

with sync_playwright() as pw:
    run_case(pw, "desktop_withcontent", {"width":1280,"height":800}, True, 8140)
    run_case(pw, "mobile_withcontent", {"width":390,"height":844}, True, 8141)
