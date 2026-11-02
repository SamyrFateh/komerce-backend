# Hub Live — Tableau de production compact (2 novembre 2026)

## Décision UX
Le poste de travail Hub Live opérationnel présente **une ligne par commande IMPORT**, avec cinq colonnes d'exécution : **PO**, **Fournisseur**, **Réception**, **Cartons**, **Départ**, puis **Reste à solder**.

- Pas de multiplication des six colonnes détaillées par commande.
- La vue principale ne montre pas les produits, SKUs ou fragments de mouvements.
- Le clic, le clic droit et l'activation clavier sur une cellule ouvrent un menu d'actions contextualisé.
- Le menu dirige vers les modules writers existants : Achats fournisseurs, Réception, Stock à affecter, Cartons/expéditions ; la filiation reste consultable sur demande via la route /supply/trace.
- Les opérations sont toujours exécutées par le writer propriétaire. **Aucun changement de statut par simple clic sur une cellule.**
- Le tableau fait pleine largeur : la file de sélection gauche de l'ancien prototype n'est pas répétée dans la vue Opérations.
- La branche Administration est conservée pour les actions achats ; la directrice du Hub demeure responsable des autorisations d'engagement et de paiement, événements distincts.

## Contrat métier et limites actuelles
- **Commande IMPORT sans PO** : reste visible, affiche « À constituer » ou « À approvisionner ».
- **PO multi-commandes** : une PO reste unique, chaque commande affiche uniquement son appartenance à la PO ; le traitement groupé reste accessible depuis Achats fournisseurs.
- **Fournisseur** : PO envoyée n'est pas preuve d'expédition ; si l'événement fournisseur n'est pas exposé par la projection, afficher « Attente fournisseur », jamais « En route » sans preuve.
- **Réception** : seulement les quantités physiquement reçues, pas les confirmations fournisseur.
- **Cartons** : distinguer colis client et KOM-BOX, les deux non interchangeables.
- **Départ** : rattachement à une expédition n'est pas preuve de remise au transitaire ; ne pas afficher « livré » à partir d'un seul lien.
- **Reste à solder** : les nombres non reçus viennent des lignes d'articles IMPORT et des réceptions physiques ; ne jamais annoncer « remboursé » ou « remboursement prévu » sans décision autorisée et écriture financière canonique.
- **Commande LOCAL_STOCK** : ne doit pas apparaître dans le tableau Hub ; le circuit local appartient au relais.
- Les quantités et la filiation détaillées restent accessibles au besoin, elles ne polluent pas la ligne principale.

## Recette avant GO
1. Chromium 1440 : sept colonnes, une seule ligne par commande, tableau dans la largeur disponible, aucun débordement document.
2. Chromium : clic droit / clic gauche / clavier, actions contextuelles accessibles, aucun POST lors de la simple consultation et de la filiation.
3. Un dossier avec deux PO et réception partielle : reste visible, pas de faux départ ou remboursement.
4. Une commande IMPORT non encore achetée : reste visible.
5. Les actions achat/réception/carton font toujours appel aux modules métiers et aux droits serveur, pas de droits inventés côté client.
6. Preflight, CI et recette sur SHA réellement déployé. Ne pas déclarer un GO de production sur les seuls tests mockés.

## Suite métier explicitement hors de ce lot
La projection actuelle ne fournit pas encore un verdict canonique au **niveau article : reliquat à livrer / remboursement autorisé / remboursé**. Raccorder la réconciliation finale au futur tableau sans créer un statut ni une table frontend parallèle. La preuve de l'avis d'expédition fournisseur (manuel ou API) doit aussi être projetée de façon unifiée depuis Supplier Execution avant d'afficher une étape « en route ».
