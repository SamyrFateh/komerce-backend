# Moteur économique — centres de coûts V1
Décision métier du 25/11/2026 : l'effort économique engagé pour vendre un ensemble de produits est la base. Le coût unitaire est une construction analytique, pas une dépense autonome. Le coût rendu relais est un sous-ensemble de cet effort.

## Nomenclature cible
| Code | Centre | Nature des dépenses possibles | Périmètre d'observation |
|---|---|---|---|
| PUR | Achats de marchandises | Marchandises, sourcing, collecte fournisseur | Article, PO |
| LOG | Logistique | Personnel Hub, matériel, consommables, emballage, fret, douane, transport local, réception relais | Expédition et période |
| MKT | Marketing et acquisition | Ressources humaines, publicité, prestations, outils | Campagne, période |
| SAL | Commercialisation et encaissement | Paiements, commissions de remise et vente, traitement des commandes | Transaction, période |
| SAV | Service après-vente | Retours, litiges, incidents, pertes, personnel | Incident, période |
| STR | Structure et fonctionnement | Direction, administration, informatique, locaux communs | Période |

Un centre possède un responsable, un budget, des ressources humaines et matérielles, des besoins de renouvellement et des dépenses justifiées. Les postes sont rattachés à l'activité qui les consomme, non à une famille fixe/variable. Une dépense partagée ne doit être comptée qu'une fois. Un rattachement incertain reste à qualifier.

Chaque ligne doit identifier : code stable, centre, nature de dépense (marchandise, personnel, matériel/amortissement, consommables, prestation, taxes non récupérables, etc.), comportement fixe/variable sur un horizon déclaré, attribution directe/mutualisée vis-à-vis d'un objet déclaré (article, expédition, marché ou période), pièce justificative, devise, montant, date/période, statut et clé d'imputation. Une charge mutualisée peut être fixe ou variable. Un abonnement marketing peut être fixe sur la période ; une commission d'acquisition à la vente peut être variable. Une dépense d'investissement et son amortissement ne sont pas deux charges cumulables.

## Mesures et séparation des vérités
- Expédition : clôture physique au relais distincte de clôture financière, factures et quantités réelles (poids, volume, valeur et quantité). Ventilation suivant le facteur causal ; rapprochement exact à la dépense source, gestion des arrondis et des régularisations.
- Période : dépenses d'exploitation constatées, y compris les centres hors logistique. Charges fixes consommées sur la période distinctes des paiements et du budget. Éviter le double comptage entre expéditions et période.
- Article : unité économique de vente. Coût prévisionnel construit à partir de tarifs contractuels et d'observations clôturées comparables par marché/corridor. Le volume physique et le remplissage réel importent ; aucun objectif de ventes ne remplace une mesure réelle. Les coûts directs ne nécessitent pas de dilution. Les coûts mutualisés nécessitent une clé explicite ; aucune moyenne arbitraire présentée comme du réel.
- Chiffre d'affaires reconnu distinct de marchandises arrivées au relais : la rentabilité de l'expédition ne devient définitive qu'après reconnaissance des ventes, retours et coûts applicables. Les charges communes de période sont suivies séparément ou imputées analytiquement avec réconciliation.
- Données inconnues ≠ zéro. Distinction paramètre/hypothèse, devis, dépense constatée, dépense réconciliée, non applicable. Pas de somme de tarifs de dimensions incompatibles.
- Seuil de non-perte unitaire : prix net couvrant le coût variable complet au prix considéré, y compris les frais proportionnels au prix. Contribution = recettes nettes − coûts variables complets. Plancher commercial = seuil de non-perte plus objectif explicite de contribution, résolu en tenant compte des frais proportionnels. Les contributions couvrent collectivement les charges fixes ; résultat de période = somme des contributions − charges fixes de période. La quote-part de structure reste une référence analytique, pas une dette intrinsèque de l'article.

## Déploiement progressif
Lot 1 : cartographie de lecture des paramètres existants dans les espaces central et marché. Correspondances catégorie-centre proposées, ambiguïtés en UNMAPPED, nature et périmètre existants conservés. Les budgets et réels par centre sont affichés comme non raccordés, aucun faux total ni écriture. Les contrôles existants restent inchangés.
Lot 2 : audit des sources existantes (factures achats, dépenses réelles/allocation, événements structure, etc.) puis raccordement des centres, responsables, budgets et justificatifs, sans créer de comptabilité concurrente. Rapprochements par expédition et période.
Lot 3 : calcul des parts et coefficients observés, comparaison de périodes et expéditions, fiabilité des dénominateurs ; nomenclature persistante et gestion des cas à qualifier.
Lot 4 : simulation article et plancher/contribution alimentés par ces observations, comparaison à l'ancien moteur sans modifier les prix publiés avant validation explicite.

Recette requise : tests unitaires, contrôle des droits marché, Chromium desktop et oracles API/DB selon le lot. Lot 1 n'est pas une certification des coûts réels.
