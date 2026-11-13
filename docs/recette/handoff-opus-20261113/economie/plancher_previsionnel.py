"""Démonstration reproductible du plancher prévisionnel Komerce (avant toute expédition).

Toutes les valeurs sont des HYPOTHÈSES documentées (niveau de preuve 5) sauf mention ;
chacune se remplace par un devis / tarif dès qu'il existe, sans changer la méthode.
Usage : python3 -I plancher_previsionnel.py
"""
EUR = 491.96          # KMF / EUR — parité fixe EUR/KMF (niveau 1, réglementaire)
AED = 134.0           # KMF / AED — à lire depuis l'autorité FX (niveau 3)

# Paramètres corridor KM (Dubaï → Moroni, maritime groupage). (favorable, central, défavorable)
CORRIDOR = {
    'fret_eur_m3':        (150, 180, 250),       # tarif groupage €/m³ — à remplacer par devis
    'minimum_m3':         (1.0, 1.0, 1.0),       # minimum facturable du transporteur (devis)
    'volume_lot_m3':      (5.0, 3.0, 1.5),       # volume prévu par lot : DÉCISION de planification, pas une moyenne
    'forfait_lot_kmf':    (80_000, 110_000, 150_000),  # transitaire + port + inspection, par lot
    'assurance_pct_cif':  (0.5, 0.5, 0.5),
    'droits_pct_cif':     (0.0, 20.0, 42.0),     # à remplacer par le taux du code SH (tarif douanier)
    'dernier_km_kmf':     (400, 500, 700),       # port → relais Grande Comore, par commande
    'frais_banque_pct':   (1.0, 1.5, 2.0),       # paiement fournisseur + conversion, % achat
    'p_casse_pct':        (0.5, 1.0, 3.0),       # perte/casse transport, % de N1 exposé
    'p_non_retrait_pct':  (2.0, 5.0, 10.0),      # retrait non effectué : coûts aval perdus
}
HUB = {'consommables_kmf': (40, 50, 80), 'carton_kmf': (250, 300, 400), 'carton_utile_m3': 0.04}
N2 = {'collecte_cash_kmf': 200, 'commission_relais_kmf': 600, 'stripe_pct': 1.5, 'stripe_fixe_kmf': 130}
N3_KM = {'charges_mensuelles_kmf': 1_200_000, 'hub_aed_mois': 7_000, 'part_hub_km': 1.0}

PRODUITS = [
    # nom, circuit, achat EUR, livraison fournisseur→Hub EUR, kg, m³, prix commerciaux testés (KMF)
    ('Accessoire léger (écouteurs)', 'import', 8.0, 1.5, 0.15, 0.0008, (7_500, 9_000, 12_000)),
    ('Article volumineux (ventilateur)', 'import', 25.0, 4.0, 6.0, 0.0600, (22_000, 27_000, 32_000)),
    ('Smartphone milieu de gamme', 'import', 120.0, 3.0, 0.5, 0.0015, (75_000, 85_000, 95_000)),
    ('Accessoire en stock local Moroni', 'local', None, None, 0.15, 0.0008, (7_500, 9_000, 12_000)),
]
ACHAT_LOCAL_KMF = 5_000   # facture fournisseur local (niveau 1)


def s(param, i):
    return param[i] if isinstance(param, tuple) else param


def n1(prod, i):
    nom, circuit, achat_eur, livr_eur, kg, m3, _ = prod
    c = {k: s(v, i) for k, v in CORRIDOR.items()}
    lignes = []
    if circuit == 'local':
        achat = ACHAT_LOCAL_KMF
        lignes += [('Achat local (facture)', achat, 'achat', 'niveau 1')]
        dernier = c['dernier_km_kmf']
        lignes += [('Livraison stock local → relais', dernier, 'par commande', 'niveau 5')]
        return lignes, achat + dernier, achat, dernier
    achat = achat_eur * EUR
    banque = achat * c['frais_banque_pct'] / 100
    livr = livr_eur * EUR
    conso = s(HUB['consommables_kmf'], i)
    carton = s(HUB['carton_kmf'], i) * max(m3 / HUB['carton_utile_m3'], 0)  # part au volume du carton
    # Fret : tarif au m³, minimum facturable porté par le lot prévu (effet de chargement explicite)
    vol_lot = c['volume_lot_m3']
    tarif_eff_eur_m3 = c['fret_eur_m3'] * max(1.0, c['minimum_m3'] / vol_lot)
    fret = m3 * tarif_eff_eur_m3 * EUR
    forfait = m3 * c['forfait_lot_kmf'] / vol_lot      # forfait de lot ventilé au volume
    cif = achat + livr + fret
    assurance = cif * c['assurance_pct_cif'] / 100
    droits = cif * c['droits_pct_cif'] / 100
    dernier = c['dernier_km_kmf']
    lignes += [
        ('Achat fournisseur', achat, f'{achat_eur} € × {EUR}', 'niveau 1 (prix catalogue fournisseur)'),
        ('Frais bancaires / conversion', banque, f"{c['frais_banque_pct']} % achat", 'niveau 5'),
        ('Livraison fournisseur → Hub', livr, f'{livr_eur} € (affichée par le fournisseur)', 'niveau 1-2'),
        ('Consommables Hub', conso, 'par article', 'niveau 5'),
        ('Carton KOM-BOX (part volume)', carton, f"{s(HUB['carton_kmf'], i)} × {m3}/{HUB['carton_utile_m3']} m³", 'niveau 5'),
        ('Fret maritime', fret, f"{m3} m³ × {tarif_eff_eur_m3:.0f} €/m³ eff. (lot {vol_lot} m³)", 'niveau 5 → devis'),
        ('Transitaire + port (forfait lot)', forfait, f"{c['forfait_lot_kmf']} × {m3}/{vol_lot} m³", 'niveau 5 → devis'),
        ('Assurance', assurance, f"{c['assurance_pct_cif']} % CIF", 'niveau 5'),
        ('Droits et taxes', droits, f"{c['droits_pct_cif']} % CIF", 'niveau 3 si code SH, sinon plage'),
        ('Port → relais', dernier, 'par commande (mono-article)', 'niveau 5'),
    ]
    total = sum(l[1] for l in lignes)
    return lignes, total, achat, dernier


def plancher(prod, i, canal='cash'):
    c = {k: s(v, i) for k, v in CORRIDOR.items()}
    lignes, N1, achat, aval = n1(prod, i)
    if canal == 'cash':
        par_commande, pct_prix = N2['collecte_cash_kmf'] + N2['commission_relais_kmf'], 0.0
    else:
        par_commande, pct_prix = N2['stripe_fixe_kmf'] + N2['commission_relais_kmf'], N2['stripe_pct']
    risque = N1 * c['p_casse_pct'] / 100 + (aval + N2['commission_relais_kmf']) * c['p_non_retrait_pct'] / 100
    variable_hors_pct = N1 + par_commande + risque
    P0 = variable_hors_pct / (1 - pct_prix / 100)
    return {'N1': N1, 'N2_fixe': par_commande, 'risque': risque, 'pct_prix': pct_prix, 'P0': P0,
            'lignes': lignes, 'achat': achat}


def main():
    n3 = N3_KM['charges_mensuelles_kmf'] + N3_KM['hub_aed_mois'] * AED * N3_KM['part_hub_km']
    print(f"N3 KM mensuelle = {N3_KM['charges_mensuelles_kmf']:,} + {N3_KM['hub_aed_mois']} AED × {AED} = {n3:,.0f} KMF\n")
    for prod in PRODUITS:
        nom, prix = prod[0], prod[-1]
        f, c, d = (plancher(prod, i) for i in range(3))
        print(f'## {nom}')
        for lib, v, formule, src in c['lignes']:
            print(f'   {lib:34} {v:>9,.0f}   {formule:42} [{src}]')
        print(f"   N1 central {c['N1']:,.0f} | N2 par commande {c['N2_fixe']:,.0f} | risque {c['risque']:,.0f}")
        print(f"   P0 favorable {f['P0']:,.0f} | central {c['P0']:,.0f} | défavorable (plancher prudent) {d['P0']:,.0f}")
        st = plancher(prod, 1, 'stripe')
        print(f"   P0 central canal Stripe {st['P0']:,.0f}")
        for p in prix:
            contrib_c, contrib_d = p - c['P0'], p - d['P0']
            verdict = ('ROBUSTE' if p >= d['P0'] else 'SENSIBLE (validation humaine)' if p >= c['P0']
                       else 'DESTRUCTIF au central' if p >= f['P0'] else 'DESTRUCTIF dans tous les scénarios')
            print(f"   prix {p:>7,} → contribution central {contrib_c:>8,.0f} / défav. {contrib_d:>8,.0f}"
                  f" | couverture N3 {100 * max(contrib_c, 0) / n3:.3f} %/vente | {verdict}")
        # Sensibilité au regroupement : panier de 3 articles (frais par commande partagés)
        panier = (c['N1'] - c['lignes'][-1][1] + c['lignes'][-1][1] / 3 + c['N2_fixe'] / 3 + c['risque'])
        sens = []
        for k, v in CORRIDOR.items():
            if not isinstance(v, tuple) or v[1] == v[2]:
                continue
            old = CORRIDOR[k]; CORRIDOR[k] = (v[0], v[2], v[2])
            sens.append((plancher(prod, 1)['P0'] - c['P0'], k)); CORRIDOR[k] = old
        sens = sorted(sens, reverse=True)[:3]
        print('   incertitudes dominantes (écart du plancher si seule cette hypothèse passe en défavorable) : '
              + ', '.join(f'{k} +{d:,.0f}' for d, k in sens if d > 0))
        print(f"   (info) coût variable par article dans un panier de 3 : {panier:,.0f} au lieu de {c['N1'] + c['N2_fixe'] + c['risque']:,.0f}\n")
    contrib_moy = 2_000
    print(f'Ventes mensuelles nécessaires pour couvrir N3 KM à {contrib_moy:,} KMF de contribution moyenne : {n3 / contrib_moy:,.0f}')


if __name__ == '__main__':
    main()
