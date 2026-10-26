# Komerce — Recette interactive locale sur le vrai staging

Ce lanceur exécute **Chromium sur ton PC Windows** contre le backend Railway
**déjà déployé** à `https://komerce-backend-production.up.railway.app`.
Il ne démarre aucun serveur ni base locale. La sélection est faite par
**domaine, identité E2E et écran (desktop/mobile)**.

## 1. Prérequis Windows PowerShell

À la racine de `D:\komerce-backend`, sur `main` à jour :

```powershell
cd D:\komerce-backend
git pull --ff-only
npm ci
npx playwright install chromium
```

Node.js 20+ et Git doivent être installés. L'URL cible est *fixe*. Aucun
paramètre libre ne permet d'exécuter le runner contre la production par erreur.

Le lanceur vérifie `/health/version` avant d'ouvrir le navigateur. S'il voit
un autre SHA, il refuse la recette, **sauf si le Git diff prouve que seuls
les fichiers de test et les outils ont changé**. Il épingle ensuite le SHA
réel du staging et vérifie qu'il ne change pas pendant chaque scénario.

## 2. Choisir son domaine

```powershell
# Voir l'inventaire des cas possibles, sans saisir de mot de passe
.\scripts\recette\launch-staging-interactive.ps1 -Domain all -Role admin -Mode list

# Pilotage et Action Center, desktop, dans Playwright UI
.\scripts\recette\launch-staging-interactive.ps1 -Domain pilotage -Role admin -Device desktop

# Finance, mobile, avec un vrai compte Finance E2E
.\scripts\recette\launch-staging-interactive.ps1 -Domain finance -Role finance -Device mobile

# Raffinerie / Sourcing : navigation des écrans, pas publication de produits
.\scripts\recette\launch-staging-interactive.ps1 -Domain raffinerie -Role sourcing -Device desktop

# Catalogue pays et exposition locale
.\scripts\recette\launch-staging-interactive.ps1 -Domain catalogue -Role market_operator -Device mobile

# Opérations Hub : arrêter l'exécution au niveau des écrans pour les inspecter
.\scripts\recette\launch-staging-interactive.ps1 -Domain operations -Role agent_hub -Mode manual

# Relais ou transitaire
.\scripts\recette\launch-staging-interactive.ps1 -Domain operations -Role agent_relais -Device mobile
.\scripts\recette\launch-staging-interactive.ps1 -Domain transit -Role agent_transitaire

# Tous les écrans autorisés au rôle : organiser/rejouer par dossier dans Playwright UI
.\scripts\recette\launch-staging-interactive.ps1 -Domain all -Role admin -Device both
```

Domaines disponibles : `pilotage`, `commerce`, `commandes`,
`sourcing`, `raffinerie`, `catalogue`, `publication`, `prix`,
`operations`, `transit`, `finance`, `marches`, `administration`.
Un domaine sans route autorisée pour le rôle demandé **échoue explicitement**.

Modes disponibles :
- `ui` (par défaut) : interface Playwright, relance sélective et détails des pas.
- `manual` : Inspecteur Playwright et pause sur le véritable écran afin de
  vérifier à la main. Cliquer « Resume » pour valider la fin du scénario.
- `debug` : inspecteur pas à pas.
- `headed` : Chromium visible, mais tests automatiques.
- `list` : inventaire seulement, aucune connexion ni navigation.

Les comptes sont lus depuis `E2E_<ROLE>_EMAIL` et
`E2E_<ROLE>_PASSWORD` s'ils sont déjà dans les variables du processus.
Sinon le lanceur demande l'email et saisit le mot de passe **masqué**, sans
l'écrire dans un fichier. Le processus restaure ses variables à la sortie.
Ne copie **jamais** les secrets GitHub/Railway dans le chat, un commit ou une
capture. Aucune exportation de `.env` n'est nécessaire.

## 3. Qu'est-ce qui est réellement testé ?

Pour chaque page sélectionnée, Playwright :

1. confirme le SHA du staging réel ;
2. s'authentifie avec le compte E2E exact, et vérifie `/api/auth/me` ;
3. interdit les requêtes `POST/PUT/PATCH/DELETE` du navigateur après login ;
4. vérifie le contexte marché (403 attendu uniquement pour Sourcing) ;
5. visite la page réelle, contrôle HTTP, destination, contenu affiché ;
6. teste les refus inter-marchés d'un opérateur dans le domaine `marches` ;
7. photographie l'écran et relève les exceptions JS, les erreurs API 5xx et
   l'éventuel changement de SHA.

Les captures et rapports restent en local dans
`test-results/staging-interactive/` (dossier ignoré par Git).
**Les captures peuvent montrer de vraies données staging : ne pas les publier
telles quelles dans les issues.**

Une preuve positive signifie uniquement :
**écran nominal observé en lecture seule pour ce rôle et cette version**.
Cela ne certifie pas automatiquement les transitions P1–P7.

Les entrées `raffinerie` et `publication` sont **des vues d'inspection**
des écrans existants, pas des déclencheurs de traitement ou de publication.

## 4. Boutique publique interactive

La boutique dispose d'un **autre** runner Playwright, dans
`public/boutique`. Pour calibrer ses sélecteurs sur le staging réel :

```powershell
cd D:\komerce-backend\public\boutique
npm ci
npx playwright install chromium
$env:BASE_URL='https://komerce-backend-production.up.railway.app/boutique/'
npx playwright test tests/e2e/calibration.spec.js --project='Desktop Chrome' --ui
```

On peut ensuite examiner `catalog.spec.js`,
`catalog-market-exposure.spec.js`, `search.spec.js`,
`navigation.spec.js` et `render-integrity.spec.js` comme le workflow
`staging-storefront-e2e-audit.yml`. Les tests boutique existants possèdent
leur propre politique et ne bénéficient **pas** du blocage des écritures
du runner dashboards : n'exécute pas les tests de paiement, annulation,
panier actif ou wallet sur un staging partagé sans isolation de données.

## 5. À ne pas confondre

- `npm run test:e2e:dashboards` = Chromium avec **API simulées**, local (L3).
- Ce runner = Chromium local + **backend staging réel**, lecture seule (preuve
  de navigation de niveau L5, **pas certification métier L5 complète**).
- Scénarios fournisseur, cash, commandes, achats, publication ou paiements
  sont parfois **mutants**. Ils exigent un environnement isolé, jeu de données
  jetable, preuve avant/après, nettoyage sélectif et décision humaine.
  Ne pas pointer aveuglément leurs scripts contre Railway staging.

Suivi central : issue GitHub #2914. Référentiel de preuves :
`docs/audits/KOMERCE_E2E_CERTIFICATION_GAP.md`.
