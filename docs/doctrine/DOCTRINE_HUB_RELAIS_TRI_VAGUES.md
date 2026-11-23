# Doctrine canonique — tri Hub, vagues, lettres et remise Relais

**Statut : décision métier validée le 23 novembre 2026 ; certification technique distincte.**
**Autorité :** AGENTS.md, cartes Logistics/Orders/Purchasing, HUB-001. Références : #5168, #5207 et PR #5206.

## 1. Identités et responsabilités

- La référence commerciale d'une commande est immuable : `K` suivi de six caractères. Ne jamais la remplacer par une référence composite `CM-YAO1-B7Q4-X8`, une lettre ou un code de retrait.
- Une sous-référence `KABC123-01`, `-02`, `-03` permet de reconnaître les unités ou lignes tracées, sans faire de cette convention l'identifiant primaire des unités physiques. Les UUID, SKU, allocations et scans canoniques font autorité.
- Les identités sont distinctes : commande commerciale ; unité physique/COMBOX ; vague et regroupement temporaire ; lettre de pré-tri ; emplacement physique réel ; secret de retrait.
- Le Hub identifie la destination **marché + relais**, contrôle, étiquette, affecte et expédie. Le relais réceptionne, trie finement par commande/destinataire, localise et remet.
- Le Hub ne réassigne ni la commande, ni la destination, ni l'allocation Purchasing. Aucun sac numérique obligatoire ; lecture des sacs historiques conservée.

## 2. Moteur de vagues et lettres

- À la validation du checkout, le moteur **propose et persiste une lettre de pré-tri par relais et vague**, sans modifier la référence commerciale.
- Rotation initiale A à Z, puis extension AA, AB, etc. si utile. L'attribution utilise les quantités d'articles attendues, et non le nombre de commandes ou clients. Cible indicative de dix unités par lettre, configurable et non assimilée à une capacité réelle.
- Choisir une lettre admissible à charge prévisionnelle minimale, avec départage par rotation transactionnelle ; répartir les premières commandes plutôt que tout concentrer en A. Les opérations concurrentes doivent rester déterministes, idempotentes et sans doublons.
- Un destinataire **vérifié** au même relais et dans la même vague ouverte conserve son regroupement entre commandes ; ni nom, ni téléphone, ni payeur seul ne suffisent à établir l'identité. Une vague fermée n'est pas réouverte par une nouvelle commande.
- Une attribution existante n'est jamais réécrite silencieusement. Le regroupement est temporaire, non public, sans pouvoir d'autorisation de retrait. Les lettres peuvent être réutilisées après clôture, grâce à la clé interne relais + vague + attribution.
- **Deux niveaux distincts :** lettre prévisionnelle dès le checkout ; localisation physique confirmée au relais uniquement après constat réel. La lettre ne garantit pas qu'une étagère A soit libre. L'agent peut ne pas utiliser de bac, choisir une zone compatible ou déclarer un débordement traçable. Une suggestion ne constitue jamais une présence physique.
- Le moteur suit séparément charge prévue et occupation physique confirmée. Une COMBOX fermée compte comme une unité physique tant qu'elle n'est pas ouverte ; après déconditionnement, compter les unités réellement rangées. Ne pas assimiler quantité commerciale et nombre de contenants.

## 3. Hub : réception, étiquettes et COMBOX

- Réception fournisseur : rapprocher PO, SKU, variantes, quantités et lignes de commande ; attester seulement ce qui est réellement reçu. Les colis entrants peuvent contenir plusieurs commandes et marchés et n'héritent d'aucune lettre unique.
- Imprimer des étiquettes sur les unités effectivement reçues ou sur un lot explicitement traçable : référence K+6, sous-référence, article/variante, quantité, marché, relais, lettre prévisionnelle si disponible, code de scan stable. Jamais de nom, téléphone ou secret de retrait.
- Préparer directement dans une KOM-BOX en scannant COMBOX et articles. Une KOM-BOX peut agréger plusieurs commandes et destinataires, **mais un seul marché et un seul relais de destination**. Une commande peut être répartie sur plusieurs KOM-BOX.
- À PACKED, imprimer/réimprimer l'étiquette COMBOX avec identité physique, marché, relais et compteurs dérivés du contenu réel. Réimpression sans mutation de custody ni d'inventaire.
- Les opérations SPLIT/MERGE/REPACK déplacent la matière et conservent l'historique d'allocations, quantités et custody. Pas de sac numérique intermédiaire.

## 4. Relais : réception, rangement, retrait

- Scanner l'expédition/COMBOX et attester chaque ligne/quantité effectivement reçue. Si 2 unités sur 3 sont reçues, enregistrer 2/3 et ouvrir l'écart : ne pas déclarer 3/3.
- Recherche autorisée par commande ou code de retrait : afficher lignes, attendu, expédié, reçu, disponible, remis, manquant et reliquat, y compris si la commande traverse plusieurs COMBOX.
- Le repère alphabétique facilite le rangement ; le lieu exact est confirmé par l'agent, peut différer du pré-tri et reste propre au relais. Aucun bac physique ou numérique obligatoire.
- À la remise, vérifier le secret de retrait distinct et les habilitations, sélectionner **explicitement les articles et quantités physiquement tendus** ; enregistrer preuve, acteur, horodatage, commande, unité et quantités. Autoriser la remise partielle, conserver les reliquats, interdire toute deuxième remise des mêmes quantités. Le statut complet découle de la couverture réelle.
- Une livraison locale hors Hub utilise les mêmes principes de réception/placement/retrait, sans créer de fausse étape Hub.

## 5. Autorité, sécurité, compatibilité

- Autorités existantes : orders et order_items pour le commercial ; purchasing/PO pour les achats ; hub_purchase_allocations et placements physiques pour les quantités ; logistics pour custody, COMBOX, réception relais et remise.
- Aucun writer parallèle, aucune mutation de destination depuis le Hub, aucune fuite inter-marché/inter-relais. Le code de lettre, de vague ou d'étiquette ne vaut jamais autorisation de retrait.
- Les événements de scan, placement, déplacement, sortie et remise sont append-only/idempotents, avec acteur, site, marché, références et provenance. Mode sans scanner : saisie manuelle explicite et auditée ; perte réseau : ne pas inventer de preuve.
- Les anciennes références K+6, commandes G6 et données physiques historiques restent lisibles ; pas de renumérotation ni de suppression des sacs historiques. Tout nouveau flag est OFF par défaut ; activation staging séparée du merge.

## 6. Conséquence impérative pour PR #5206

**REJETER** le remplacement de la référence commerciale par `CM-YAO1-B7Q4-X8`. **CONSERVER ET ADAPTER** la transaction de vague, l'identité destinataire vérifiée, les garde-fous et l'abandon des nouvelles mutations sac ; déplacer lettre, vague et regroupement dans des champs logistiques séparés. Revoir migration 426, checkout, projections UI, étiquettes et tests. Ne pas merger la PR #5206 tant qu'elle contredit cette doctrine.

## 7. Critères de certification avant les 46 scénarios

- Référence K+6 stable ; plusieurs commandes d'un destinataire dans la même vague ; homonymes distincts ; réouverture impossible ; rotation A–Z, charge par quantités, concurrence, extension AA, réutilisation sûre.
- PO partielle et étiquettes limitées aux reçus ; COMBOX multi-commandes ; commande multi-COMBOX ; scan doublé ; réimpression neutre ; marché/relais incompatible refusé.
- Réception 2/3 non complète ; remise 1/3 puis 2/3 ; aucun double retrait ; reliquats et incidents visibles ; aucune donnée sensible sur étiquette.
- Sur le **même SHA servi en staging** : préflight et CI requis verts ; gestes réels Chromium desktop, oracles API/HTTP, vérité PostgreSQL et dashboards. Verdict PASS/FAIL/BLOCKED/NOT_PROVEN, jamais PASS par simple présence d'écran.
- Aucun GO commercial, déploiement manuel ou activation de flag implicite par la fusion documentaire.

**Portée de ce document :** arbitrage canonique à intégrer dans les cartes et implémentations propriétaires ; il ne prétend pas que le code est certifié.
