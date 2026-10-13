# Komerce — registre des preuves existantes avant recette FULL

**But :** exploiter les tests E2E déjà développés. Aucune nouvelle suite et aucun reset de données. Chaque validation est liée à son exécution réelle, à son niveau de preuve et à son écran de recette.

## Lecture du registre

- **EXISTE** = fichier/workflow identifié sur `main`, sans déduction sur son dernier résultat.
- **VERT L4 CONFIRMÉ** = GitHub Actions a conclu `success` sur l'exécution et le commit cités.
- **À RACCORDER** = preuve automatisée ou lien vers écran réel encore à relier au cockpit.
- **HUMAIN NON VISÉ** = aucune validation humaine ne peut être déduite d'un résultat Playwright.

| Frontière métier | Test ou dispositif existant | Niveau prouvable | Dernière preuve explicitement vérifiée | Écran / preuve à raccorder |
|---|---|---|---|---|
| Source / sourcing / publication catalogue | `public/golden-e2e-cockpit.html` (volet upstream), `/api/admin/entities/golden-upstream` | À qualifier par gate | Gate existant, pas de verdict opérationnel ici | Cockpit source, Product ID, éléments backend du gate |
| Boutique / catalogue / panier | `public/boutique/tests/e2e/authenticated/order-flow.spec.js` | L3 si API interceptée, L4 si vrai POST + PG | Test présent, dernier run réel non établi ici | URL boutique du market / captures navigateur |
| Authentification OTP | `public/boutique/tests/e2e/auth.setup.js` | Parcours navigateur avec session réelle si setup exécuté | Golden P2 #38448297041 : étape OTP ignorée ; **pas une certification négative des suites historiques** | Session test dédiée, preuve Playwright et identité environnement |
| Commande / paiement cash / réception / livraison / finance | `tests/e2e-cash/order-to-cash-thread.spec.js`, `playwright.cash-e2e.config.js` | L4 intégré local | [Golden L4 run #38447414712](https://github.com/SamyrFateh/komerce-backend/actions/runs/38447414712) success, SHA `2f601c277ea1db9306e8853c70f0034dad7cba54`, 12/12 | Golden Order cockpit / commande réelle / traces cash, logistique, comptabilité |
| Rôles multiples / garde et encaissement | `tests/e2e-cash/`, `nightly-e2e-certification.yml` | L4 local selon scénario | Workflow nightly existant ; dernier verdict nocturne **non vérifié** dans ce registre | Identité acteur, marché, refus d'accès, preuve DB |
| Vérité des dashboards | `tests/e2e-cash/dashboard-truth.spec.js`, nightly | L4 oracle API + SQL + écran | Suite existante ; dernier run **non vérifié** ici | Pilotage, Action Center, Opérations, Hub, Relais, Finance, Comptabilité |
| Cockpit manuel et étapes | `public/golden-e2e-cockpit.html` | Guide humain, pas une certification autonome | Interface existante sur `main` ; appelle `golden-create`, `golden-advance`, `golden-evidence` | Chaque étape → écran Komerce réel, verdict humain distinct du backend |
| Marchés Comores / Cameroun | `marketSelect` du cockpit, suites multi-market | Dépend du scénario exécuté | Ne pas inférer que les deux marchés ont passé une recette FULL | Répéter parcours pour KM et CM avec acteurs, produits et relais associés |
| Externes : Stripe, WhatsApp, transporteur / fournisseur | Adaptateurs / tests distincts | L6 seulement avec preuve prestataire | **Non prouvé par Golden L4** (clés placeholders, localhost) | Logs prestataires et réconciliation indépendante |

## Règle d'entrée en recette FULL humaine

1. **Ne pas réimplémenter** les tests Playwright existants. Relever d'abord l'exécution pertinente et l'artefact de preuve.
2. Pour chaque parcours, renseigner : **market**, **acteur**, **commande / produit**, **commit**, **run CI**, **niveau L0–L6**, **résultat**, **lien écran**, **attendu**, **observé**, **verdict humain** et **anomalie éventuelle**.
3. Le cockpit doit permettre d'ouvrir les écrans réels et de distinguer **preuve technique** d'**observation humaine** ; ses boutons de simulation Golden n'attestent pas à eux seuls la boutique ou la chaîne amont.
4. Une phase `skipped` ne vaut jamais `passed`, et le vert du job ne permet pas de certifier une sous-suite qui a été ignorée.
5. Les paiements et notifications externes restent hors champ L4. Aucune prétention de L5 staging ou de L6 sans une exécution spécifique documentée.
6. La recette FULL se conduit par scénario, de la **source** à l'**information finale au client**, avec les rôles et marchés pertinents. Les écarts bloquants empêchent la clôture, pas les autres observations.

## Prochain raccordement sans nouveaux E2E

- Relire les artefacts de `Nightly E2E certification` et de chaque run boutique réellement exécuté (pas seulement les fichiers source).
- Référencer ces artefacts dans le cockpit, par marché et étape ; préserver l'accès par rôle.
- Distinguer explicitement dans l'interface : `Prouvé automatiquement`, `À vérifier humainement`, `Bloqué`, `Hors périmètre`.
- Préparer la séquence humaine boutique → OTP → liste/commande → paiement → fournisseur → hub → relais → livraison → finance → client, sans faire passer des Golden synthétiques pour un client réel.

## État des PR de préparation

- [#2482](https://github.com/SamyrFateh/komerce-backend/pull/2482) : L4 validée et fusionnée.
- [#2483](https://github.com/SamyrFateh/komerce-backend/pull/2483) : workflow P2 préparatoire ; run #38448297041 vert côté infrastructure, étape authentification/boutique **ignorée**. Ne remplace aucune preuve E2E historique et ne peut certifier P2.
