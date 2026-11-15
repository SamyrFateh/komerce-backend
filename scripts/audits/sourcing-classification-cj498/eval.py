import json,collections,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); from gold import G,GENERIC,MB,CP
d=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','..','tests','fixtures','cj-real-498-20261112.json'),encoding='utf-8')); P=d['products']
miss=[i for i in range(len(P)) if i not in G]; print('unlabelled',miss)
def opts(i): return [tuple(o.split('/')) if '/' in o else (o,None) for o in G[i].split('|')]
def gcat(i): return {o[0] for o in opts(i) if o[0]!='X'}
def gleaf(i): return {o for o in opts(i) if o[1]}
C=collections.Counter
kind=C()
for i in range(len(P)):
    o=opts(i)
    if all(x[0]=='X' for x in o): kind['aucun rayon actif']+=1
    elif gleaf(i): kind['feuille existante']+=1
    else: kind['parent seulement']+=1
print('GOLD',dict(kind))
# moteur main (fixture)
auto=[i for i,p in enumerate(P) if p['status']=='AUTO_CLASSIFIED']
ok_leaf=sum(1 for i in auto if (P[i]['category'],P[i]['subcategory']) in gleaf(i)); ok_cat=sum(1 for i in auto if P[i]['category'] in gcat(i))
print('MAIN auto',len(auto),'leaf ok',ok_leaf,'cat ok',ok_cat,[ (i,P[i]['product_name'][:40],P[i]['subcategory'],G[i]) for i in auto if (P[i]['category'],P[i]['subcategory']) not in gleaf(i)])
# Discovery comme classeur
dl=dc=0; bad=[]
for i,p in enumerate(P):
    t=(p.get('discovery_target') or '').split('/')
    if len(t)==2:
        if (t[0],t[1]) in gleaf(i): dl+=1
        if t[0] in gcat(i): dc+=1
        elif len(bad)<0: bad.append((p['product_name'][:30],p['discovery_target'],G[i]))
print('DISCOVERY leaf ok',dl,'cat ok',dc,'of',len(P))
# chemin fournisseur racine -> catégorie
def pathcat(p):
    r,b,l=[x.strip() for x in p['supplier_category'].split('>')]
    m={'Home, Garden & Furniture':'Maison','Automobiles & Motorcycles':'Auto','Health, Beauty & Hair':MB,'Home Improvement':'Bricolage',"Women's Clothing":MB,"Men's Clothing":MB,'Consumer Electronics':'Tech','Phones & Accessories':'Tech','Toys, Kids & Babies':'Enfant','Bags & Shoes':MB,'Sports & Outdoors':'Sport'}
    if r=='Jewelry & Watches': return 'Tech' if 'Watch' in b else MB
    return m.get(r)
pc=[(i,pathcat(p)) for i,p in enumerate(P)]
has=[(i,c) for i,c in pc if c]; okp=sum(1 for i,c in has if c in gcat(i))
print('PATH-ROOT cat proposée',len(has),'ok',okp,'prec',round(okp/len(has),3))
gen=[i for i,p in enumerate(P) if p['product_name'].strip().lower().startswith(GENERIC) or p['product_name'].strip().lower() in GENERIC]
print('titres génériques',len(gen))
# contradiction chemin/objet = la catégorie du chemin n'est pas dans le gold (hors X)
contra=[i for i,c in has if c not in gcat(i) and gcat(i)]
print('contradiction chemin/objet',len(contra),'dont titres génériques',len(set(contra)&set(gen)))
byroot=collections.defaultdict(lambda:[0,0])
for i,c in has:
    r=P[i]['supplier_category'].split('>')[0].strip(); byroot[r][0]+=1; byroot[r][1]+= c in gcat(i)
for r,(n,k) in sorted(byroot.items(),key=lambda x:-x[1][0]): print(f'  {r[:30]:30s} {k}/{n}')
bybranch=collections.defaultdict(lambda:[0,0])
for i,c in has:
    b=' > '.join(x.strip() for x in P[i]['supplier_category'].split('>')[:2]); bybranch[b][0]+=1; bybranch[b][1]+= c in gcat(i)
print('branches peu fiables:',[(b,k,n) for b,(n,k) in bybranch.items() if n>=4 and k/n<0.8])
# causes des non-placés sur main
non=[i for i in range(len(P)) if P[i]['status']!='AUTO_CLASSIFIED']
cause=C()
for i in non:
    if not gcat(i): cause['1 aucun rayon actif']+=1
    elif not gleaf(i): cause['2 parent seul (pas de feuille active)']+=1
    elif P[i]['evidence']=='CLOTHING_SOURCE_OBJECT_CONTRADICTION': cause['3 contradiction détectée par le moteur']+=1
    elif i in gen: cause['4 titre générique (objet non identifiable)']+=1
    elif i in contra: cause['5 chemin fournisseur faux, titre clair']+=1
    else: cause['6 chemin cohérent + titre clair, aucune règle']+=1
print('CAUSES',len(non)); [print('  ',k,v) for k,v in sorted(cause.items())]

