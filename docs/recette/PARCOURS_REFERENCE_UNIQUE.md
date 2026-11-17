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
