# Lot AliExpress jamais vu : 216 produits (collecte GitHub Actions du 2026-11-15). Lexique de sim.py GELÉ.
# Seul ajout : table des racines AliExpress, écrite à partir des noms de chemins, avant lecture des résultats.
# Étiquettes de référence : lecture des 216 titres par Fable (défaut par branche + exceptions), non validées par un humain.
import csv,io,os,sys,contextlib,collections
H=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,H)
with contextlib.redirect_stdout(io.StringIO()): import sim
MB='Mode & Beauté'; TP='Tech/Phones'; AA='Auto/Accessoires'; EJ='Enfant/Jouets'
ROOT={'Phones & Telecommunications Accessories':'Tech','Consumer Electronics':'Tech','Computer & Office':'Tech',
      'Automobiles, Parts & Accessories':'Auto','Shoes':MB,"Men's Clothing":MB,'Mother & Kids':MB,'Toys & Hobbies':'Enfant'}
DEF={'Phones & Telecommunications Accessories':TP,'Automobiles, Parts & Accessories':AA,'Computer & Office':'Tech',
     'Computer & Office > Tablet Accessories & Parts':'Tech|'+TP,'Computer & Office > 3D Printing & Additive Manufacturing':'Tech|X',
     "Shoes > Women's Shoes":MB+'/Femme',"Shoes > Men's Shoes":MB+'/Homme',"Men's Clothing > Shorts":MB+'/Homme',
     "Mother & Kids > Children's Clothing":MB+'/Enfant','Toys & Hobbies > Pools & Water Fun':EJ+'|Enfant/Bébé'}
ID={'1005008532886813':AA+'|'+TP,'1005011562175234':AA+'|'+TP,'1005010502982336':AA+'|'+TP,'1005012823876161':TP+'|'+AA,
 '1005012762647301':'Tech|Tech/Audio|'+TP,'1005010628362099':TP+'|Tech','1005010537945275':'Tech|'+AA+'|Bricolage/Sécurité',
 '1005004702409003':TP+'|Tech|Maison/Rangement','1005012229470656':TP+'|Tech','1005007945002026':'Tech|X',
 '1005011930563790':'Maison/Rangement|Enfant/École','1005010248868023':'X|Enfant/École',
 '1005007288599904':MB+'/Femme|'+MB,'1005008742207824':MB+'|'+MB+'/Femme','1005006820163948':MB+'/Homme|'+MB,
 '1005008052935637':MB+'/Femme|'+MB,'1005006666152433':MB,'1005007740878215':MB+'|'+MB+'/Femme','1005005677235457':MB+'|'+MB+'/Femme',
 '1005007053988921':MB+'/Femme|'+MB,'1005008332811379':MB+'/Homme|'+MB,'1005008756569365':MB+'/Homme|'+MB,
 '1005013271662860':MB+'/Enfant','1005012440698212':MB+'|'+MB+'/Homme',
 '1005006243636344':EJ+'|Enfant/Bébé|Maison/Rangement','1005013243661430':EJ+'|Sport/Outdoor','1005008517135061':'Maison/Déco|'+EJ,
 '1005006258958851':AA+'|'+EJ,'1005010080992448':EJ+'|Créations personnelles/Cadeau','1005008487334943':EJ+'|Créations personnelles/Cadeau'}
IDX={49:TP+'|Auto/Moto',54:TP+'|Tech|Maison/Rangement',58:TP+'|'+AA,65:AA+'|'+TP,66:AA+'|'+TP,79:AA+'|'+TP,77:AA+'|'+TP,
 75:AA+'|Auto/Éclairage',110:'Tech|Tech/Audio',115:'X|Tech',117:'Tech|X',158:MB+'|'+MB+'/Femme',161:MB+'/Femme|'+MB,
 163:MB+'|'+MB+'/Femme',168:MB,157:MB+'/Homme|'+MB,164:MB+'/Homme|'+MB,209:MB+'|'+MB+'/Homme',214:MB+'|'+MB+'/Homme'}
rows=list(csv.DictReader(open(os.path.join(H,'aliexpress-holdout-216-20261115.csv'),encoding='utf-8')))
def gold(i,r):
    if i in IDX: return IDX[i]
    if r['supplier_product_id'] in ID: return ID[r['supplier_product_id']]
    c=r['supplier_category']; return DEF.get(c) or DEF.get(c.split('>')[0].strip())
n=okc=leaf=okl=rec=obj_ok=dis=dis_ok=0; errs=[]; by=collections.defaultdict(lambda:[0,0,0])
for i,r in enumerate(rows):
    g=gold(i,r); assert g,(i,r['supplier_category'])
    opts=[tuple(o.split('/')) if '/' in o else (o,None) for o in g.split('|')]; cats={o[0] for o in opts if o[0]!='X'}
    root=r['supplier_category'].split('>')[0].strip(); o=sim.obj(r['product_name']); pc=ROOT.get(root)
    rec+=bool(o); obj_ok+=bool(o and o[0] in cats); b=by[root]; b[0]+=1
    if o and pc and o[0]!=pc: dis+=1; dis_ok+=o[0] in cats
    if o and pc and o[0]==pc:
        n+=1; b[1]+=1; c_ok=o[0] in cats; okc+=c_ok; b[2]+=c_ok
        if o[1]:
            leaf+=1; l_ok=o in opts; okl+=l_ok
            if not l_ok: errs.append(f"FEUILLE {o} attendu={g} | {r['product_name'][:60]}")
        if not c_ok: errs.append(f"CATEGORIE {o} attendu={g} | {r['product_name'][:60]}")
N=len(rows)
print(f"ALIEXPRESS-216 n={N} | objet reconnu {rec} ({rec/N:.1%}) dont catégorie juste {obj_ok}")
print(f"règle retenue (objet + branche d'accord) : placés {n} ({n/N:.1%}) | précision catégorie {okc}/{n} ({okc/n:.1%}) | précision feuille {okl}/{leaf} ({okl/leaf:.1%})")
print(f"désaccord objet/branche {dis} (objet juste {dis_ok}) | sans objet reconnu {N-rec} | racine sans table {sum(1 for r in rows if not ROOT.get(r['supplier_category'].split('>')[0].strip()))}")
for k,(t,p,c) in sorted(by.items(),key=lambda x:-x[1][0]): print(f"  {k[:42]:42s} total {t:3d} | placés {p:3d} | catégorie juste {c:3d}")
print('\n'.join(errs))
