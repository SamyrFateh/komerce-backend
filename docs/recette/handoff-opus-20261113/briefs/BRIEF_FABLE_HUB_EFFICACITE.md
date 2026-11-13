# Brief Fable : audit du Hub, cœur du business (efficacité auto/manuel, réconciliation PO ↔ articles commandés)

**Mode ÉCO « super héros »** : rigueur maximale, tokens minimum. Lis seulement le code qui porte la preuve (`git grep`, puis lecture ciblée par plage de lignes), jamais un fichier entier par réflexe. Pas de reformulation ni de narration : seulement des constats prouvés, triés et actionnables. Arrête-toi dès que le rendu est complet.

**Mode** : lecture seule. Aucun test, workflow, modification de code ni écriture sur le staging. Toute affirmation est prouvée par `fichier:ligne` sur `main`, ou par une lecture seule en base.

## Contexte
- Le Hub reçoit les achats fournisseurs de plusieurs sources (CJ, AliExpress, Fournisseur central Hub manuel), les rapproche des commandes clients, les ensache (KOM-ITEM), les met en KOM-BOX et les expédie vers les marchés KM, CM et CG, par transitaire et douane, jusqu'aux relais.
- Chaque geste existe en deux modes, **scanner** et **manuel**, avec provenance `SCAN` ou `MANUAL` (#3923, R4 #3981). Les deux modes passent par le même writer.
- Décisions en vigueur :
  - deux autorisations PO, engagement puis paiement ;
  - vendeur réel structuré pour les achats manuels (L5, migrations 404 et 407) ;
  - PO mono-marché par fournisseur ;
  - achats groupés (`KOMERCE_GROUPED_PURCHASING`) ;
  - consolidation au Hub.
- Lire `docs/doctrine/` (hub, purchasing, procurement), la réflexion « modèle d'approvisionnement » (purchase intent / batch, si elle est présente dans les docs), et la matrice #3944, scénarios M01, M06, C02 à C05 et N11 à N16.
- **Code à cibler** :
  - `services/purchasing-*.js`, `purchase-line*`, `receive-purchase-order.js`, `purchasing-receive-service.js` ;
  - `services/hub-*.js`, notamment `hub-operations*`, `hub-bag-box-service`, `hub-physical-codes`, `hub-procurement-dossier`, `hub-authorization-service` ;
  - `services/auto-parcel.js` (`distributeOrder`), `international-shipment-journey*`, `operations-workspace*` et `public/dashboards/canonical/js/operations-workspace.js`.

## Mission
1. **Réconciliation PO ↔ articles commandés (priorité).**
   - Trace la chaîne `order_item → purchase_line → réception Hub → KOM-ITEM / sac → KOM-BOX → colis → parcel_item`.
   - Vérifie qu'à chaque étape les quantités, SKU et variantes et la commande d'origine restent **exactement** rapprochés, notamment dans les cas suivants : achat groupé de plusieurs commandes sur une même PO, réception partielle ou excédentaire, reliquat, substitution refusée, écart de prix (L5/N40), annulation client après engagement (F1, F2, F3), PO multi-commandes et commande multi-PO, produits manuels du Fournisseur central.
   - Liste chaque endroit où un article peut être perdu, dupliqué, affecté à la mauvaise commande ou au mauvais marché, ou rester bloqué sans signal.
2. **Efficacité opérationnelle, automatique et manuel.** Pour chaque geste Hub (réception, contrôle, ensachage, KOM-BOX, expédition, remise transitaire), mesure dans le code :
   - le nombre d'actions et de saisies, et ce qui pourrait être automatisé sans perdre la preuve (présélection, regroupement, impression, scan en série) ;
   - les gestes doublés ou contradictoires entre les écrans ;
   - les points où le mode manuel est plus lent ou moins sûr que le scan ;
   - les blocages sans message actionnable.
3. **Automatismes existants.**
   - `distributeOrder`, la complétude de groupe, `state-advancer`, les crons et le cockpit live : sont-ils fiables (idempotence, concurrence, reprise après redéploiement) ?
   - Que manque-t-il pour qu'une commande avance seule quand tout est reçu ?
4. **Visibilité.** Pour la directrice et les agents Hub : peut-on répondre en un écran à « pour cette commande, qu'est-ce qui manque, chez qui, depuis quand » et « pour cette PO, quelles commandes sont servies » ? Si non, dis quoi ajouter, sans créer un nouveau dashboard.

## Rendu
Publie une **nouvelle issue** « Audit Fable : Hub, efficacité et réconciliation ». Elle contient :
- **le schéma de la chaîne de réconciliation**, avec ses invariants et les requêtes SQL de contrôle en lecture seule ;
- **le tableau des constats** : `ID | Étape | Cas | Risque (perte, doublon, blocage, lenteur) | Preuve fichier:ligne | Correctif minimal | Scénario #3944 concerné ou à ajouter` ;
- **les gains d'efficacité**, classés par gain et par effort ;
- **les ambiguïtés de doctrine** à faire trancher par le propriétaire.

Ne crée aucune doctrine nouvelle et ne corrige rien.
