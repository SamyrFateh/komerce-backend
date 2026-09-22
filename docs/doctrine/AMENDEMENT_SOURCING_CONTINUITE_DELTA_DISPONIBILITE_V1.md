# Amendement Sourcing — continuité fournisseur, delta et disponibilité à l'engagement (V1)

**Date : 2026-09-20. Statut : proposition en PR, non déployée.**
**Owners : Sourcing (observation), Catalog (exposition), Purchasing (readiness/achat), Orders/Payments (engagement).**
**Invariants préservés :** Product / Offer / Unit / Supplier Order Identity exactes ; commande client distincte de la PO ; pas de RESET ; pas de publication, achat, paiement ou remboursement déclenchés par un scan.

## 1. Décision métier

Le sourcing **ne se termine pas au premier import**. Pour toute Offer/Unit référencée, Komerce doit disposer d'une stratégie explicite de surveillance des faits fournisseur (prix natif et devise, disponibilité/stock par unité exacte, état de l'offre, conditions d'expédition et de commande). Le mode de détection dépend du **contrat réellement autorisé au compte fournisseur** :

1. **PUSH** : webhook/callback *si et seulement si* l'API et les permissions en offrent un pour les offres suivies ; un événement est un signal, à authentifier, dédupliquer et, si nécessaire, confirmer par lecture exacte.
2. **CHANGE_FEED** : lire un journal/curseur de changements si son périmètre couvre nos offres et si le contrat est prouvé.
3. **PULL_EXACT** : sinon, réinterroger de manière bornée les Offers/Units déjà suivies, en respectant quotas, délais et échecs. Un cron n'est qu'un déclencheur de cette opération ; une API HTTP ne pousse pas spontanément de notifications.

**Découverte de nouveaux produits ≠ surveillance des produits suivis ≠ validation d'une demande client.** Les opérations ont des cadences, budgets, contrats et preuves distincts, mais relèvent d'**un seul interrupteur métier par source : Sourcing ON/OFF**. ON autorise découverte ET surveillance ; OFF suspend les deux pour la source, sans supprimer ses produits ni annuler les commandes déjà engagées. Les vérifications Purchasing nécessaires à l'exécution ou au traitement des commandes existantes sont indépendantes du sourcing automatique. L'état des offres non surveillées doit refléter l'incertitude/la péremption de leurs faits ; OFF ne les rend pas automatiquement vendables ni automatiquement supprimées.

## 2. Audit de l'existant au 20 septembre 2026

| Question | Fait inspecté | Verdict |
|---|---|---|
| Interrupteur sourcing ? | `sourcing_sources.autopilot_enabled`, `setSourceActive()`, `KOMERCE_SOURCE_AUTOPILOT`. Activation peut lancer un premier pull. | **Oui**, pour acquisition récurrente ; conserver et étendre **ce même interrupteur métier**, sans nouveau toggle de surveillance. |
| Scheduler réel ? | Railway `sourcing-autopilot` : `node ./scripts/sourcing-source-autopilot.js`, cron `*/5 * * * *`. | **Cron 5 min**, sous réserve des flags et des sources activées. Pas un flux push. |
| Contenu d'un passage ? | `runSourceOnce()` lance `importCatalog()` avec `is_full_snapshot:false` et les options de découverte bornée du registre. | Ce passage ne démontre **pas** la relecture systématique des Offers/Units suivies. |
| Delta déjà possible ? | `sourcing_observations` immuables, `observed_at`, projections temporelles ; upsert des candidats, compteurs `created/updated`. | **Matière première présente** ; un compteur updated ne prouve pas un changement. Première projection d'un delta Offer/Unit en **shadow read-only ajoutée par cette PR**. |
| Produit retiré ? | L'archivage candidat exige `is_full_snapshot:true`; autopilot est en `false` ; l'archivage ignore les candidats `imported_to_catalog`. | **Aucune propagation de retrait jusqu'au catalogue public prouvée**. Absence d'un résultat paginé, erreur ou fenêtre partielle ≠ suppression. |
| Stock au checkout ? | `order-checkout-item-resolution.js` lit le stock Komerce ; `order-checkout-service.js` persiste la commande ; `purchasing-trigger-service.js` appelle ensuite la readiness canonique pour les SKU exacts. | **Aucune vérification distante systématique avant engagement client démontrée dans ce parcours.** Le preflight fournisseur existe en Purchasing, au stade approvisionnement. |
| API fournisseur live ? | `allegro-fulfillment-adapter.js` et `aliexpress-fulfillment-adapter.js` relisent l'unité exacte et vérifient la quantité pendant le preflight Purchasing. | **Capacité ciblée prouvée en code**, pas une garantie de réservation jusqu'à l'achat ni un webhook pour les vendeurs tiers. |
| Webhook fournisseur ? | Aucun abonnement fournisseur générique confirmé dans ce périmètre audité. | **UNKNOWN par provider/compte** jusqu'au contrat exact et à une preuve P1/P2. |

Références : `services/sourcing-source-autopilot.js`, `services/sourcing-import-dispatch.js`, `services/suppliers/catalog-import-orchestrator.js`, `services/sourcing-candidate-import-service.js`, `services/sourcing-canonical-{offer,unit}-projection.js`, `services/order-checkout-item-resolution.js`, `services/purchasing-trigger-service.js`, `services/suppliers/canonical-unit-purchasing-gate.js`, `docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md`.

**Portée de l'audit :** code de `main` et configuration de service Railway, sans lecture des valeurs des secrets, sans requête live aux fournisseurs et sans exécution de commande ou paiement. Les flags ON/OFF et les données de production ne sont pas déduits de la seule présence de variables.

## 3. Contrat canonique de continuité fournisseur

Pour chaque principal/Offer/Unit suivi, tracer explicitement :

- `source_ref` + principal fournisseur + références fournisseur namespacées + `supplier_order_identity` exacte ;
- `observation_method` : PUSH / CHANGE_FEED / PULL_EXACT / MANUAL / UNKNOWN, avec preuve de capacité et périmètre (nos offres vendeur ≠ toutes les offres tierces) ;
- `observed_at`, `received_at`, `last_successful_exact_check_at`, politique de fraîcheur selon provider et type de fait, `expires_at` si contractuel ;
- valeur brute/normalisée et provenance de chacun des faits : prix natif, devise, disponibilité, stock exact ou borné, MOQ, état offre, expédiabilité vers Procurement Hub ;
- état de surveillance : ACTIVE / DEGRADED / PAUSED / UNKNOWN ; échecs, budget/quota, prochain essai et cause ;
- périmètre/completude du snapshot, curseur de feed, borne de pagination, couverture des références attendues.

Stock non publié, indisponible, manquant ou ancien ne doit jamais être présenté comme stock certain. Une API peut ne fournir qu'un verdict `can_fulfill(quantity)`, sans quantité globale : l'adapter doit préserver cette sémantique au lieu d'inventer un entier. Ne jamais remplacer `null`/UNKNOWN par zéro. `0` explicitement observé signifie rupture pour l'unité exacte, sous réserve de fraîcheur et portée.

## 4. Moteur de delta — lecture et conséquences

Comparer uniquement deux observations **de la même identité canonique Offer/Unit et du même périmètre fournisseur**, en distinguant :

- `UNCHANGED` : mêmes faits effectivement observés et comparables, à périmètre équivalent ;
- `CHANGED` : au moins un fait comparable a changé, avec ancien/nouveau, timestamp et provenance ;
- `UNKNOWN` : observation manquante, partielle, trop ancienne, erreur source, changement de périmètre ou impossibilité de conclure ;
- `FIRST_OBSERVATION` : aucune base antérieure comparable ;
- `REMOVAL_CONFIRMED` : uniquement preuve de retrait émise par l'autorité fournisseur, lecture exacte négative interprétable selon contrat, ou snapshot complet et comparable explicitement contractuel — **jamais** simple absence d'un pull partiel.

Les effets opérationnels doivent être décidés **après** détection par l'owner approprié : stock 0 / retrait prouvé / unité inactive → arrêter une nouvelle promesse de vente pour l'unité concernée ; prix/fret changés → réévaluer la plage de prix de marché et la contribution, jamais réécrire rétroactivement le prix d'une commande payée ; identité ambiguë → revue humaine et hard stop ; données périmées/échec source → signal de risque + gate de fraîcheur selon la politique métier, jamais supposer disponibles.

**Ce que la PR implémente maintenant :** `last_observation_delta` en lecture seule dans les projections Offer/Unit, calculé sur les deux dernières observations déjà rattachées à la même entité canonique, avec `CHANGED/UNCHANGED/UNKNOWN/FIRST_OBSERVATION`. C'est une **preuve de comparaison**, pas un moteur de propagation, pas une qualification de fraîcheur, pas une preuve de retrait et pas une mise à jour du stock boutique. Cette première projection refuse les comparaisons entre `source_id` ou `principal_ref` différents ; une décision métier devra en plus prouver le même périmètre d'offre, de compte et de contrat fournisseur. Les champs non observés restent explicitement inconnus.

## 5. Deux portes de disponibilité distinctes

**A. Consultation / panier / liste partagée** : exposer une disponibilité indicative portant provenance et fraîcheur. Le panier ou la liste figée ne réserve **pas** un stock fournisseur. Vérifier l'unité et la **quantité agrégée** pour éviter que plusieurs lignes d'un même SKU passent isolément.

**B. Avant engagement client** (checkout / paiement / confirmation suivant le mode, y compris paiement collectif) : demander pour l'unité exacte, la quantité totale demandée et le Procurement Hub : `AVAILABLE(quantity)`, `INSUFFICIENT`, `UNAVAILABLE`, `UNKNOWN`, avec `checked_at` et éventuelle validité/réservation. Si l'API permet seulement `oui/non`, garder ce booléen borné à cette quantité. Le serveur décide : succès explicitement vérifié et suffisamment frais, sinon refus, confirmation différée explicitement consentie ou autre parcours métier formellement défini ; **pas de promesse implicite**. Vérifier en particulier le moment exact où l'argent est capturé : une vérification pré-paiement sans réservation reste sujette à une course.

**C. Juste avant engagement d'achat fournisseur** : Purchasing réexécute son preflight selon capacité provider, revalide prix/stock/fret, construit une PO idempotente et n'exécute l'achat que par le flux déjà autorisé. Une vérification préalable ne garantit pas la disponibilité ultérieure si le fournisseur ne propose pas de réservation atomique. Si la quantité a disparu après paiement, ne pas modifier silencieusement la commande : cas d'exception tracé avec choix/remboursement selon le contrat Orders/Payments.

L'ordre du contrôle (autorisation paiement avant capture, paiement collectif, délai de 48 h, commande `ordered`) **doit être audité** et raccordé sans déplacement implicite de la frontière de paiement. Ne pas appeler le fournisseur dans une transaction DB longue sous verrou ; prévoir timeout, reprise, idempotence, invalidation et recheck au commit.

## 6. Interrupteur unique Sourcing ON/OFF et sécurité

**Un seul interrupteur métier visible par source : Sourcing ON/OFF.** Le champ existant `sourcing_sources.autopilot_enabled` est l'autorité visée ; préserver son sens actuel pendant la transition, puis y raccorder les deux sous-processus internes. Ne pas créer de `discovery_enabled` ou de `continuity_enabled` pilotable par l'opérateur.

- **ON** : autorise la découverte bornée et la surveillance continue des Offers/Units suivies. Le système sélectionne PUSH, CHANGE_FEED ou PULL_EXACT selon les capacités réellement prouvées ; un mode indisponible n'est jamais simulé comme opérationnel.
- **OFF** : suspend nouveaux pulls de découverte, refreshs de surveillance et *application au catalogue* d'événements sourcing entrants. Le handler peut accuser réception et sécuriser les événements, mais aucun événement en attente ne doit réactiver silencieusement une source désactivée. Pas de suppression automatique des références préexistantes. À la réactivation, un refresh exact borné et un rattrapage des changements sont requis avant de considérer les faits à nouveau frais.
- **Commandes déjà engagées** : les preflights exacts Purchasing, la gestion d'incidents et les opérations requises pour tenir ou dénouer ces commandes continuent selon leurs propres autorisations. Ne jamais conditionner ces obligations au toggle sourcing. Une *nouvelle* promesse commerciale fondée sur un fait périmé doit être bloquée ou explicitement qualifiée selon la politique de Catalog/Orders, sans inventer de stock.
- **Garde-fous techniques** : authentification des callbacks (signature/secret), antirejeu, event ID et portée compte/offre, verrou de source, quotas, backoff, journal et état DEGRADED/UNKNOWN. Ce ne sont pas des interrupteurs métier supplémentaires. Un arrêt d'urgence **technique** de sécurité peut isoler une intégration défaillante ; il ne doit pas être présenté comme un second bouton de sourcing ni empêcher le traitement des commandes existantes sans une procédure d'incident distincte.
- Les retards et doublons de webhook sont attendus ; ordre par version/timestamp fiable, sinon relecture exacte. Jamais de publication, achat ou paiement depuis un handler.

Ne pas créer un service Railway supplémentaire sans preuve du besoin : privilégier la cron déjà présente et un endpoint webhook backend uniquement si un provider offre réellement PUSH. Cadencer les rechecks selon risques, changements et activité plutôt que scanner tout le catalogue toutes les cinq minutes.

## 7. Mise en œuvre, preuve avant extension

**P0 — contrat par provider et compte :** pour Allegro, AliExpress, puis CJ/eBay, renseigner types d'offres accessibles, exact read, notifications, feed, quotas, stock quantitatif/borné, préflight, réservation et moment d'achat. UNKNOWN reste UNKNOWN. Ne pas extrapoler une notification `seller offers` aux offres de vendeurs tiers.

**P1 — delta read-only :** instrumenter la relecture exacte de 1 à 3 unités suivies en staging ; conserver before/after et prouver `unchanged`, `3→0`, prix changé, endpoint 404 distingué d'une panne, ref ambiguë, données absentes, replay et quota. Garder le `last_observation_delta` de cette PR comme observabilité uniquement.

**P2 — boucle ciblée :** deux opérations internes distinctes (découverte et surveillance) sous **le même** toggle existant `autopilot_enabled` ; curseur/schedule + file bornée ; couvrir ON, OFF pendant un job, événement reçu OFF, et rattrapage à la réactivation ; utiliser `catalog-import-orchestrator` et les Observations canoniques sans contourner la raffinerie. Procéder uniquement à des mises à jour autorisées par les owners Catalog/Purchasing. Le cron peut déclencher les rechecks exacts tant qu'aucun événement provider n'est prouvé.

**P3 — webhook réel si disponible :** P1 signature + doublon + portée du compte + relecture exacte ; brancher sur la même file/delta que PULL_EXACT ; prouver le mode fallback sans polling aveugle de tout le catalogue.

**P4 — disponibilité à l'engagement :** audit et preuve sur le vrai flux checkout/paiement/commande groupée, puis recheck Purchasing, avec test du basculement de stock entre validation et achat fournisseur. Les garde-fous de paiement et remboursement ne sont jamais modifiés par simple ajout d'un adapter.

**P5 — go-live progressif :** même interrupteur source OFF par défaut pour les nouveaux raccordements, activation limitée par source/compte et périmètre SKU en interne, mesures `last_successful_exact_check_at`, deltas, refus, quota, coût, âge des données ; rollback sans suppression de données ni désactivation silencieuse des commandes existantes.

### Acceptation non négociable

- Un seul toggle métier par source : ON déclenche découverte **et** surveillance des références suivies ; OFF suspend les deux sans compromettre Purchasing pour les commandes déjà engagées.
- Un webhook non prouvé n'est jamais affiché comme disponible.
- Une disparition d'un échantillon n'entraîne ni retrait catalogue ni suppression de Product/Offer/Unit.
- `UNKNOWN` n'est ni `0` ni `AVAILABLE`.
- Le nombre d'unités réellement commandables pour la quantité demandée est vérifié au bon moment et revalidé avant achat.
- Aucun scan ne déclenche directement publication, paiement, achat fournisseur, annulation ou remboursement.
- Preuves séparées : audit de contrat, test unitaire delta, staging API, commande/paiement Golden, puis activation production.

## 8. Raccordement shadow Observation → SKU catalogue (lecture seule)

Le rapport de comparaison `collectCanonicalOfferUnitComparison` expose désormais
`stock_observations` pour chaque SKU fournisseur rattaché à une Unit canonique unique.
L'entrée reste `UNKNOWN` en cas de SOI/ref divergente, Source de la dernière observation
non prouvée, changement de périmètre Source, unité inactive, absence de date ou quantité inconnue.
Un zéro **explicitement** observé est distinct d'une quantité manquante.

Une entrée `COMPARED` porte les deux quantités et `SAME_NUMBER` ou `DIFFERENT_NUMBER`,
jamais une disponibilité commerciale. Le stock fournisseur peut différer du stock catalogue
pour des raisons de réservation, commande ou latence. `freshness=UNVERIFIED`,
`commercial_readiness=NOT_EVALUATED` et `authority=shadow_read_only` restent explicites.
Aucune écriture `product_skus.stock`, aucune bascule d'autorité Catalog, aucune publication,
aucun appel provider ou Purchasing, et aucun changement de checkout/paiement n'est effectué.

**Gate suivant, séparé :** sur un SKU réel et lié sans ambiguïté, définir avec les owners
Catalog/Orders/Payments un contrat de disponibilité pour la quantité agrégée et la fraîcheur
requise avant l'engagement du client ; le preflight fournisseur reste obligatoire selon son
contrat propre avant l'achat. Cette comparaison n'autorise **aucun** cutover vers ce gate.
