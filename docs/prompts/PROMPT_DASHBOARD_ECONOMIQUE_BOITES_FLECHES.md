# Prompt d'implémentation - Dashboard économique en boîtes et flèches

Objectif : matérialiser la doctrine économique Komerce sous forme de dashboard lisible, interactif et aligné avec la stratégie prix.

Le dashboard ne doit pas seulement afficher des chiffres. Il doit montrer comment chaque section alimente la suivante jusqu'au coût final et au prix choisi.

---

## Contexte

Komerce construit un prix par chaîne économique :

```text
Objet
  -> N1 coût rendu relais
  -> N2 business variable
  -> coût variable complet
  -> contribution
  -> N3 charges fixes imputées
  -> CDR complet
  -> décision prix
```

Doctrine :

```text
Le moteur calcule.
La stratégie assume.
Le dashboard rend les conséquences visibles.
```

Ne pas confondre :

- **coût variable complet** = N1 + N2 ;
- **CDR complet** = N1 + N2 + N3 ;
- **contribution** = prix de vente - coût variable complet ;
- **prix final** = choix stratégique humain.

---

## Mission

Créer ou refondre la vue dashboard économique en une carte de flux avec boîtes et flèches.

Vue principale attendue :

```text
[Objet]
  -> [N1 · Coût rendu relais]
  -> [N2 · Business variable]
  -> [Coût variable complet]
  -> [Contribution]
  -> [N3 · Charges fixes imputées]
  -> [CDR complet]
  -> [Décision prix]
```

Sur desktop, privilégier une carte horizontale ou semi-horizontale.  
Sur mobile, empiler verticalement en conservant les flèches et la logique de propagation.

---

## Règle UX centrale

Chaque boîte doit répondre à :

```text
Je reçois quoi ?
Je calcule quoi ?
Je transmets quoi ?
Quel impact si on me modifie ?
```

Chaque boîte affiche :

- nom doctrinal ;
- montant principal ;
- formule courte ;
- phrase de rôle ;
- confiance ;
- statut d'alerte ;
- variation récente si une valeur a été modifiée.

---

## Détail des boîtes

### 1. Objet

Afficher : achat fournisseur, devise, taux de change, catégorie, poids, volume, prix actuel.

Rôle :

```text
L'objet fournit les données de base qui alimentent N1.
```

### 2. N1 - Coût rendu relais

Afficher les 9 lignes :

1. achat fournisseur ;
2. sourcing ;
3. hub Dubai ;
4. emballage ;
5. fret ;
6. douane ;
7. port / transitaire ;
8. distribution locale ;
9. relais.

Rôle :

```text
N1 mesure ce que coûte l'objet pour arriver disponible au point relais.
```

### 3. N2 - Business variable

Afficher : frais de paiement, provision risque.

Rôle :

```text
N2 ajoute les coûts variables liés à la vente et à l'encaissement.
```

### 4. Coût variable complet

Formule :

```text
N1 + N2
```

Phrase obligatoire :

```text
Sous cette ligne, chaque vente détruit de l'argent.
```

### 5. Contribution

Formule :

```text
prix de vente - coût variable complet
```

Phrase obligatoire :

```text
La contribution sert à couvrir les charges fixes.
```

### 6. N3 - Charges fixes imputées

Afficher : charges fixes mensuelles, volume cible, articles moyens par commande, quote-part imputée par article.

Rôle :

```text
N3 impute une part de structure au produit.
```

### 7. CDR complet

Formule :

```text
N1 + N2 + N3
```

Phrase obligatoire :

```text
Le CDR est le coût complet imputé, structure comprise.
```

### 8. Décision prix

Afficher : prix plancher, prix conseillé, prix final choisi, stratégie choisie, scénarios, verdict sourcing.

---

## Deux frontières à afficher

Le dashboard doit afficher deux lignes fortes.

### Frontière 1 : coût variable complet

```text
Prix < coût variable complet = vente destructrice.
```

Couleur : rouge / critique.

### Frontière 2 : CDR complet

```text
Prix < CDR complet = vente contributive mais sous-couverte.
```

Couleur : ambre / attention.

Important :

```text
minimum_safe_price ne doit pas être égal au CDR complet.
minimum_safe_price part du coût variable complet + sécurité minimale.
recommended_price part du CDR complet + marge cible.
```

---

## Impact live

Quand l'utilisateur modifie une valeur, afficher un panneau "Impact en live".

Format attendu :

```text
Tu as modifié : [nom de la valeur]

Impact :
- N1 : +X KMF
- N2 : +Y KMF
- coût variable complet : +Z KMF
- contribution : -A KMF
- N3 : +B KMF
- CDR complet : +C KMF
- prix conseillé : +D KMF
```

Exemples :

Si je change `emballage par colis` :

```text
emballage -> N1 -> coût variable complet -> contribution -> CDR -> prix conseillé
```

Si je change `articles par colis` :

```text
ratio d'imputation -> coût imputé emballage -> N1 -> toute la chaîne aval
```

Si je change `charges fixes mensuelles` :

```text
N3 -> CDR -> prix conseillé -> seuil de rentabilité
```

---

## Imputation pédagogique obligatoire

Ne jamais afficher un coût agrégé sans sa mécanique.

Afficher :

```text
coût engagé / niveau / diviseur / coût imputé
```

Exemples :

```text
Emballage : 1 200 KMF par colis / 4 articles = 300 KMF imputés
Paiement : 800 KMF par commande / 2,5 articles = 320 KMF imputés
Fret : 60 000 KMF par shipment / 200 articles = 300 KMF imputés
Charges fixes : 420 000 KMF par mois / 80 commandes / 2,5 articles = 2 100 KMF imputés
```

Les ratios non calibrés doivent afficher une confiance faible.

---

## Stratégies prix à intégrer

Le dashboard doit distinguer le calcul et le choix.

Stratégies canoniques :

- `mechanical` : suit le prix conseillé ;
- `competition_aligned` : alignement concurrence ;
- `premium` : prix au-dessus du conseillé ;
- `loss_leader` : produit d'appel ;
- `conquest` : sous-couverture temporaire ;
- `manual` : prix fixé par l'humain avec alertes.

Chaque stratégie affiche :

- prix final ;
- écart au prix plancher ;
- écart au coût variable ;
- contribution ;
- écart au CDR ;
- charges fixes non couvertes ;
- volume nécessaire pour compenser ;
- verdict.

---

## Contraintes UI

- Interface premium, dense, claire.
- Pas de grand hero marketing.
- Pas de tableau plat en vue principale.
- Les tableaux servent uniquement au détail et à l'imputation.
- La vue principale doit être une carte de flux.
- Les flèches doivent rendre la propagation évidente.
- Les couleurs doivent distinguer N1, N2, coût variable, contribution, N3, CDR et décision.
- La frontière coût variable / charges fixes doit être visible.
- Les états `missing`, `low confidence`, `estimated`, `actual`, `partial_real` doivent être lisibles.

---

## Contraintes code

Inspecter en priorité :

- `services/pricing-engine.js`
- `services/pricing-cdr.js`
- `services/pricing-output.js`
- `services/pricing-recommend.js`
- `services/pricing-dashboard.js`
- `routes/admin-costing.js`
- `routes/admin-cost-components.js`
- `public/dashboards/admin/js/views/PricingWorkshopView.js`

À corriger avant ou pendant l'intégration :

1. Exposer explicitement N1, N2, coût variable, contribution, N3, CDR dans la sortie API.
2. Corriger `minimum_safe_price` pour qu'il parte du coût variable complet, pas du CDR complet.
3. Éviter les calculs parallèles basés sur `pricing_components` quand `pricing-engine` fournit déjà la vérité moderne.
4. Brancher les dashboards sur `pricing-engine`, `pricing-cdr`, `pricing-output`.
5. Garder les anciens champs uniquement en compatibilité, pas comme source de vérité.

Contrat API cible :

```text
n1_landed_relay_cost_kmf
n2_business_variable_cost_kmf
variable_cost_complete_kmf
contribution_kmf
n3_fixed_overhead_allocation_kmf
cdr_complete_kmf
minimum_safe_price_kmf
recommended_price_kmf
final_price_kmf
pricing_strategy
strategy_risk
cost_breakdown
allocations
allocation_averages
data_quality
warnings
```

---

## Livrable attendu

1. Mockup fonctionnel de la carte économique.
2. Panneau de détail par boîte.
3. Panneau "Impact en live".
4. Table d'imputation pédagogique.
5. Correction des divergences backend les plus bloquantes.
6. Liste précise des fichiers modifiés.
7. Tests ou vérifications manuelles décrivant :
   - modification d'un coût N1 ;
   - modification d'un coût N2 ;
   - modification des charges fixes N3 ;
   - prix sous coût variable ;
   - prix sous CDR mais au-dessus du coût variable.

---

## Critère d'acceptation

Un utilisateur non financier doit comprendre en 30 secondes :

1. d'où vient le coût final ;
2. ce qui est variable ;
3. ce qui est fixe imputé ;
4. ce que chaque vente contribue ;
5. pourquoi le prix conseillé est proposé ;
6. quelle valeur modifier pour améliorer la rentabilité.
