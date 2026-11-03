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


## 3 novembre — Hub transversal, visible sans marché

Le Hub est **central pour tous les marchés**. Le tableau opérationnel d'entrée
\`/admin/hub\` affiche les commandes import de tous les marchés actifs, sans
sélecteur ni paramètre market requis. Le marché est un attribut de la ligne,
**pas une limitation du droit de lecture**.

- Endpoint global \`GET /api/hub/board\`, authentifié et autorisé pour tous les
  profils internes (admin, agent_hub, market_operator, agent_relais, finance,
  sourcing, agent_transitaire, support ; plus identité déléguée vérifiée).
- Données explicitement minimisées : référence commande, marché, état des cinq
  grandes étapes, unités non reçues et anomalies. Pas d'email client, prix,
  facture, pièce fournisseur, identifiant financier ou liste article.
- Une opération physique ou une validation d'achat reste autorisée uniquement
  par les writers existants. Le clic contextuel peut ouvrir le writer spécialisé
  avec le marché **dérivé du dossier**, sans transformer le Hub central en vue
  filtrée.
- Navigation Live : un seul Hub global pour tous les rôles internes ; ancienne
  URL d'exécution conservée comme outil ciblé aux opérateurs habilités.
- Import uniquement : les commandes LOCAL_STOCK continuent de relever du
  circuit Relais.
- Test négatif : consultation par le relais ne peut déclencher aucun POST Hub.

Le tableau n'affiche jamais « remboursé » sans preuve canonique de
réconciliation. Un état sans PO reste « à constituer ».


## 3 novembre — Deux postes compacts implémentés

Le Hub central conserve **deux espaces internes** sur \`/admin/hub\` :
- **Opérations**, tableau commandes clients et état physique, lecture transverse pour les huit profils internes.
- **Administration**, tableau par PO fournisseur (groupement de commandes, suivi d'envoi, réception, preuves de débit), visible à \`admin\` et \`agent_hub\`. Deux vues : \`PO & engagements\` et \`Paiements fournisseurs\`.

Sur cette page, les onglets \`Sourcing live\` et \`Relais live\` sont masqués
uniquement dans la navigation locale ; leurs cockpits restent accessibles sur
leurs routes propres. Le sélecteur haut est remplacé par \`Global · Tous les
marchés\` (texte fixe, non sélecteur). Le marché est un attribut d'une PO/commande,
pas une condition d'accès à la lecture globale.

Les actions de chaque cellule sont des **liens contextuels vers le writer
canonique**, jamais une transition par simple clic droit. Le backend
\`GET /api/hub/administration\` est protégé \`admin|agent_hub\`, ne renvoie ni
contacts clients, ni produits, ni montant de paiement, et n'accepte aucun
paramètre marché. L'endpoint \`GET /api/hub/board\` reste la seule projection
transverse tous profils.

### Limite métier volontairement explicite

La séparation décidée **validation de l'engagement d'achat** / **autorisation du
paiement fournisseur** ne possède pas encore, dans le dossier existant, une
preuve canonique d'approbation par la directrice. Les deux colonnes affichent
\`Non tracée\` plutôt que de prétendre que l'acte est autorisé à partir du statut
PO ou du débit. \`Débit constaté\` ne signifie **ni** autorisation **ni** paiement
intégral, seulement une preuve de débit effectivement vérifiée. La création du
writer de décision, de son acteur et de sa preuve est un prochain chantier
métier distinct, à certifier avant d'activer ces actions.


## 3 novembre — Menu contextuel exécutable et code couleur pour certification

Les statuts de couleur et la « Prochaine action » sont **dérivés** de la vérité PO,
réception, KOM-BOX et expédition : rien n'est enregistré comme un statut métier
supplémentaire. Les teintes restent discrètes : gris non démarré, bleu en cours,
ambre attente, vert prêt/conforme, rouge anomalie, violet décision
administrative distincte.

Clic droit/clic normal/clavier sur la cellule :
- **PO** : proposer « Préparer PO » seulement avec lignes d'achat groupables,
  fournisseur, Hub et marché canoniques ; forme brouillon manuelle, writer
  \`POST /api/purchasing/po/prepare\`. Pas de soumission implicite.
- **Fournisseur** : une PO \`notified\` non envoyée peut recevoir une preuve
  d'envoi réelle (canal + référence/note) via \`POST /api/purchasing/po/:id/sent\`.
  L'ouverture du menu n'envoie jamais la PO.
- **Réception** : quantités explicitement comptées et référence physique,
  contrôlées par le serveur via \`POST /api/scans/hub/receive\`. Toutes les
  quantités sont initialement 0. Aucun mouvement si le manifeste est vide.
- **Cartons / Départ** : uniquement une KOM-BOX \`DISPATCHED\` sans départ et
  une expédition \`hub_ready\` du même marché peuvent être liées via
  \`POST /api/hub/box/:unit_id/shipment\`.
- **Reste à solder** : propose les mêmes actions canonisées d'achat et de
  réception lorsqu'elles sont réellement applicables ; aucun remboursement
  fictif ni clôture déclarative.

Les actions ne sont assemblées qu'après lecture de
\`GET /api/hub/dossier?market=...\` pour un \`admin\` ou \`agent_hub\`. Les
profils lecture seule ne déclenchent pas cette lecture privée et n'obtiennent
aucune commande d'écriture. Chaque action est confirmée explicitement par
l'opérateur, le backend garde l'autorité, la vue relit ensuite le résultat
canonique.

**Dette non dissimulée** : la décision de la directrice autorisant
l'engagement d'une PO et celle autorisant le paiement fournisseur ne disposent
pas encore de preuve distincte dans la projection. Le menu n'ajoute ni bouton
d'approbation non prouvée ni bouton de remboursement. La certification de
l'ergonomie n'est pas la certification du workflow financier.
