# Komerce — parcours métier canonique, référence unique de recette

**Décision propriétaire du 17 novembre 2026.** Ce document fixe la méthode de réutilisation du parcours, **pas une seconde matrice de scénarios**, ni une déclaration de certification.

## Autorité et version

- **Source unique des scénarios métier :** [G6_PRE_STRESS_BUSINESS_SCENARIOS.md](./G6_PRE_STRESS_BUSINESS_SCENARIOS.md) et son JSON compagnon. Conserver les 46 IDs M01–M06 / N01–N40 et leurs attendus. Aucun ID ne doit être renommé, recopié dans un second registre ni réinterprété par un harnais.
- **Navigation observée :** `tests/staging-canonical/real-navigation.spec.js`, `navigation-audit-policy.js` et `matrix.js`. Ces fichiers constituent un inventaire de navigation, **pas** une autorité de permissions ni une preuve transactionnelle.
- **Différences par marché :** `tests/staging-canonical/market-business-proof-matrix.js` ; ne jamais assimiler KM, CM, CG, DJ et YT à un seul pays cloné.
- **Coordination et verdicts :** `docs/chantier/STATUS.md` sur `main`. Le présent document n'est pas un nouveau tableau de bord.
- **Référence de parcours :** `G6-CANONICAL-JOURNEY-v1`. Toute variation fonctionnelle est une modification revue du contrat et des scénarios concernés ; une retouche de libellé, de placement ou de sélecteur ne doit pas recréer le parcours.

## Chemin stable à rejouer

Le chemin principal reste **M01** : source/fournisseur → préparation et approbation catalogue → exposition locale et prix → boutique et variante/panier → identification client/checkout → commande → encaissement de recette → PO et double validation Hub → achat/réception physique → sac et KOM-BOX → transitaire/douane → réseau local → Relais → code de retrait/remise → Order 360, documents, notifications et journal financier.

Le même moteur et les mêmes points de contrôle sont réutilisés, sans dupliquer les gestes :
- **M02** : stock local, **sans** PO ni circuit import ; preuve de retrait au Relais.
- **M03** : panier mixte, branches locale/import réellement indépendantes jusqu'à leurs remises.
- **M04/M05** : M01 sous autorités et référentiels propres à CM/CG.
- **M06** : sourcing et fiche **manuels** du Fournisseur central Hub, puis même chaîne physique et financière ; aucune fiche ou preuve fournisseur inventée.
- **N01–N40** : refus, sécurité, idempotence, SAV, annulation, multi-variantes, reprise et frontières marché/rôle appliqués aux mêmes étapes et objets.

Lancer et rejouer dans **le staging Railway commun** après fusion, déploiement et vérification de `/health/version`. Réexécuter uniquement les cellules impactées par un changement, ainsi que leurs dépendances, puis la campagne transversale complète avant GO propriétaire. **Les 46 E2E sont suspendus** tant qu'aucun nouveau GO explicite n'est donné.

## Contrat d'habilitations par action, pas par contournement

Le parcours métier détermine l'action requise ; les règles d'autorisation **déjà détenues par le backend** déterminent si un compte peut l'exécuter. Le manifeste de test ne confère jamais un droit. Aucune permission globale n'est ajoutée pour rendre un test vert.

| Étape / écran de référence | Acteur métier visé | Portée minimale à vérifier |
| --- | --- | --- |
| Boutique /XX, panier, connexion, Mon Komerce | Client | Ses commandes, ses justificatifs et son code de retrait uniquement |
| Marché, exposition/prix, réseau local | Admin central ou responsable marché habilité | Marchés attribués ; affectation réseau/Relais uniquement selon la délégation prévue |
| Sourcing et Catalogue | Personnel habilité sourcing/catalogue ; Hub pour fiche manuelle selon règles existantes | Produit et approbations autorisés ; absence d'autorisation implicite à publier |
| Achats et engagement PO | Opérateur Hub habilité + directrice pour les validations prévues | Achat et engagement dissociés ; double validation du paiement fournisseur |
| Réception, sac, carton, colis | Agent Hub habilité | Marchés et commandes relevant du Hub ; écriture physique seulement à l'écran |
| Transport / douane | Transitaire affecté et acteurs habilités à décider | Expéditions affectées, retenue/mainlevée sans droit financier indu |
| Caisse, dépôt et réception de dépôt | Agent Relais / destinataire de caisse désigné selon le processus | Relais affecté, marché et destinataire contrôlés ; écriture financière traçable |
| Réception Relais et remise avec code | Agent Relais affecté | Son Relais seulement ; pas de deuxième remise, pas de contournement du code |
| Order 360, SAV, comptabilité | Rôle concerné avec délégation explicite | Lecture et décision séparées ; marché, client, devise, justificatifs et pouvoir de remboursement respectés |

**Test négatif obligatoire** à chaque point sensible : compte absent, autre marché, autre Relais et rôle non habilité → écran/action non disponible ou refus explicite ; HTTP 401/403 attendu et **aucune mutation PG**. Ne jamais remédier à un refus en donnant `admin` à un agent. Toute modification de rôle, capability, navigation ou backend fait l'objet d'un correctif distinct, d'une preuve négative et d'un rejeu Chromium positif.

## Contrat d'exécution et d'évidence

Pour chaque geste du scénario : `scenario_id`, `run_id`, `staging_sha`, empreinte de base, marché, acteur/rôle/délégation, objet métier et état **avant** → clic/saisie/validation dans Chromium → appel HTTP réellement déclenché → état **après** relu indépendamment via API/PG → audit, document, notification et effet financier pertinent. Produire capture/trace expurgée et verdict `PASS | FAIL | BLOCKED | NOT_PROVEN`.

Les **fixtures** préparent seulement l'environnement et les identités autorisées ; elles ne créent pas un état final à la place des gestes humains. Interdit de produire une commande, un encaissement, une remise, un paiement fournisseur ou un document final par API/SQL/script en remplacement de l'écran. Le PSP, les notifications externes et tout décaissement réel restent interdits en recette.

Un menu introuvable (par exemple **« Réseau local »**), un écran sans action ou un droit absent bloque **l'étape précise**. Vérifier d'abord la destination et le rôle canonique, puis corriger le **produit** ou le **grant minimal** ; on ne crée pas un parcours parallèle et on n'inscrit pas `PASS` sur une simple réponse API. Le correctif est ensuite rejoué sur la même référence métier.

## Gestion des changements

1. Conserver le chemin principal et ses identifiants, sans dupliquer les scripts pour chaque incident.
2. Si une étape métier change réellement, amender la matrice G6 et le contrat de parcours dans **la même PR**, avec justification, impacts et revue du propriétaire du parcours.
3. Si seul un libellé, un sélecteur, un menu ou une permission change, modifier l'adaptateur d'écran ou la politique d'autorisation pertinente ; conserver les IDs et les attendus.
4. Vérifier les droits positifs **et négatifs** en Chromium staging et API/PG en lecture d'oracle, puis consigner le lien de preuve dans la ligne existante de `STATUS.md`.
5. Ne déclarer ni `GO`, ni merge, ni certification sans leurs preuves distinctes. Ne pas toucher à la production.

**État à la création : contrat documentaire, pas d'implémentation supplémentaire ni de certification nouvelle.** Le harnais métier transactionnel réutilisable devra consommer la matrice existante et respecter ce contrat, sans déplacer l'autorité des règles métier ou des droits dans le test.


## Implémentation incrémentale — liaison d'une commande unique (17/11/2026)

**Une seule entrée réutilisable** : `scripts/recette/g6-canonical-replay.js`, déclenchée sur le staging commun via `.github/workflows/staging-g6-canonical-buyer-cash.yml`. Elle lit les IDs de la **matrice G6 préexistante** et orchestre, sans copier les gestes Playwright, deux scripts historiques :

1. `g6-p2-buyer-order-real-chromium.js` : OTP de recette, produit réel, panier, confirmation commande dans Chromium, oracle PostgreSQL de la nouvelle commande `G6-BUYER`.
2. `g6-a-relay-cash-real-chromium.js` : le même `order.reference` injecté explicitement, rattachement Relais et confirmation cash par les écrans, oracle PG sur l'unicité de l'encaissement.

Le connecteur `g6-canonical-journey-binding.js` valide le couple scénario/marché depuis `G6_PRE_STRESS_BUSINESS_SCENARIOS.json`, refuse un ID ou un marché incohérent, et conserve le chemin historique à trois références quand l'ancien script est lancé sans binding canonique. La nouvelle voie ne peut pas se rabattre silencieusement sur une référence codée en dur.

Les déclencheurs **propriétaire uniquement**, sérialisés :
- `[staging-op] g6-canonical-buyer-cash-M01-KM`
- `[staging-op] g6-canonical-buyer-cash-M04-CM`
- `[staging-op] g6-canonical-buyer-cash-M05-CG`

**Limite explicite :** la chaîne s'arrête à la transition `HUB_PO`. Cette étape n'est pas encore reliée à la même commande, de même que réception Hub, KOM-BOX, douane, Relais, code de retrait, SAV et documents. Le rapport `test-results/g6-canonical-replay/report.json` affiche `buyer_cash_verdict=PASS` uniquement si les deux gestes, l'identité de commande, le marché, le SHA et l'empreinte PostgreSQL concordent ; le verdict du **scénario complet reste NOT_PROVEN**, même quand GitHub Actions termine au vert.

Aucun scénario autre que M01/M04/M05 n'est implicitement pris en charge, en particulier M02 stock local, M03 mixte et M06 fournisseur central manuel. Les adapter au même moteur par ajout de branche métier, **pas par un nouveau script de parcours**. Les 46 E2E restent suspendus au GO propriétaire, les flux PSP/fournisseurs réels interdits.


### Reprise après erreur de contrat de preuve (17 novembre 2026, runner G6)

La première exécution M01/KM [#4425](https://github.com/SamyrFateh/komerce-backend/issues/4425) a réellement créé la commande `KL1WGP6` en Chromium sur staging `8f394eac`. **La caisse n'a pas été exécutée** : l'ancien rapport d'achat n'exposait pas le champ `payment_mode`, pourtant déjà vérifié par le script d'achat lui-même en PostgreSQL. Aucun accès ni aucun paiement supplémentaire n'est attesté par ce run.

Pour **reprendre sans refaire l'achat**, une issue propriétaire `[staging-op] g6-canonical-resume-M01-KM` contenant `resume_run_id: 44167858336` télécharge l'artefact GitHub de l'ancien run, vérifie l'ID d'exécution, la référence de commande, le marché, le scénario et l'empreinte PG, et **refuse tout changement de code runtime** entre les deux SHA (diff Git limité à l'orchestrateur de test, son workflow, ses tests et la documentation). Le nouvel agent Relais vérifie à nouveau **à l'écran et par PostgreSQL** que la commande est encore pending / cash_relais, avant tout clic d'encaissement. Sinon `BLOCKED` ; jamais de nouveau checkout implicite.

Le test global reste `NOT_PROVEN` après reprise, tant que `HUB_PO`, transport, Douane, remise client et documents ne sont pas raccordés à cette même référence.


### Étape Hub PO liée à la même commande (17 novembre 2026)

Le contrôle buyer+cash M01/KM a été confirmé sur le staging réel par [run #44169528939](https://github.com/SamyrFateh/komerce-backend/actions/runs/44169528939) / [artefact #14367985714](https://github.com/SamyrFateh/komerce-backend/actions/runs/44169528939/artifacts/14367985714) : commande `KL1WGP6`, même ID buyer, même fingerprint PG, cash 200 et une seule collecte.

Le déclencheur propriétaire `[staging-op] g6-canonical-hub-po-M01-KM` avec `resume_run_id: 44169528939` réutilise **le même orchestrateur G6** pour lire le checkpoint buyer+cash vérifié et exécuter directement le test Hub Chromium existant `tests/staging-clicks/g6-p3-kuyiyuk.spec.js`, maintenant paramétrable par `order_id`, `reference`, `buyer_id` plutôt que fixé à `KUYIYUK`. Ce test réalise la ligne d'achat (si nécessaire) et le brouillon de PO depuis le cockpit Hub, puis vérifie en PG la même commande, la caisse unique, une ligne et un PO.

**Pas d'engagement/paiement fournisseur réel** et aucune facture fictive créée par le harnais. Si l'ordre est introuvable à l'écran, le fournisseur lié manque ou l'état physique est inéligible : `BLOCKED`, pas de simulation de PO via API. Une preuve Hub PO positive ne clôture ni les deux validations directrice, ni réception, KOM-BOX, transitaire, douane, relais, remise et documents. Verdict M01 complet `NOT_PROVEN` tant que le parcours n'a pas traversé ces gestes réels.


## Contrat de contribution G6-CANONICAL-JOURNEY-v1 — ajout d'étapes par Opus / Sonnet (18 novembre 2026)

**État du socle à cette date :** M01/KM Golden *historique* PASS staging ([run #44280122740](https://github.com/SamyrFateh/komerce-backend/actions/runs/44280122740), artefact #14416158709), mais son ordre `KL1WGP6` est **déjà `collected` : aucun rejeu mutatif de cette même commande**. Le registre, les 46 manifestes non liés, les schémas et l'API d'acteurs Chromium sont des **contrats de migration**. Ils ne prouvent pas à eux seuls que les 46 scénarios sont exécutables ni que les chemins historiques `main()` ont tous été extraits.

### 1. Autorité et ordre des contributions

- **GPT reste propriétaire du noyau** : `scripts/recette/canonical/stage-registry.js`, `scripts/recette/g6-canonical-replay.js`, `docs/recette/canonical/*.schema.json`, `scripts/recette/canonical/actors/`, politique de preuve et workflow canonique. Une modification du noyau exige sa revue et une PR spécifique.
- **Opus / Sonnet ajoutent des modules indépendants** `scripts/recette/canonical/stages/<ID>.js` et des variantes qui se composent avec le graphe. Ne recopier ni le parcours entier ni la matrice ; `docs/recette/G6_PRE_STRESS_BUSINESS_SCENARIOS.json` demeure l'unique autorité métier. Une entrée `docs/recette/scenarios/<ID>.json` **référence** son scénario et ne devient exécutable qu'avec binding, cohorte, preuves et validation.
- Une PR de variante contient **Pourquoi, Quoi, Tests, Reprise**, un test unitaire négatif et un test du scénario sur **le vrai staging partagé** avant PASS. Avant push, `npm run pr:preflight`, jamais `--no-verify`.
- La revue d'un autre agent ne vaut pas certification. La campagne globale M01–N40 exige un GO propriétaire explicite.

### 2. Contrat d'étape et règle Chromium

```js
module.exports = {
  id: 'RELAY_RECEIPT',
  requires: ['CUSTOMS'],
  produces: ['relay_receipt'],
  roles: ['agent_relais'],
  async run(ctx) {
    // Uniquement les méthodes Chromium du bon rôle : pas de POST API de substitution.
    return ctx.actors.agent_relais.receiveShipment(ctx.order, ctx.proof);
  },
  validate(ctx, proof) {
    // Oracles PG READ ONLY liés à la cohorte et aux identifiants réels.
    return ctx.oracles.verifyRelayReceipt({ order: ctx.order, proof });
  }
};
```

**Règle impérative :** chaque décision, acceptation, refus, déclaration, validation, mainlevée, remboursement, encaissement ou remise fait l'objet d'un **vrai geste Chromium** de l'acteur habilité. L'appel API/SQL ne remplace jamais ce clic. Aucune étape ne peut autoriser seule son exception. L'API peut seulement simuler un **retour d'acteur extérieur sans écran Komerce** s'il figure préalablement dans `docs/recette/canonical/external-responses.json` et a été approuvé par le propriétaire. **Liste initiale vide**. Le préchargement OTP historique de M01, de portée fixture, ne doit pas être copié comme méthode d'authentification générale ; sa suppression ou son remplacement doit être revue et certifiée séparément pour éviter de briser le parcours prouvé.

La bibliothèque `scripts/recette/canonical/actors/` fournit le contexte par rôle et les sélecteurs **vérifiés** ; les rôles sans sélecteurs confirmés sont **non liés**, pas inventés. L'action produit obligatoirement : rôle, page, sélecteur, requête HTTP observée, capture **avant/après** (champs secrets masqués), oracle PostgreSQL **lecture seule**. **Écran/action absent = `SCREEN_MISSING` ; HTTP 429 = `NOT_PROVEN`**. N'exposer aucun OTP, code complet, téléphone réel ou secret dans les captures, logs et artefacts.

### 3. Exemple de variante : RELAY_RECEIPT / SHORTAGE (lot E)

Ajouter **la branche** `SHORTAGE` à la configuration du manifeste concerné, **sans modifier** le comportement nominal M01. La branche reste `NOT_BOUND` jusqu'à preuve du vrai bouton et du geste dans Chromium. Exemple de contrat à implémenter dans un module séparé :

```js
const shortage = {
  id: 'RELAY_RECEIPT_SHORTAGE',
  requires: ['RELAY_RECEIPT'],
  produces: ['shortage_incident'],
  roles: ['agent_relais'],
  async run(ctx) {
    // La méthode ne sera raccordée QU'APRÈS vérification de l'écran réel.
    return ctx.actors.agent_relais.declareShortage(ctx.order, ctx.line, ctx.missingQty);
  },
  async validate(ctx, proof) {
    return ctx.oracles.readOnlyShortageIncident({
      scenarioId: ctx.scenarioId, orderId: ctx.order.id,
      lineId: ctx.line.id, expectedQty: ctx.missingQty, proof
    });
  }
};
```

Le résultat attendu n'est **pas** `orders.status=collected` par défaut : un écart partiel garde les quantités et l'incident traçables, puis une étape de solde apporte sa propre preuve. **Deuxième remise refusée, code erroné ou rôle interdit : `PASS` du scénario négatif uniquement si le refus attendu est constaté à l'écran et si la relecture PG démontre l'absence de mutation interdite.** Un HTTP 403 ou 409 isolé, sans écran, ne vaut pas PASS.

### 4. Reprise, preuves, préflight et anti-concurrence

- **Preflight avant tout geste** : catalogue et stock réel du marché, affectation du compte relais, indicatifs (+237 et +242 selon l'écran), flags FABLE_LOCAL_*/E7, SHA Railway servi et fingerprint PG. La fonction `scripts/recette/canonical/preflight.js` accepte uniquement des sondes **read-only** ; si une dépendance/identité/sonde manque, verdict `NOT_READY`, zéro mutation. Les cohortes dans `docs/recette/canonical/cohorts.json` ne contiennent **que les noms de variables de secrets**, jamais leurs valeurs. CLAUDE-PAR reste non liée tant que ses comptes indépendants ne sont pas configurés.
- **Cadence G0c** : 1 commande/12 s, 1 retrait/20 s, 1 cash/30 s ; arrêter sur 429. Séquencer les écritures staging par marché/cohorte, ne pas laisser deux campagnes modifier le même colis.
- **Schéma** : `docs/recette/canonical/proof.schema.json` ; PASS exige une couverture écran complète et une preuve pour chaque geste humain. Des oracles I1–I15, H1–H9, ECO-Q1..Q3 et la portée de `simulation_scope` s'ajoutent dans les modules concernés, sans changer l'autorité métier. Le rapport doit distinguer preuve historique, donnée de scénario et action du run courant.
- **SHA pin + reprise** : vérification explicite de la provenance d'artefact, de la même commande/cohorte/marché et du fingerprint, puis whitelist de diff **outillage seulement**. Une variante nouvelle n'hérite jamais automatiquement d'un PASS M01. Les historiques terminés `collected` sont immuables : une nouvelle cohorte utilise une **nouvelle commande** dans le même staging, après cadrage/GO du scénario.
- **Critère de disponibilité pour Opus / Sonnet** : seuls registre et contrats sont prêts tant que les adapters historiques `run/validate` n'ont pas été extraits et reliés au moteur, que les rôles nécessaires n'ont pas de page objects vérifiés et que le rejeu de non-régression sur une **cohorte distincte** n'est pas certifié. Ne pas annoncer le moteur industrialisé complet avant ces preuves.
