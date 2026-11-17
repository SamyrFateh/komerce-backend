import json,re,collections,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); from gold import G,MB,CP
d=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','..','tests','fixtures','cj-real-498-20261112.json'),encoding='utf-8')); P=d['products']
def opts(i): return [tuple(o.split('/')) if '/' in o else (o,None) for o in G[i].split('|')]
gcat=lambda i:{o[0] for o in opts(i) if o[0]!='X'}; gleaf=lambda i:{o for o in opts(i) if o[1]}
# Lexique d'objets généraliste (familles transverses), ordonné : accessoires et composés d'abord.
LEX=[
 (r'phone (holder|stand|mount|case|shell|lanyard)|car phone|phone case|charging cable|usb c|type ?c|charger cable|smartphone|unlocked phone|mobile phone charger|5g .*phone',('Tech','Phones')),
 (r'watch (band|box|packaging)|gift box|gift bag|gift card|wrapping paper|gift paper|photo album|keychain',(CP,'Cadeau')),
 (r'smart ?watch|quartz|wrist ?watch|digital watch|\bwatch\b',('Tech','Montres')),
 (r'earbuds?|earphones?|headphones?|headsets?|speaker|microphone|audio|bluetooth (adapter|transmitter|receiver)',('Tech','Audio')),
 (r'brake|master cylinder|caliper',('Auto','Freinage')),
 (r'cabin air filter|air filter|air cleaner|oil filter',('Auto','Filtres')),
 (r'fog light|headlight|car .*light|led .*car|car light|drl',('Auto','Éclairage')),
 (r'motorcycle',('Auto','Moto')),
 (r'dash ?cam|rearview|driving recorder|car (sticker|alarm|vacuum|drill sticker)|automobile sticker',('Auto','Accessoires')),
 (r'ride on|toy car|\btoy\b|plush',('Enfant','Jouets')),
 (r'pencil (case|bag)|stationery|school|backpack|watercolor',('Enfant','École')),
 (r'baby|diaper|stroller|infant|toddler',('Enfant','Bébé')),
 (r"children|kids?'?|boys?|girls?",(MB,'Enfant')),
 (r'smoke alarm|door .*alarm|window .*alarm|alarm|padlock|smart lock|safe |lockout|door chime|sensor alarm|safety lock',('Bricolage','Sécurité')),
 (r'solar panel|solar (wire|cable|connector)|nm b wire|power strip|power cord|generator cord|extension cable|fish tape|wire (spool|puller)|cable (dispenser|locator)',('Bricolage','Electricité')),
 (r'drill|screwdriver|pliers|wrench|crimping|tool set|garden tool|thermal imaging|screw extractor|sharpener|doweling',('Bricolage','Outillage')),
 (r'sublimation|heat press|heat transfer|custom photo|custom mug|engraving',(CP,'Impression')),
 (r'lunch (bag|box)|kitchen|cookware|mug|egg poacher|hot pot|garlic|dumpling|bottle opener|tableware|sink (tray|caddy)|tea ',('Maison','Cuisine')),
 (r'organizer|shoe rack|garment rack|wardrobe|storage cabinet|file cabinet|filing cabinet|rolling cart|wall hook|umbrella holder|toothpaste holder',('Maison','Rangement')),
 (r'wall decor|home decor|wall sticker|party decoration|holiday decor|artificial flower|photo frame|banner|decorative light|lamp',('Maison','Déco')),
 (r'lumbar support|fan\b',('Maison','Confort')),
 (r'makeup|lip gloss|eyebrow|nail (drill|file)|manicure|blackhead|acne|skin care|hair care|tattoo sticker|beauty',(MB,'Beauté')),
 (r'football shoes|soccer',('Sport','Foot')),
 (r"\bmen'?s?\b.*(shoes|pants|shirt|suit|sweater|vest|loafers|slippers|shorts|clothing)|(shoes|pants|shirt|suit|loafers|slippers|shorts|sweater).*\bmen\b|for men\b",(MB,'Homme')),
 (r"women|ladies|female|dress|blouse|camisole|high heels",(MB,'Femme')),
 (r'necklace|bracelet|ring\b|pendant|crown|headband|tote|bag\b|sneakers|shoes|clothing',(MB,None)),
]
def norm(s): return re.sub(r'[^a-z0-9]+',' ',s.lower())
def obj(title):
    t=norm(title)
    if re.search(r'men and women|men women|for men and',t): return (MB,None) if re.search(r'clothing|coat|tops|cape|shoes',t) else None
    for rx,dest in LEX:
        if re.search(rx,t): return dest
    return None
def pathcat(p):
    r,b,l=[x.strip() for x in p['supplier_category'].split('>')]
    m={'Home, Garden & Furniture':'Maison','Automobiles & Motorcycles':'Auto','Health, Beauty & Hair':MB,'Home Improvement':'Bricolage',"Women's Clothing":MB,"Men's Clothing":MB,'Consumer Electronics':'Tech','Phones & Accessories':'Tech','Toys, Kids & Babies':'Enfant','Bags & Shoes':MB,'Sports & Outdoors':'Sport'}
    if r=='Jewelry & Watches': return 'Tech' if 'Watch' in b else MB
    return m.get(r)
def report(name, decide):
    leaf=par=okl=okc=wrong=0; errs=[]
    for i,p in enumerate(P):
        v=decide(i,p)
        if not v: continue
        c,s=v
        if s: 
            leaf+=1
            if (c,s) in gleaf(i): okl+=1; okc+=1
            elif c in gcat(i): okc+=1
            else: wrong+=1; errs.append((i,p['product_name'][:34],v,G[i]))
        else:
            par+=1
            if c in gcat(i): okc+=1
            else: wrong+=1; errs.append((i,p['product_name'][:34],v,G[i]))
    n=leaf+par
    print(f"{name}: placés {n}/498 ({n/498:.1%}) dont feuille {leaf}, parent {par} | précision catégorie {okc}/{n} ({okc/max(n,1):.1%}) | précision feuille {okl}/{leaf} ({okl/max(leaf,1):.1%}) | catégorie fausse {wrong}")
    return errs
main=lambda i,p:(p['category'],p['subcategory']) if p['status']=='AUTO_CLASSIFIED' else None
report('A  main actuel',main)
report('B  objet seul (titre)',lambda i,p:main(i,p) or obj(p['product_name']))
def agree(i,p,leaf=True):
    m=main(i,p)
    if m: return m
    o=obj(p['product_name']); pc=pathcat(p)
    if o and pc and o[0]==pc: return o if leaf else (o[0],None)
    return None
e=report('C  objet ET chemin d’accord (feuille)',agree)
report('C2 objet ET chemin d’accord (parent seulement)',lambda i,p:agree(i,p,False))
def disc(i,p):
    m=main(i,p)
    if m: return m
    o=obj(p['product_name']); t=(p.get('discovery_target') or '').split('/')
    return o if (o and len(t)==2 and o[0]==t[0]) else None
report('D  objet ET Discovery d’accord (pour mémoire)',disc)
print('erreurs C:',e[:12])
noobj=[i for i,p in enumerate(P) if not main(i,p) and not obj(p['product_name'])]
print('sans objet reconnu',len(noobj),[P[i]['product_name'][:38] for i in noobj[:14]])
dis=[i for i,p in enumerate(P) if not main(i,p) and obj(p['product_name']) and pathcat(p) and obj(p['product_name'])[0]!=pathcat(p)]
print('objet reconnu mais chemin en désaccord',len(dis),'dont objet juste',sum(1 for i in dis if obj(P[i]['product_name'])[0] in gcat(i)))
def vote(i,p):
    m=main(i,p)
    if m: return m
    o=obj(p['product_name'])
    if not o: return None
    pc=pathcat(p); t=(p.get('discovery_target') or '').split('/')
    if pc==o[0] or (len(t)==2 and t[0]==o[0]): return o
    return None
report('E  objet + (chemin OU Discovery) d’accord',vote)
rest=[i for i,p in enumerate(P) if not agree(i,p)]
cl=collections.Counter()
for i in rest:
    o=obj(P[i]['product_name']); cl[(o, ' > '.join(x.strip() for x in P[i]['supplier_category'].split('>')[:2]))]+=1
print('reste après C',len(rest),'groupes (objet × branche)',len(cl),'| top 12 couvrent',sum(v for _,v in cl.most_common(12)))
fam=collections.Counter(obj(P[i]['product_name']) for i in rest); print('groupes par famille d’objet seule',len(fam), fam.most_common(8))
