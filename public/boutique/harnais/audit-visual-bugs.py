#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit-visual-bugs.py — Harnais de reproduction des 6 bugs visuels signalés
(stepper modal vs accueil, badge promo, panier masqué, catégories 1 ligne,
titre récap centré, layout checkout).

Même principe que render-modal.py : vraie page servie depuis le repo,
API stubbée, ouverture via window._kbus / window._kstate. Aucun backend.

Lancement (depuis public/boutique) :
    python3 harnais/audit-visual-bugs.py
"""
import json, re, subprocess, threading, functools, http.server, socketserver, time, sys, os
from playwright.sync_api import sync_playwright

PORT = 8134
OUT_DIR = "/tmp/audit"
os.makedirs(OUT_DIR, exist_ok=True)

# 1) Fixture golden -> détail produit valide
raw = subprocess.check_output(
    ["node", "-e", "console.log(JSON.stringify(require('./tests/fixtures/golden-elite-pro-detail.js')))"],
    text=True)
GOLDEN = json.loads(raw)

def make_detail(pid, name, cat, subcat, price, promo_pct=None):
    d = json.loads(json.dumps(GOLDEN))  # deep copy
    d["inventory_model"] = "SIMPLE"
    d["product"]["id"] = pid
    d["product"]["name"] = name
    d["product"]["category"] = cat
    d["product"]["subcategory"] = subcat
    d["product"].setdefault("inventory_model", "SIMPLE")
    d["pricing"]["price_kmf"] = price
    if promo_pct:
        d["pricing"]["old_price_kmf"] = int(price / (1 - promo_pct / 100))
        d["pricing"]["promo_pct"] = promo_pct
    d["delivery_options"] = [{"code": "SEA_STANDARD", "label": "Maritime",
                               "available": True, "eta_label": "3-5 semaines", "price_kmf": 0}]
    return d

# 2) Catalogue stub — plusieurs produits "Maison" (mêmes sous-catégories que le
#    fallback shop-schema : Confort/Cuisine/Déco/Enfants) pour peupler "Dans le
#    même univers" avec >=2 sous-catégories (déclenche les chips k-sug-chips).
PRODUCTS = []
DETAILS = {}

def add_product(pid, name, cat, subcat, price, promo_pct=None):
    sp = {"id": pid, "name": name, "price_kmf": price, "description": "Description test.",
          "images": [], "image_url": "", "category": cat, "subcategory": subcat,
          "is_available": True, "stock": 12, "inventory_model": "SIMPLE"}
    if promo_pct:
        sp["old_price_kmf"] = int(price / (1 - promo_pct / 100))
        sp["promo_pct"] = promo_pct
    PRODUCTS.append(sp)
    DETAILS[pid] = make_detail(pid, name, cat, subcat, price, promo_pct)

MAIN_ID = "prod-0000-main"
add_product(MAIN_ID, "Gadget maison sport", "Maison", "Confort", 33000)
add_product("prod-0001", "Humidificateur original", "Maison", "Confort", 10000)
add_product("prod-0002", "Outil pratique compact", "Maison", "Cuisine", 16500, promo_pct=23)
add_product("prod-0003", "Accessoire maison vintage", "Maison", "Déco", 17000)
add_product("prod-0004", "Accessoire maison robuste", "Maison", "Enfants", 9000)
add_product("prod-0005", "Diffuseur léger", "Maison", "Cuisine", 8000)
add_product("prod-0006", "Lampe frais", "Maison", "Déco", 12000)
for i in range(7, 24):
    add_product(f"prod-{i:04d}", f"Produit maison {i}", "Maison", "Confort", 5000 + i * 100)

# Produits déjà dans le panier latéral (référence image 1/3/4 : 4 lignes)
CART_IDS = ["prod-0002", "prod-0003", "prod-0005", "prod-0001"]

# 3) Serveur statique — racine = public/ (parent de boutique/)
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory="..")
class Server(socketserver.TCPServer):
    allow_reuse_address = True
    def handle_error(self, *a): pass
srv = Server(("127.0.0.1", PORT), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
time.sleep(0.4)

def shot(page, name, selector=None, pad=0):
    path = f"{OUT_DIR}/{name}.png"
    if selector:
        el = page.query_selector(selector)
        if el:
            el.screenshot(path=path)
            print(f"  -> {path} (element {selector})")
            return
    page.screenshot(path=path, full_page=False)
    print(f"  -> {path} (viewport)")

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900}, locale="fr-FR", device_scale_factor=2)

    page.add_init_script("window.KOMERCE_FORCE_FALLBACK_CATEGORIES = true;")

    page.route(re.compile(r"/api/"),
               lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
    page.route(re.compile(r"/api/products(\?|$)"),
               lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(PRODUCTS)))
    def detail_handler(route):
        m = re.search(r"/api/products/([^/]+)/detail", route.request.url)
        pid = m.group(1) if m else None
        d = DETAILS.get(pid, GOLDEN)
        route.fulfill(status=200, content_type="application/json", body=json.dumps(d))
    page.route(re.compile(r"/api/products/[^/]+/detail"), detail_handler)

    page.goto(f"http://127.0.0.1:{PORT}/boutique/index.html", wait_until="domcontentloaded")
    page.wait_for_function("() => window._kbus && window._kstate", timeout=8000)

    # Pousser le catalogue + panier directement dans le state (pas de backend)
    page.evaluate("""(args) => {
        const { products, cartIds } = args;
        products.forEach(p => {
            if (!window._kstate.products.find(x => String(x.id) === String(p.id)))
                window._kstate.products.push(p);
        });
        window._kstate.cart = cartIds.map(id => {
            const p = window._kstate.products.find(x => String(x.id) === String(id));
            return { product: p, id: p.id, name: p.name, price: p.price_kmf, image: '',
                     qty: 1, variant_combo: null, variant_label: '', requested_transport_rail: null };
        });
        window._kbus.emit('cart:update');
        window._kbus.emit('side-cart:render');
    }""", {"products": PRODUCTS, "cartIds": CART_IDS})
    time.sleep(0.3)

    # ── SCÉNARIO A : ouvrir la modale du produit principal (desktop) ────────
    page.evaluate("(id) => window._kbus.emit('modal:open', {id})", MAIN_ID)
    page.wait_for_selector("#k-modal", state="visible", timeout=6000)
    time.sleep(1.0)

    print("=== SCÉNARIO A — modal produit desktop + panier latéral + suggestions ===")

    # (1) Stepper modal vs accueil : ajouter au panier le produit principal
    # pour faire apparaître le stepper `.k-qty` en état --filled.
    page.evaluate("""() => {
        const b = document.getElementById('k-add-cart-btn');
        if (b) { b.disabled = false; b.click(); }
    }""")
    time.sleep(0.6)
    m1 = page.evaluate("""() => {
      const box = s => { const e = document.querySelector(s);
        if (!e) return null; const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return {x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
                bg: cs.backgroundColor, radius: cs.borderRadius}; };
      return { modalQty: box('.k-qty'), modalQtyBtn: box('.k-qty-btn') };
    }""")
    print("  [1] Modal stepper geometry:", json.dumps(m1, ensure_ascii=False))
    shot(page, "bug1_modal_stepper", selector=".k-modal-actions")

    # Comparateur : produit AVEC quantité dans le panier, rendu carte grille
    # (state.cart contient déjà prod-0002 avec qty 1) — mesurer .k-card-add.in-cart
    # via une carte injectée hors-écran pour comparaison isolée (le grid réel
    # ne se peuple pas en statique, cf. README harnais point 2).
    home_geo = page.evaluate("""(pid) => {
      // Utilise le renderer réel du module (déjà chargé) via une carte de test.
      const modBox = document.querySelector('.k-modal-actions');
      return null;
    }""")

    # (2) Badge promo qui empiète sur le titre — suggestions "Dans le même univers"
    page.wait_for_selector("#k-modal-suggestions .k-sug-card", timeout=4000)
    time.sleep(1.0)  # laisse enhanceCuration() (rAF x2) tourner
    m2 = page.evaluate("""() => {
      const box = e => { if (!e) return null; const r = e.getBoundingClientRect();
        return {x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height)}; };
      const cards = Array.from(document.querySelectorAll('#k-modal-suggestions .k-sug-card'));
      const withBadge = cards.find(c => c.querySelector('.k-sug-promo-badge'));
      if (!withBadge) return { found: false, cardCount: cards.length };
      const badge = withBadge.querySelector('.k-sug-promo-badge');
      const img = withBadge.querySelector('.k-sug-card-img');
      const name = withBadge.querySelector('.k-sug-card-name');
      return {
        found: true,
        badge: box(badge), img: box(img), name: box(name),
        imgOverflowHidden: img ? getComputedStyle(img).overflow : null,
        imgPosition: img ? getComputedStyle(img).position : null,
        overlapsName: (box(badge) && box(name)) ? (box(badge).y + box(badge).h > box(name).y) : null,
      };
    }""")
    print("  [2] Promo badge vs title geometry:", json.dumps(m2, ensure_ascii=False))
    shot(page, "bug2_suggestions_full", selector="#k-modal-suggestions")

    if m2.get("found"):
        page.evaluate("""() => {
          const cards = Array.from(document.querySelectorAll('#k-modal-suggestions .k-sug-card'));
          const withBadge = cards.find(c => c.querySelector('.k-sug-promo-badge'));
          if (withBadge) withBadge.scrollIntoView({block:'center'});
        }""")
        time.sleep(0.4)
        bb = page.evaluate("""() => {
          const cards = Array.from(document.querySelectorAll('#k-modal-suggestions .k-sug-card'));
          const withBadge = cards.find(c => c.querySelector('.k-sug-promo-badge'));
          const r = withBadge.getBoundingClientRect();
          return {x:r.x, y:r.y, w:r.width, h:r.height};
        }""")
        pad = 30
        page.screenshot(path=f"{OUT_DIR}/bug2_promo_card_zoom.png",
                         clip={"x": max(0, bb["x"]-pad), "y": max(0, bb["y"]-pad),
                               "width": bb["w"]+2*pad, "height": bb["h"]+2*pad})
        print(f"  -> {OUT_DIR}/bug2_promo_card_zoom.png (clip on promo card)")

    # (4) Catégories (chips) toujours sur une seule ligne, panier latéral ouvert
    m4 = page.evaluate("""() => {
      const chips = document.querySelector('#k-modal .k-sug-chips');
      if (!chips) return { found: false };
      const rows = new Set();
      Array.from(chips.children).forEach(c => rows.add(Math.round(c.getBoundingClientRect().y)));
      return { found: true, childCount: chips.children.length, distinctRowYs: [...rows],
               flexWrap: getComputedStyle(chips).flexWrap,
               chipsWidth: Math.round(chips.getBoundingClientRect().width) };
    }""")
    print("  [4] Category chips rows (side cart open, modal narrower):", json.dumps(m4, ensure_ascii=False))
    shot(page, "bug4_chips", selector="#k-modal .k-sug-chips")

    # (3) Panier latéral masqué à sa base — mesurer si le footer Commander est
    # dans le viewport visible du modal (pas juste présent dans le DOM).
    m3 = page.evaluate("""() => {
      const box = e => { if (!e) return null; const r = e.getBoundingClientRect();
        return {x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height)}; };
      const slot = document.querySelector('#k-modal .k-modal-cart-slot');
      const sc = document.getElementById('k-side-cart');
      const footer = sc ? sc.querySelector('.k-sc-header') : null;
      const checkoutBtn = document.getElementById('k-sc-checkout');
      const slotBox = box(slot);
      const footerBox = box(footer);
      const btnBox = box(checkoutBtn);
      const visible = (slotBox && btnBox) ? (btnBox.y + btnBox.h <= slotBox.y + slotBox.h) : null;
      return { slot: slotBox, footer: footerBox, checkoutBtn: btnBox, checkoutBtnFullyVisible: visible,
               scItemsOverflow: document.getElementById('k-sc-items') ? getComputedStyle(document.getElementById('k-sc-items')).overflowY : null,
               scHasItemsClass: sc ? sc.className : null };
    }""")
    print("  [3] Side cart footer visibility:", json.dumps(m3, ensure_ascii=False))
    shot(page, "bug3_side_cart_full", selector="#k-modal .k-modal-cart-slot")
    shot(page, "bug3_side_cart_page")

    shot(page, "scenario_a_full")

    # ── SCÉNARIO B : checkout — récap + formulaire ──────────────────────────
    print("=== SCÉNARIO B — checkout (récap + formulaire) ===")
    page.evaluate("() => window._kbus.emit('modal:close')")
    time.sleep(0.4)
    page.evaluate("() => window._kbus.emit('checkout:open')")
    page.wait_for_selector("#k-order-modal.open", timeout=4000)
    time.sleep(0.6)

    m5 = page.evaluate("""() => {
      const box = e => { if (!e) return null; const r = e.getBoundingClientRect();
        return {x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height)}; };
      const header = document.getElementById('k-order-header') || document.querySelector('.k-order-header');
      const titleWrap = document.getElementById('k-order-title');
      const titleText = document.querySelector('.ck-order-title-text');
      const closeBtn = document.getElementById('k-order-close');
      const heading = document.querySelector('.ck-recap-gate-heading');
      const headingCss = heading ? getComputedStyle(heading).textAlign : null;
      return { header: box(header), titleWrap: box(titleWrap), titleText: box(titleText),
               closeBtn: box(closeBtn), heading: box(heading), headingTextAlign: headingCss };
    }""")
    print("  [5] Recap title centering geometry:", json.dumps(m5, ensure_ascii=False))
    shot(page, "bug5_recap_header", selector=".k-order-header")
    shot(page, "bug5_recap_full", selector="#k-order-modal")

    # (6) Formulaire checkout complet
    page.evaluate("""() => {
      const btn = document.getElementById('btn-confirm-recap');
      if (btn) btn.click();
    }""")
    time.sleep(0.6)
    shot(page, "bug6_checkout_form", selector="#k-order-modal")

    browser.close()

srv.shutdown()
print(f"\nCaptures dans {OUT_DIR}/")
