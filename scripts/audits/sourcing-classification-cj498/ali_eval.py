# Lot AliExpress jamais vu (export staging du 2026-11-15, 19 produits). Lexique de sim.py inchangé.
# Seul ajout : la table des racines AliExpress (2 lignes), équivalent de la table des branches CJ.
import csv,io,os,sys,contextlib
H=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,H)
with contextlib.redirect_stdout(io.StringIO()): import sim
ROOT={'Automobiles, Parts & Accessories':'Auto','Phones & Telecommunications Accessories':'Tech'}
TP='Tech/Phones'; AA='Auto/Accessoires'
GOLD=[AA,AA,TP,AA,TP+'|'+AA,TP,TP,TP,TP,TP,TP,'Sport|X',TP+'|'+AA,TP,TP,TP,AA,TP+'|'+AA,TP+'|Maison/Rangement']
rows=list(csv.DictReader(open(os.path.join(H,'aliexpress-staging-20261115.csv'),encoding='utf-8')))
assert len(rows)==len(GOLD)
n=okc=okl=obj_ok=rec=0; out=[]
for r,g in zip(rows,GOLD):
    opts=[tuple(o.split('/')) if '/' in o else (o,None) for o in g.split('|')]
    cats={o[0] for o in opts}; o=sim.obj(r['product_name']); pc=ROOT.get(r['supplier_category'].split('>')[0].strip())
    rec+=bool(o); obj_ok+=bool(o and o[0] in cats)
    placed=bool(o and pc and o[0]==pc)
    if placed:
        n+=1; okc+=o[0] in cats; okl+=o in opts
    out.append(('AUTO ' if placed else 'REVUE')+f" | objet={o} | branche={pc} | attendu={g} | {r['product_name'][:48]}")
print(f"ALIEXPRESS n={len(rows)} | objet reconnu {rec} dont catégorie juste {obj_ok} | règle retenue : placés {n} ({n/len(rows):.0%}), catégorie juste {okc}/{n}, feuille juste {okl}/{n}")
print('\n'.join(out))
