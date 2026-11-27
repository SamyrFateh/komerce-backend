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

## Rattachement mensuel des expéditions et des ventes

Le mois est déterminé par la date de l'événement attesté dans la fenêtre UTC du cockpit. Conserver le lien entre la ligne de commande, la quantité concernée, la COMBOX et l'expédition. Une ligne répartie sur plusieurs colis ou remise en plusieurs fois est suivie par quantité effectivement attribuée et remise.

| Événement | Période | Ce que le moteur compte |
|---|---|---|
| Réception physique attestée au relais | Mois de réception | En **Activité**, une expédition, les COMBOX et quantités reçues, les poids et volumes documentés. Les frais connus alimentent le coût rendu relais avec leur statut de rapprochement. |
| Clôture financière de l'expédition | Cohorte du mois de réception | Rapprochement des achats, du fret, de la douane et des autres frais logistiques documentés. Les coûts directs suivent les articles concernés. Les frais communs sont répartis selon une clé causale justifiée, avec conservation du total source, arrondis compris. |
| Remise attestée au client | Mois de remise | En **Rentabilité**, chiffre d'affaires net des quantités remises, après remises commerciales et hors taxes collectées. Rattacher à ces quantités leurs achats et coûts variables, y compris leur part des frais mutualisés. Une quantité reçue et encore au relais reste suivie au coût attribué en attente de remise ou de sortie justifiée. |
| Remboursement confirmé | Mois de confirmation | Déduire le montant net du remboursement en le reliant à la vente d'origine. Un retour physique ne déclenche pas à lui seul la déduction. Une réintégration de marchandise revendable ou une perte constatée fait l'objet d'un mouvement distinct et justifié. |
| Perte constatée et documentée | Mois du constat | Comptabiliser le coût résiduel de la quantité perdue, détruite ou devenue invendable. Déduire la part déjà passée en charge et traiter séparément les récupérations justifiées. |
| Charge fixe directe ou mutualisée | Période économique couverte | Déduire la charge constatée après la contribution variable. Au groupe, compter la charge mutualisée une seule fois à la source. En lecture marché, utiliser la quote-part rapprochée et conserver le lien avec la charge source. |

**Taxe facturée au client.** Le checkout Komerce ne facture actuellement aucune taxe de vente. Le prix après remises est donc retenu sans déduction de taxe de vente. Les droits et taxes d'importation non récupérables suivent les coûts d'importation. Si une taxe de vente est introduite, sa ventilation par ligne devra être enregistrée au checkout avant de reconnaître les montants concernés hors taxe.

**Remises de commande.** Le total des prix figés du panier doit être égal au prix après remise réglé par le client, wallet inclus, augmenté de la remise enregistrée. Ventiler le prix après remise au prorata du poids de chaque ligne dans ce panier. Pour une ligne remise en plusieurs fois, le montant de chaque remise est l'écart entre les montants cumulés avant et après la remise, arrondis au centime. Ce calcul conserve le total de la commande quand toutes les quantités sont remises. Un écart sans justification laisse les ventes concernées à rapprocher.

**Calcul de Rentabilité.** Ventes nettes reconnues du mois − coûts variables reconnus du mois = contribution variable. Contribution variable − charges fixes reconnues = résultat économique. La consolidation groupe en EUR conserve la devise source, le taux de conversion et la période. Les montants manquants restent à rapprocher avec leur couverture visible.

**Prestations du Hub et encaissements relais.** Le Hub travaille pour tous les marchés. Chaque relais encaisse pour le marché de la commande. Le rapprochement conserve le marché, le relais, la commande et la preuve d'encaissement. Le prix de vente reconnu au mois de remise et le cash encaissé ou reversé sont deux suivis distincts. Affecter chaque coût direct du Hub au marché bénéficiaire et ventiler les coûts partagés selon une clé causale justifiée. La somme des parts et du reliquat doit égaler la dépense source. Pour un marché interne, inscrire sa part en imputation interne. Pour un partenaire facturable, émettre la refacturation conformément à son contrat, sur la même part documentée. La part d'un marché apparaît dans sa rentabilité. La consolidation groupe conserve la dépense externe d'origine et élimine les écritures symétriques entre entités incluses dans le groupe. Voir la [doctrine de mutualisation Hub](DOCTRINE_MUTUALISATION_HUB.md#7-imputation-et-refacturation).

**Clôture Direction.** Avant validation, le cockpit présente le résultat du groupe comme provisoire sur les faits documentés. Le résultat définitif exige une validation Direction portant sur les justificatifs de la période et sur la couverture des ventes, remboursements, coûts variables, pertes et charges fixes. Une facture tardive ou une correction qui modifie ces preuves invalide la validation précédente et remet le mois en rapprochement. La nouvelle validation conserve le lien avec la précédente et les preuves qui ont changé.

**Charge tardive.** Une facture tardive rouvre le rapprochement de l'expédition. Tant que le rapprochement est en attente, l'observation concernée est exclue des coefficients présentés comme rapprochés. La correction est tracée jusqu'à la dépense source et ventilée entre les quantités déjà remises, encore en attente ou sorties en perte. Les écarts touchant une période clôturée restent identifiables comme régularisations avec la période d'origine et la période qui les porte.

**Exemple.** Une COMBOX de dix articles est reçue le 29 janvier. Six articles sont remis en janvier et quatre en février. Activité compte l'expédition et les dix articles en janvier. Rentabilité compte six articles et leurs coûts variables en janvier et quatre articles et leurs coûts variables en février. Un remboursement confirmé en mars réduit les ventes nettes de mars et conserve le lien avec la remise d'origine. Sur la fiche expédition, le suivi de rentabilité s'enrichit au fil des remises, des retours et des rapprochements et se clôture une fois les quantités et les coûts résolus.

## Déploiement progressif
Lot 1 : cartographie de lecture des paramètres existants dans les espaces central et marché. Correspondances catégorie-centre proposées, ambiguïtés en UNMAPPED, nature et périmètre existants conservés. Les budgets et réels par centre sont affichés comme non raccordés, aucun faux total ni écriture. Les contrôles existants restent inchangés.
Lot 2 : audit des sources existantes (factures achats, dépenses réelles/allocation, événements structure, etc.) puis raccordement des centres, responsables, budgets et justificatifs, sans créer de comptabilité concurrente. Rapprochements par expédition et période.
Lot 3 : calcul des parts et coefficients observés, comparaison de périodes et expéditions, fiabilité des dénominateurs ; nomenclature persistante et gestion des cas à qualifier.
Lot 4 : simulation article et plancher/contribution alimentés par ces observations, comparaison à l'ancien moteur sans modifier les prix publiés avant validation explicite.

Recette requise : tests unitaires, contrôle des droits marché, Chromium desktop et oracles API/DB selon le lot. Lot 1 n'est pas une certification des coûts réels.
