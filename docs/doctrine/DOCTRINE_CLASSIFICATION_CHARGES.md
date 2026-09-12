# Doctrine canonique — Classification des charges Komerce

> **Version** : 2.0 — 2026-09-08  
> **Statut** : canonique / intangible  
> **Objet** : définir la classification économique des charges sans niveaux N1/N2/N3 et séparer strictement nature, périmètre et allocation.  
> **Complète** : `DOCTRINE_ECONOMIQUE_KOMERCE.md`, `DOCTRINE_FLUX_CONTRIBUTION_POINT_EQUILIBRE.md`, `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md`, `DOCTRINE_ALLOCATION_COUTS.md`.

---

## 1. Phrase de vérité

> **Une charge Komerce est d'abord fixe ou variable. Elle est ensuite directe ou mutualisée. Son allocation est toujours explicite.**

Ces dimensions sont indépendantes.

```text
nature       = VARIABLE | FIXED
périmètre    = DIRECT | MUTUALIZED
allocation   = article | commande | colis | shipment | marché | usage | GMV | période | autre clé gouvernée
```

Le vocabulaire métier et UI ne doit plus utiliser N1, N2 ou N3 comme catégories conceptuelles.

---

## 2. Nature économique : variable ou fixe

### Charge variable

Une charge est **variable** lorsque son montant augmente du fait de l'activité supplémentaire.

Question de contrôle :

> **Une vente, un article, une commande, un colis ou un usage supplémentaire fait-il augmenter cette charge ?**

Exemples :

- achat fournisseur ;
- sourcing unitaire ;
- fret réellement lié au poids, volume ou shipment ;
- douane et taxes liées au flux importé ;
- emballage par colis ;
- paiement par transaction ;
- commission relais par retrait ;
- coût d'usage plateforme réellement mesuré ;
- coût SAV ou risque variable lorsqu'il est causalement lié au flux.

### Charge fixe

Une charge est **fixe** lorsqu'elle existe sur une période économique indépendamment d'une vente particulière.

Exemples :

- salaires fixes ;
- loyer ;
- abonnements SaaS ;
- minimum mensuel de plateforme ;
- équipe support ;
- assurance de structure ;
- marketing structurel ;
- capacité réservée.

Une charge peut être **semi-fixe par palier de capacité** : elle reste fixe dans une plage d'activité puis augmente à l'ouverture d'un nouveau palier.

La fréquence de facturation ne décide jamais seule de la nature économique.

```text
facturé mensuellement ≠ automatiquement fixe
facturé ponctuellement ≠ automatiquement variable
```

---

## 3. Périmètre : direct ou mutualisé

### Charge directe

Une charge est **directe** lorsqu'elle est attribuable sans partage à un périmètre métier déterminé : marché, produit, commande, relais, shipment, etc.

Exemples :

- loyer du Hub Cameroun ;
- salaire d'une équipe exclusivement Cameroun ;
- achat fournisseur d'un SKU ;
- livraison locale d'une commande donnée.

### Charge mutualisée

Une charge est **mutualisée** lorsqu'elle est portée par un périmètre commun puis répartie entre plusieurs marchés ou activités selon une clé d'allocation explicite, versionnée et traçable.

Exemples :

- Hub régional utilisé par plusieurs pays ;
- Railway / infrastructure centrale ;
- outils SaaS communs ;
- équipe centrale partagée ;
- stockage ou capacité groupe ;
- fonctions support multi-marchés.

> **Mutualisé ne signifie ni fixe, ni variable.**

Une charge mutualisée peut être fixe ou variable.

Exemple Railway :

```text
abonnement / minimum mensuel     → FIXED + MUTUALIZED
usage réellement consommé         → VARIABLE + MUTUALIZED
```

Exemple Hub régional :

```text
loyer et équipe fixe               → FIXED + MUTUALIZED
manutention facturée par opération → VARIABLE + MUTUALIZED
```

---

## 4. Allocation explicite obligatoire

Une charge partagée n'est jamais répartie par intuition silencieuse.

Chaque allocation doit publier au minimum :

```text
allocation_basis
allocation_window
allocation_source
allocation_confidence
allocation_policy_version
```

Clés admissibles selon la causalité réelle :

- unités article ;
- commandes ;
- colis ;
- poids / volume ;
- m³-jours ;
- usage mesuré ;
- activité réelle ;
- GMV lorsqu'elle est défendable ;
- socle fixe par marché + part marginale ;
- autre clé gouvernée et justifiée.

Un fallback égalitaire n'est jamais implicite. S'il est utilisé faute de meilleure mesure, il doit être marqué comme hypothèse avec confiance dégradée.

---

## 5. Coûts commande / colis : ne pas les appeler « mutualisés » par nature

Un coût facturé au niveau commande, colis ou shipment peut être variable et partagé entre plusieurs articles, mais cela ne fait pas de lui une charge mutualisée au sens groupe/multi-périmètres.

Exemple :

```text
frais paiement commande
nature      = VARIABLE
périmètre   = DIRECT à la commande
allocation  = réparti une seule fois sur les articles de la commande
```

Exemple :

```text
fret shipment
nature      = VARIABLE
périmètre   = DIRECT au shipment
allocation  = réparti une seule fois selon poids/volume/règle logistique canonique
```

Le mot **mutualisé** est réservé aux charges portées par un périmètre commun puis imputées entre plusieurs marchés ou activités.

---

## 6. Coûts mixtes : séparation obligatoire

Une facture peut contenir plusieurs natures et plusieurs périmètres.

```text
Railway :
  minimum mensuel                  FIXED + MUTUALIZED
  consommation variable            VARIABLE + MUTUALIZED

Relais :
  forfait mensuel propre au marché FIXED + DIRECT
  commission par retrait           VARIABLE + DIRECT

Hub régional :
  loyer / équipe fixe              FIXED + MUTUALIZED
  traitement unitaire              VARIABLE + MUTUALIZED
```

Il est interdit de classer toute la facture dans une seule famille si les composantes sont identifiables.

---

## 7. Formules économiques canoniques

### Coût variable complet

```text
coût_variable_complet
  = somme de toutes les charges VARIABLES attribuées une seule fois à la vente
```

Cela inclut les charges variables directes et, lorsqu'elles existent, les quotes-parts variables mutualisées attribuées selon leur clé canonique.

### Contribution

```text
contribution_unitaire
  = prix_encaissé
    - coût_variable_complet
```

La contribution appartient à l'article vendu. Commande et colis ne créent pas une contribution supplémentaire : ils regroupent la même contribution sous d'autres vues.

### Charges de période à couvrir

```text
charges_à_couvrir_période
  = charges FIXED directes du marché
    + quotes-parts FIXED mutualisées attribuées au marché
```

### Couverture

```text
couverture
  = contribution_totale_réconciliée_de_la_période
    / charges_à_couvrir_période
```

### Résultat de période

```text
résultat_période
  = contribution_totale_réconciliée
    - charges_à_couvrir_période
```

---

## 8. Le produit ne porte pas une dette fixe artificielle

Les charges fixes ne sont pas collées à chaque SKU pour fabriquer son prix.

Un produit porte :

- son coût d'achat ;
- les charges variables qui lui sont attribuables ;
- une contribution réalisable dans sa borne de marché.

Le portefeuille vendu sur la période porte collectivement la couverture des charges fixes directes et mutualisées.

> **Les produits génèrent la contribution. Le portefeuille absorbe les charges de structure.**

Une allocation fixe unitaire peut exister comme lecture analytique ou scénario, mais elle ne devient jamais une dette économique intrinsèque du SKU et ne doit pas piloter artificiellement le prix public.

---

## 9. Le marché borne la contribution possible

Le prix est d'abord contraint par ce que le client est réellement prêt à payer.

Pour un produit :

```text
borne_basse
borne_cible
borne_haute
borne_très_haute éventuelle
```

Le moteur calcule la contribution possible dans cette plage :

```text
contribution_possible(prix)
  = prix
    - coût_variable_complet
```

Si même la borne haute ne permet pas au portefeuille de couvrir durablement les charges de période, le problème est structurel : achat, fret, charges fixes, allocation mutualisée, volume ou mix.

Le système ne doit jamais résoudre silencieusement ce problème en poussant un SKU au-delà de sa réalité de marché.

---

## 10. Statut de vérité des valeurs

Toute valeur économique affichée doit être qualifiée :

```text
MEASURE       réel constaté / réconcilié
ASSUMPTION    hypothèse explicite
POLICY        choix gouverné
COST          charge éditable selon autorité
DERIVED       résultat calculé, jamais éditable directement
```

Trajectoire attendue :

```text
ASSUMPTION → données suffisantes → MEASURED CALIBRATION
```

Une modification d'une valeur pilotable doit provoquer un recalcul serveur des valeurs dérivées ; le navigateur ne réimplémente jamais le moteur économique.

---

## 11. Vocabulaire UI canonique

À exposer :

- **Charges variables** ;
- **Charges fixes** ;
- **Charges mutualisées** ;
- **Clé d'allocation** ;
- **Coût variable complet** ;
- **Contribution** ;
- **Charges à couvrir** ;
- **Couverture** ;
- **Reste à couvrir** ;
- **Résultat** ;
- **Borne marché basse / cible / haute / très haute**.

À ne plus exposer :

- N1 ;
- N2 ;
- N3 ;
- « charge mutualisée » pour désigner simplement une répartition commande/colis.

---

## 12. Compatibilité technique transitoire

Des champs, migrations, tests ou services historiques peuvent encore porter des noms tels que `n1`, `n2`, `n3`, `n1_landed_relay_cost_kmf` ou `period_n3_kmf`.

Ils sont considérés comme **aliases techniques de compatibilité**, pas comme vocabulaire métier canonique.

Toute nouvelle UI, doctrine et nouvelle API doit employer la nouvelle sémantique. La migration des noms internes se fait séparément, sous preuve de non-régression et sans réécrire le moteur économique dans le frontend.

---

## 13. Phrase de contrôle

Pour chaque charge, répondre dans cet ordre :

1. **Est-elle variable ou fixe ?**
2. **Est-elle directe ou mutualisée ?**
3. **Quelle est sa clé d'allocation et sa fenêtre ?**
4. **Quelle est sa source de vérité et son niveau de confiance ?**

Cette matrice est la classification canonique Komerce.