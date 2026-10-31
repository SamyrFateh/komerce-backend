# Contrat V1 — contribution, coûts et pilotage du Moteur économique

> Décisions métier du 31 octobre 2026. **Cible contractuelle**, pas attestation d'implémentation complète.
> Périmètre : Moteur économique global / marché, Catalogue marché, costing opérationnel.
> Ne modifie pas les autorités canoniques : calcul serveur, décision de prix par marché, certification catalogue.

## 1. Vérité à trois moments

1. **Avant vente** : le moteur estime N1 (rendu relais) + N2 (variables business). Le prix décidé donne une **contribution prévisionnelle** = prix - N1 - N2. Le coût du fournisseur, le fret, la douane, le paiement et le relais portent une provenance, une unité et un niveau de confiance.
2. **Pendant exécution** : les coûts réels remplacent progressivement les estimations. L'écart estimé / engagé / réel est identifiable ; la réalité inconnue ne devient pas zéro.
3. **Après réconciliation** : achat, expédition, dédouanement, livraison et autres charges applicables sont attestés. La **contribution réelle** s'agrège par produit, commande, marché et période, sans recomptage du même flux.

La contribution d'un article ne vaut ni bénéfice net ni part fixe intrinsèque.

## 2. Charges de structure : couverture collective, pas dette de SKU

**N3** = charges économiques fixes de période (directes marché + quote-part mutualisée groupe). Les coûts fixes peuvent être connus à l'avance, mais leur « coût réel par article » ne l'est pas sans volume effectivement vendu. Les répartitions hypothétiques servent à **simuler** et jamais à masquer une sous-couverture ou à imposer un supplément automatique au prix d'un SKU.

Deux lectures restent distinctes :
- **Prix du produit** : plancher lié aux coûts variables estimés, marge de sécurité, prix de marché observé, contribution attendue. Le marché peut choisir au-dessus d'un corridor si sa décision est autorisée et traçable.
- **Viabilité du portefeuille** : Σ contributions réconciliées sur la fenêtre économique / charges structurelles de la même fenêtre (N3), avec statut de maturité et politique de couverture.

L'objectif de contribution / volume permet un prix ambitieux, mais n'est pas le coût réel d'un produit. Sous coût variable : exception stratégique gouvernée ; sous CDR : uniquement selon politique du marché en vigueur, sans blocage général de ventes déjà actives.

## 3. Lecture analytique en deux axes — ne jamais fabriquer un pourcentage

| Nature du coût | Direct | Mutualisé |
|---|---|---|
| Variable | Achat, frais unitaire, distribution directe, etc. | Fret groupé, opération partagée variable, etc. |
| Fixe | Loyer local, salarié fixe marché, etc. | Infrastructure plateforme, loyer et équipe fixes Hub, etc. |

**Fixe, variable et mutualisé ne sont pas trois familles disjointes** : les deux premières décrivent une *nature*, la dernière un *périmètre*. On ne doit jamais sommer des parts calculées sur des bases différentes ni compter deux fois une même charge.

Le tableau de bord pourra produire :
- parts *variables / fixes* dans le **total de coûts réconciliés d'une même période** ;
- part *directs / mutualisés* sur le **même total**, comme second axe ;
- concentration des coûts majeurs par poste et marché ;
- évolution coût estimé → coût réel, contribution unitaire et totale, taux de couverture de N3 ;
- seuil d'équilibre, en articles / commandes / colis **équivalents alternatifs** calculés par le serveur à mix observé, jamais additionnés.

### Autorité du pourcentage

Un pourcentage ne sera affiché que si le serveur a fourni une projection canonique comportant :
- fenêtre économique et Market ID identiques entre coûts au numérateur / dénominateur ;
- unités KMF réconciliées, modalités de mutualisation cohérentes, sans double comptage ;
- maturité / complétude suffisante avec provenance et politique ;
- total strictement positif ; coûts absents ≠ 0 ; aucune conversion d'unités bricolée dans le navigateur.

**À défaut** : afficher `Non encore calculable` et expliquer pourquoi. Les sommes de taux (%), valeurs « par commande », « par kg », et charges fixes mensuelles ne peuvent jamais être additionnées pour fabriquer un mix total.

## 4. Écrans et responsabilités

- **Raffinerie** : prétraitement interne des fournisseurs.
- **Catalogue global** : corriger et certifier conformité / taxonomie / titre FR / images / variantes ; pas de prix local.
- **Moteur économique** : paramètres globaux (édition groupe), charges directes marché (édition locale), mutualisation (lecture seule marché), référence contribution / couverture (lecture serveur).
- **Catalogue marché** : prix local final + choix `Publier`. Le serveur doit contrôler *avant* de confirmer : conformité globale toujours valide, prix/gate autorisés, disponibilité réellement vendable, exposition et visibilité cliente. Publier signifie réellement visible et achetable, ou fournir une raison prouvée, corrigeable et contextualisée. Un incident technique ne doit jamais être présenté comme non-conformité du produit.

## 5. Validation

1. Unitaires : provenance, séparation N1/N2/N3, aucune addition d'unités hétérogènes, absence non transformée en zéro, couverture sans maturation fictive.
2. Chromium desktop **1440 px**, API simulée : onglets, hiérarchie visuelle, coûts hérités en lecture seule, coût marché modifiable, charges mutualisées non éditables, texte contributif et « non encore calculable », aucun pourcentage fictif.
3. PostgreSQL jetable / API réelle : calcul backend, agrégation par fenêtre, droits marché isolés, remontée des motifs de refus.
4. Recette staging avec **vrais produits CJ** : Catalogue global certifié → prix local → `Publier` → recherche / PDP / panier, même Market ID. Fixtures RCT de test ≠ preuves de boutique réelle.

**Aucune étape 2 seule ne certifie les étapes 3 et 4.**
