"""Simulation économique Hub Komerce — hypothèses explicites, PAS des coûts réels.
4 modèles d'achat x même flux aval (départs hebdomadaires par marché).
Usage: python3 -I sim.py [n_orders] [seed_count]
"""
import random, statistics, sys, json

H = dict(
    days=14,                      # horizon de prise de commandes
    markets={'KM': 0.5, 'CM': 0.3, 'CG': 0.2},
    suppliers=8,                  # fournisseurs communs aux marchés
    sku_per_supplier=12,
    items_per_order=(1, 4),
    qty_per_item=(1, 3),
    unit_cost_eur=(4, 40),        # coût fournisseur unitaire
    margin_price_mult=2.2,        # prix de vente ≈ coût x 2.2 (hors N1 aval)
    po_fixed_eur=9.0,             # frais fixes par envoi fournisseur->Hub (port local, livraison)
    payment_fixed_eur=1.0,        # frais fixes par paiement fournisseur
    payment_pct=0.015,            # frais % paiement / change
    qty_break_qty=10, qty_break_pct=0.05,  # remise quantitative par SKU et par envoi
    labor_eur_h=8.0,              # coût horaire agent Hub (hypothèse)
    min_per_po=12, min_per_po_line=1.5, min_per_receipt=8, min_per_parcel=5,
    lead_time=(2, 5), late_prob=0.15, late_extra=(3, 6),
    departure_weekday={'KM': 3, 'CM': 4, 'CG': 4},  # jour de départ (0=lundi) ; cut-off J-1 au Hub
    shipment_fixed_eur=180.0, shipment_per_kg=5.5, kg_per_item=0.6,
    delay_cost_pct_day=0.004,     # risque client / remboursement par jour de retard au-delà de la promesse
    promise_days=21,
    capital_rate_year=0.15,
    urgent_share=0.10,
    customer_cash='on_collection',  # paiement client au retrait (cash relais) : pire cas trésorerie
)

def gen_orders(n, rnd):
    orders = []
    mk = list(H['markets']); w = list(H['markets'].values())
    catalog = [(s, k, round(rnd.uniform(*H['unit_cost_eur']), 2)) for s in range(H['suppliers']) for k in range(H['sku_per_supplier'])]
    # popularité concentrée : 20% des SKU font 60% des lignes
    hot = catalog[: len(catalog) // 5]
    for i in range(n):
        day = rnd.uniform(0, H['days'])
        m = rnd.choices(mk, w)[0]
        lines = []
        for _ in range(rnd.randint(*H['items_per_order'])):
            s, k, c = rnd.choice(hot) if rnd.random() < 0.6 else rnd.choice(catalog)
            lines.append(dict(sup=s, sku=(s, k), cost=c, qty=rnd.randint(*H['qty_per_item'])))
        orders.append(dict(id=i, t=day, m=m, lines=lines, urgent=rnd.random() < H['urgent_share']))
    return orders

def next_departure(m, t):
    wd = H['departure_weekday'][m]
    d = int(t) + 1  # cut-off : arrivée Hub au plus tard la veille du départ
    while d % 7 != wd:
        d += 1
    return d

def purchase_times(model, orders):
    """Retourne la liste des envois fournisseur : (t_envoi, supplier, market_or_None, [lines])."""
    needs = sorted(((o['t'], o, l) for o in orders for l in o['lines']), key=lambda x: x[0])
    sends = []
    if model == 'M1_a_la_commande':
        for o in orders:
            by = {}
            for l in o['lines']:
                by.setdefault(l['sup'], []).append((o, l))
            for s, ls in by.items():
                sends.append((o['t'], s, o['m'], ls))
        return sends
    if model == 'M2_periodique_quotidien':
        buckets = {}
        for t, o, l in needs:
            cut = int(t) + 1  # passage du lendemain matin
            buckets.setdefault((cut, l['sup'], o['m']), []).append((o, l))
        return [(k[0], k[1], k[2], v) for k, v in buckets.items()]
    if model in ('M3_seuils_dynamiques', 'M4_multi_marche'):
        # Règle : on commande un groupe (fournisseur, marché) quand
        #  (a) valeur >= seuil, ou (b) besoin le plus ancien >= 48 h, ou (c) urgence,
        #  ou (d) la date limite pour attraper le prochain départ est atteinte.
        # Revue quotidienne (passage du matin) ; urgences commandées le jour même.
        thr = H.get('threshold_eur', 150.0); max_wait = H.get('max_wait_days', 2)
        pending = {}
        i = 0
        for day in range(0, int(H['days']) + max_wait + 2):
            while i < len(needs) and needs[i][0] < day:
                t, o, l = needs[i]; pending.setdefault((l['sup'], o['m']), []).append((t, o, l)); i += 1
            for key in list(pending):
                cur = pending[key]
                if not cur:
                    continue
                val = sum(x[2]['cost'] * x[2]['qty'] for x in cur)
                oldest = min(x[0] for x in cur)
                m = key[1]
                dep = next_departure(m, day + H['lead_time'][1])
                latest_safe = dep - 1 - H['lead_time'][1]   # au-delà, on rate le départ suivant
                if val >= thr or (day - oldest) >= max_wait or any(x[1]['urgent'] for x in cur) or day >= latest_safe:
                    sends.append((day, key[0], key[1], [(x[1], x[2]) for x in cur])); pending[key] = []
        if model == 'M4_multi_marche':
            # Même jour + même fournisseur : un seul envoi physique/paiement, POs restant mono-marché
            merged = {}
            for t, s, m, ls in sends:
                merged.setdefault((int(t), s), []).append((t, s, m, ls))
            out = []
            for (d, s), grp in merged.items():
                out.append((max(g[0] for g in grp), s, None, [x for g in grp for x in g[3]], len(grp)))
            return out
        return sends
    raise ValueError(model)

def simulate(model, orders, rnd):
    sends = purchase_times(model, orders)
    cost = dict(supplier_fixed=0, payment=0, labor=0, qty_break_saving=0, delay=0, capital=0, shipment=0)
    arrive = {}  # (order_id, line idx) -> jour d'arrivée Hub
    n_po = 0; n_lines_po = 0; n_sends = 0
    for snd in sends:
        t, s, m, ls = snd[:4]
        n_market_pos = snd[4] if len(snd) > 4 else 1
        n_sends += 1; n_po += n_market_pos
        value = sum(l['cost'] * l['qty'] for _, l in ls)
        # remise quantitative par SKU dans l'envoi
        qsku = {}
        for _, l in ls:
            qsku[l['sku']] = qsku.get(l['sku'], 0) + l['qty']
        disc = sum(H['qty_break_pct'] * l['cost'] * l['qty'] for _, l in ls if qsku[l['sku']] >= H['qty_break_qty'])
        cost['qty_break_saving'] += disc
        cost['supplier_fixed'] += H['po_fixed_eur']
        cost['payment'] += H['payment_fixed_eur'] + H['payment_pct'] * (value - disc)
        n_lines_po += len(ls)
        cost['labor'] += (H['min_per_po'] * n_market_pos + H['min_per_po_line'] * len(ls) + H['min_per_receipt']) / 60 * H['labor_eur_h']
        lt = rnd.uniform(*H['lead_time']) + (rnd.uniform(*H['late_extra']) if rnd.random() < H['late_prob'] else 0)
        for o, l in ls:
            arrive[(o['id'], id(l))] = t + lt
            # capital immobilisé : paiement fournisseur à t, encaissement client au retrait
            pass
    # aval : un colis par commande import, départ au premier créneau où TOUT est arrivé (pas de scission)
    ship_groups = {}
    order_ready = {}; lead = []; cap = 0.0; delay = 0.0; revenue = 0.0
    for o in orders:
        ready = max(arrive[(o['id'], id(l))] for l in o['lines'])
        dep = next_departure(o['m'], ready)
        transit = 7 if o['m'] == 'KM' else 9
        delivered = dep + transit + 2
        lt_days = delivered - o['t']
        lead.append(lt_days)
        val = sum(l['cost'] * l['qty'] for l in o['lines'])
        price = val * H['margin_price_mult']; revenue += price
        if lt_days > H['promise_days']:
            delay += H['delay_cost_pct_day'] * price * (lt_days - H['promise_days'])
        # trésorerie : achat payé à l'envoi fournisseur, encaissé au retrait (on_collection)
        paid_t = min(arrive[(o['id'], id(l))] for l in o['lines']) - H['lead_time'][0]
        cap += val * (delivered - paid_t) * H['capital_rate_year'] / 365
        ship_groups.setdefault((o['m'], dep), []).append(o)
        cost['labor'] += H['min_per_parcel'] / 60 * H['labor_eur_h']
    for (m, dep), os_ in ship_groups.items():
        items = sum(l['qty'] for o in os_ for l in o['lines'])
        cost['shipment'] += H['shipment_fixed_eur'] + H['shipment_per_kg'] * H['kg_per_item'] * items
    cost['delay'] = delay; cost['capital'] = cap
    total = sum(v for k, v in cost.items() if k != 'qty_break_saving') - cost['qty_break_saving']
    n = len(orders)
    return dict(model=model, sends=n_sends, market_pos=n_po, shipments=len(ship_groups),
                cost_per_order=total / n,
                upstream_per_order=(cost['supplier_fixed'] + cost['payment'] - cost['qty_break_saving']) / n,
                labor_per_order=cost['labor'] / n, shipment_per_order=cost['shipment'] / n,
                delay_per_order=cost['delay'] / n, capital_per_order=cost['capital'] / n,
                lead_median=statistics.median(lead), lead_p90=sorted(lead)[int(0.9 * n)],
                late_share=sum(1 for x in lead if x > H['promise_days']) / n,
                contribution_pct=(revenue - sum(sum(l['cost'] * l['qty'] for l in o['lines']) for o in orders) - total) / revenue,
                hub_hours=cost['labor'] / H['labor_eur_h'])

def run(n=100, seeds=30):
    models = ['M1_a_la_commande', 'M2_periodique_quotidien', 'M3_seuils_dynamiques', 'M4_multi_marche']
    agg = {m: [] for m in models}
    for sd in range(seeds):
        orders = gen_orders(n, random.Random(sd))
        for m in models:
            agg[m].append(simulate(m, orders, random.Random(1000 + sd)))
    out = []
    for m in models:
        rs = agg[m]
        out.append({k: (round(statistics.mean(r[k] for r in rs), 3) if isinstance(rs[0][k], (int, float)) else rs[0][k]) for k in rs[0]})
    return out

if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    print(json.dumps(run(n), indent=1))
