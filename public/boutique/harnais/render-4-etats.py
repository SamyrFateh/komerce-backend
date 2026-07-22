#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
render-4-etats.py — Harnais de rendu des 4 états de référence (A/B/C/D) de la
modale produit Komerce : desktop/mobile x enrichi/non-enrichi.

Basé sur render-modal.py (harnais validé du cycle CTA), étendu pour couvrir les
4 combinaisons et vérifier automatiquement le respect de la doctrine :
- réassurance (3 items, une seule ligne, sur les 4 états)
- suggestions toujours montées (jamais masquées par hasEnrichedContent)
- illustration/avatar hors bulle (pas de border-radius:50% + fond sur l'overlay marque)
- pas d'emoji sur CTA / chip livraison (un seul langage graphique : SVG)

--------------------------------------------------------------------------------
PRÉREQUIS
    pip install playwright
    python -m playwright install chromium
    (node doit être dispo — sert à extraire la fixture golden, contrat détail valide)

LANCEMENT (depuis N'IMPORTE QUEL répertoire — le script se replace lui-même
dans public/boutique, il n'est plus sensible au cwd d'appel) :
    python harnais/render-4-etats.py
    python harnais/render-4-etats.py --states C,D      # itère plus vite sur un sous-ensemble
    python harnais/render-4-etats.py --out /tmp/shots2  # change le dossier de sortie

SORTIES :
    - impression console : mesures DOM + verdict PASS/FAIL par état
    - captures : {OUT_DIR}/{ETAT}.png
    - code de sortie : 0 si tous les états passent la doctrine, 1 sinon (utilisable en gate)
--------------------------------------------------------------------------------
"""
import argparse
import json
import os
import re
import subprocess
import sys
import threading
import functools
import http.server
import socketserver
import time
from playwright.sync_api import sync_playwright

# --- Rendre le script indépendant du répertoire d'appel -----------------------
# Le script vit dans public/boutique/harnais/. On se replace toujours dans
# public/boutique (comme render-modal.py l'exige), quel que soit le cwd d'où on
# l'a lancé — c'est ce qui avait planté la session précédente (MODULE_NOT_FOUND
# en lançant depuis harnais/ au lieu de public/boutique).
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BOUTIQUE_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
os.chdir(BOUTIQUE_DIR)

PUBLIC_DIR = ".."   # racine servie = public/ (parent de boutique/), comme render-modal.py
PORT = 8124
FIXTURE = "tests/fixtures/golden-elite-pro-detail.js"

EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0001F1E6-\U0001F1FF"
    "]"
)


def load_fixture():
    try:
        raw = subprocess.check_output(
            ["node", "-e", f"console.log(JSON.stringify(require('./{FIXTURE}')))"],
            text=True, cwd=BOUTIQUE_DIR)
    except subprocess.CalledProcessError as e:
        print(f"ERREUR extraction fixture ({FIXTURE}) — vérifie que node est dispo "
              f"et que le script tourne bien depuis public/boutique : {e}", file=sys.stderr)
        sys.exit(1)
    return json.loads(raw)


def make_sobre(detail):
    """Dérive une version non-enrichie : pas de variantes, pas de contenu éditorial."""
    d = json.loads(json.dumps(detail))  # deep copy
    d["inventory_model"] = "SIMPLE"
    d["product"]["inventory_model"] = "SIMPLE"
    d["option_axes"] = []
    d["sellable_units"] = []
    d["content"] = {
        "brand": None, "short_description": d["content"].get("short_description"),
        "highlights": [], "specifications": [], "sections": [],
        "materials": None, "care": None, "warnings": [], "provenance": None,
    }
    d["media"] = d["media"][:1]  # une seule image, pas de galerie
    d["product"]["name"] = "Meuble raffiné"
    d["product"]["description"] = "Fonctionnel et décoratif"
    return d


def inspect(pg):
    return pg.evaluate("""() => {
      const box = s => { const e = document.querySelector(s);
        if (!e || getComputedStyle(e).display === 'none') return null;
        const r = e.getBoundingClientRect();
        return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; };
      const trustItems = document.querySelectorAll('.k-modal-trust-item');
      const trustPositions = Array.from(trustItems).map(e => {
        const r = e.getBoundingClientRect(); return {y: Math.round(r.y), text: e.textContent.trim()};
      });
      const suggCards = document.querySelectorAll('#k-sug-rail > *');
      const overlay = document.querySelector('.k-modal-cart-overlay');
      const overlayStyle = overlay ? getComputedStyle(overlay) : null;
      return {
        trustCount: trustItems.length,
        trustRows: [...new Set(trustPositions.map(p => p.y))].length,
        trustPositions,
        suggPeekVisible: box('#k-modal-sugg-peek'),
        suggSectionVisible: box('#k-modal-suggestions'),
        suggCardCount: suggCards.length,
        suggRailBox: box('#k-sug-rail'),
        overlayBg: overlayStyle ? overlayStyle.backgroundColor : null,
        overlayRadius: overlayStyle ? overlayStyle.borderRadius : null,
        buyBtnText: (document.querySelector('#k-buy-now-btn')||{}).textContent,
        deliveryChipText: (document.querySelector('.k-mdm-chip--delivery')||{}).textContent,
      };
    }""")


def render_state(name, detail, viewport, delivery, out_dir):
    d = json.loads(json.dumps(detail))
    if delivery == "AIR":
        d["delivery_options"] = [{"code": "AIR_EXPRESS", "label": "Livraison express",
                                   "available": True, "eta_label": "Sous 5 jours", "price_kmf": 2500}]
    else:
        d["delivery_options"] = [{"code": "SEA_STANDARD", "label": "Livraison standard",
                                   "available": True, "eta_label": "3-5 semaines", "price_kmf": 0}]
    p = d["product"]
    sp = {"id": p["id"], "name": p.get("name", "Produit test"),
          "price_kmf": d.get("pricing", {}).get("price_kmf", 15000),
          "description": p.get("description", ""), "images": [m["url"] for m in d.get("media", [])],
          "image_url": "", "category": p.get("category", "Sport"), "is_available": True,
          "stock": 12, "inventory_model": d["inventory_model"]}

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport=viewport, locale="fr-FR", device_scale_factor=2)
        page.route(re.compile(r"/api/"),
                   lambda r: r.fulfill(status=200, content_type="application/json", body="[]"))
        page.route(re.compile(r"/api/products(\?|$)"),
                   lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps([sp])))
        page.route(re.compile(r"/api/products/[^/]+/detail"),
                   lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(d)))
        page.goto(f"http://127.0.0.1:{PORT}/boutique/index.html", wait_until="domcontentloaded")
        page.wait_for_function("() => window._kbus && window._kstate", timeout=8000)
        page.evaluate("""(sp) => {
            if (!window._kstate.products.find(x => String(x.id) === String(sp.id)))
                window._kstate.products.push(sp);
            window._kbus.emit('modal:open', {id: sp.id});
        }""", sp)
        page.wait_for_selector("#k-modal", state="visible", timeout=6000)
        time.sleep(1.2)
        result = inspect(page)
        page.screenshot(path=f"{out_dir}/{name}.png", full_page=True)
        browser.close()
        return result


def verdict(name, r):
    """Confronte les mesures DOM à la doctrine des 4 états. Retourne (ok, raisons_echec)."""
    fails = []
    if r["trustCount"] != 3:
        fails.append(f"réassurance : {r['trustCount']} item(s) trouvé(s), 3 attendus")
    elif r["trustRows"] != 1:
        fails.append(f"réassurance sur {r['trustRows']} ligne(s), 1 seule attendue (grille 2+1 cassée)")
    if r["overlayRadius"] not in (None, "0px", "0px 0px 0px 0px"):
        fails.append(f"illustration encore en bulle : border-radius={r['overlayRadius']}")
    if EMOJI_RE.search(r.get("buyBtnText") or ""):
        fails.append(f"emoji détecté sur le CTA Acheter : {r['buyBtnText']!r}")
    if EMOJI_RE.search(r.get("deliveryChipText") or ""):
        fails.append(f"emoji détecté sur le chip livraison : {r['deliveryChipText']!r}")
    # suggestions : doit être monté (section visible) même si 0 carte (données absentes = ok,
    # mais la section/peek elle-même ne doit jamais disparaître par doctrine).
    if r["suggSectionVisible"] is None and r["suggPeekVisible"] is None:
        fails.append("bloc suggestions totalement absent du DOM/masqué (doit toujours être monté)")
    return (len(fails) == 0, fails)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--states", default="A,B,C,D",
                     help="Sous-ensemble d'états à rendre, ex: --states C,D (défaut: tous)")
    ap.add_argument("--out", default="/tmp/modal_shots", help="Dossier de sortie des captures")
    args = ap.parse_args()
    wanted = {s.strip().upper() for s in args.states.split(",") if s.strip()}

    enriched_detail = load_fixture()
    sobre_detail = make_sobre(enriched_detail)

    all_states = {
        "A_desktop_enrichi":    (enriched_detail, {"width": 1280, "height": 900}, "SEA"),
        "B_desktop_nonenrichi": (sobre_detail,    {"width": 1280, "height": 900}, "SEA"),
        "C_mobile_enrichi":     (enriched_detail, {"width": 390, "height": 844}, "AIR"),
        "D_mobile_nonenrichi":  (sobre_detail,    {"width": 390, "height": 844}, "SEA"),
    }
    states = {n: v for n, v in all_states.items() if n[0] in wanted}
    if not states:
        print(f"Aucun état ne correspond à --states {args.states} (attendu parmi A,B,C,D)", file=sys.stderr)
        sys.exit(2)

    os.makedirs(args.out, exist_ok=True)

    Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=PUBLIC_DIR)

    class Server(socketserver.TCPServer):
        allow_reuse_address = True
        def handle_error(self, *a):
            pass

    srv = Server(("127.0.0.1", PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    time.sleep(0.5)

    results = {}
    verdicts = {}
    try:
        for name, (detail, vp, delivery) in states.items():
            print(f"--- {name} ---")
            r = render_state(name, detail, vp, delivery, args.out)
            results[name] = r
            print(json.dumps(r, ensure_ascii=False, indent=2))
            ok, fails = verdict(name, r)
            verdicts[name] = (ok, fails)
    finally:
        srv.shutdown()

    print(f"\nCaptures dans {args.out}/\n")
    print("=== VERDICT (doctrine 4-états) ===")
    all_ok = True
    for name, (ok, fails) in verdicts.items():
        status = "PASS" if ok else "FAIL"
        print(f"{status}  {name}")
        for f in fails:
            print(f"       - {f}")
        all_ok = all_ok and ok

    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
