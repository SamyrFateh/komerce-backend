# Audit métier / ergonomie — Sourcing Live : une seule surface opérateur

Date : 2026-10-31. Référence : captures des onglets `/admin/workspaces/sourcing?tab=candidates` et `/admin/import-runtime`, puis revue de `main` SHA `d4a2cb67`. **Audit statique et des deux captures reçues ; pas encore certification navigateur authentifiée de tous les onglets**.

## Principe irréversible

- **Sourcing Live** : connecter les fournisseurs, acquérir les produits, vérifier l'intégrité de l'acquisition, suivre la preuve des lots KIR et traiter **uniquement les exceptions sourcing actionnables**.
- **Raffinerie** : pipeline automatique, diagnostic si erreur, sans deuxième file humaine.
- **Catalogue global** : seule file humaine de correction du contenu et de classification (économique/douane, Boutique, français, médias), y compris pré-KPR via `candidate_ref`.
- **Catalogue pays** : coût / prix / publication, jamais avant approbation globale.
- Pas de deuxième étape « Examiner → Corriger » si la première action annonçait déjà la correction.
- Les diagnostics et preuves doivent être conservés, mais placés sous « Détails techniques » et non dans l'écran opérateur par défaut.

## Inventaire et décisions de navigation

| Surface | Objet / contenu actuel | Décision UI |
| --- | --- | --- |
| `/admin/import-runtime` : Suivi | KIR choisi, progression, résultats, état source, pilotage source, actions, preuve | **Conserver** ; simplifier en résultat + étape actuelle + intervention pertinente ; aucun pilotage de source ambigu dans un lot historique |
| `/admin/import-runtime?view=passages` | Historique des KIR, filtres, dates, progression et états | **Conserver** ; une ligne par passage, statut de remise séparé, détail sous clic |
| `/admin/import-runtime?view=sources` | Configuration, connexion, fournisseurs, nouvelles sources, certification, activation, lancement | **Conserver comme seule autorité UI source** ; intégration des imports manuels et CSV en option secondaire |
| `/admin/workspaces/sourcing` : Sources & imports | Autre lanceur import-now, CSV/JSON brut, navigation Cockpit | **Fusionner dans Sources du Live** ; ancienne URL redirige ou s'ouvre sur bon onglet sans second shell |
| `/admin/workspaces/sourcing?tab=candidates` | Exceptions source par candidats (prix, devise, scan), comptage global | **Intégrer au suivi**, pas d'autre onglet parallèle ; identités de lot et candidat conservées |
| `/admin/workspaces/sourcing?tab=suppliers` | Table `partners` de `partner_type=sourcing` distincte des sources connectées | **Sous-menu administratif de Sources** ; ne jamais laisser « Fournisseurs 0 » faire croire à zéro source |
| `/admin/import-runtime?view=exceptions` | Action requise sur KIR, bouton « Classer » local ou détour vers autre Sourcing | **Distinguer source vs produit** : source avec action directe dans Live ; classement vers Catalogue sur `candidate_ref` |
| `/admin/import-runtime?view=history/control/item/handoff/population` | Traces, étapes, populations, fiches techniques | **Conserver les preuves** ; ouvrir via détail contextuel, jamais nouveaux onglets concurrents |

## Constat d'audit — priorité et preuve

| ID | Priorité | Constat vérifié / risque | Correction visée |
|---|---|---|---|
| SL-01 | P0 UX | Un formulaire manuel est créé avec `panel.hidden=true` mais porte la classe `.kmc-workspace-section-actions { display:flex }` : les styles peuvent rendre visibles les entrées de formulaire non demandées (capture du 31/10) | Appliquer `[hidden]{display:none!important}` ciblé ou remplacer par panneau avec visibilité explicite testée Chromium ; manuel/CSV repliés |
| SL-02 | P0 métier | `sourceForRun` dans `import-runtime.js` autorise des replis par libellé, fournisseur, source activée unique ou source unique pour afficher les commandes d'un lot | **Toute commande mutante exige un `source_ref` exact**. Sinon affichage en lecture seule + « Aller aux Sources » ; ne jamais lancer sur une source devinée |
| SL-03 | P1 | `Mettre à jour maintenant` appelle en réalité `POST /sources/{ref}/import-now` | Renommer « Lancer un nouvel import » ; conséquence, résultat `KIR`, protection double déclenchement |
| SL-04 | P1 | `Redémarrer` appelle `POST activate`, peut activer l'alimentation automatique et générer un passage | Renommer « Activer l'alimentation automatique » ; arrêter = « Suspendre l'automatisation » ; détails/confirmation visibles |
| SL-05 | P1 | `/admin/import-runtime?view=exceptions` expose `Classer` et un formulaire catégorie économique local, alors que Catalogue global propose la même correction | Retirer le formulaire local et créer un lien direct vers la correction contextuelle Catalogue `?search=KSC-...` |
| SL-06 | P1 | Le résumé `Sources connectées` du Sourcing Workspace affiche `summary.sourcing_sources`, nombre de sources enregistrées, sans prouver leur connexion opérationnelle | « Sources configurées » ou compteur de `connector_ready` vérifié |
| SL-07 | P1 | L'onglet « Sources & imports · 5 » compte des passages historiques, pas les sources ; « Fournisseurs · 0 » compte les partenaires administratifs et non les 3 sources | Supprimer les compteurs d'onglets trompeurs ; afficher un seul ensemble de chiffres cohérents |
| SL-08 | P1 | « Exceptions source : 0 » dans Workspace vient du filtre `sourcingRemedy` ; « Action requise : 4 » au KIR vient de `buildActionItems` : périmètres et types différents | Cartes avec périmètre : exceptions d'acquisition / corrections de fiche, rattachées au KIR et orientées vers le bon owner |
| SL-09 | P1 | Un run devient `RUNNING` tant que `catalogued < certified`, malgré les étapes Sourcing finies. L'écran peut afficher « LIVE » et 102 h de durée | Différencier **traitement actif** / **remise en attente** / **anomalie de remise**. Pas de faux « LIVE » perpétuel ; diagnostic de reprise idempotente au backend |
| SL-10 | P1 | 20 reçus, 16 retenus, 11 mis de côté et 4 « action requise » ne sont pas des populations exclusives ; les quatre peuvent être inclus dans les onze | Afficher une partition démontrée + « dont X nécessitant intervention », sans additionner des ensembles qui se croisent |
| SL-11 | P1 | La barre de commandes de fournisseur apparaît au milieu du suivi historique d'un KIR | Déplacer les mutations vers la fiche **Sources** ; sur Suivi, lien « Voir la source » avec référence vérifiée |
| SL-12 | P2 | Le certificat fournisseur, les étapes détaillées, le flow, les KPI, le statut LIVE et la liste de décision répètent l'état du même passage | Un seul résumé de progression/résultat ; preuve technique sous « Détails du passage » |
| SL-13 | P2 | Le formulaire manuel est un textarea de JSON/CSV brut et pas un véritable import de fichier ; l'apparence est confuse | Action secondaire « Importer un fichier CSV » pour CSV, saisie manuelle structurée pour rares cas ; ne pas forcer des non-techniciens à produire du JSON |
| SL-14 | P2 | Deux surfaces proposent de créer des fournisseurs/sources avec des objets métier différents : `partners` vs `sourcing_sources` | Séparer visuellement « Sources connectées » et « Référentiel partenaires » (administration avancée) ; ne pas les appeler tous deux « Fournisseurs » |
| SL-15 | P2 | L'ancien code `renderPortfolio` persiste même si le nouvel onglet n'est plus affiché | Supprimer l'UI morte et ses styles/tests obsolètes après vérification des usages externes ; conserver l'owner métier |
| SL-16 | P2 | Les statuts et erreurs techniques (FX, preuve provider, cas historiques) sont visibles en langage interne | Montrer uniquement « Action nécessaire » + résolution, détails techniques repliés et conservés pour audit |

### Éléments à ne pas supprimer

1. Invariants backend d'import `KIR`, stage events, certification de source, scan, preuves d'exposition.
2. Logs et traces pour relecture de l'historique, rejets et litiges.
3. Droits d'action, gestion des secrets fournisseur, contrôle de concurrence sur imports, activation.
4. Correction source sur service propriétaire, et correction produit uniquement par les endpoints canoniques du Catalogue/Sourcing, sans franchir ses grants.
5. Produits WATCH et différés conservés dans le registre et le Catalogue ; pas de suppression implicite de données.

## Contrat UI cible (desktop)

**Trois onglets maximum** :
- **Suivi** : dernier passage ou KIR choisi, verdict réel, `reçus → acceptés → remis`, **actions véritablement exigées** reliées à la bonne destination (source ou Catalogue), bouton « Voir les passages ».
- **Passages** : historique KIR filtrable ; cliquer une ligne ouvre Suivi avec ce KIR, sans barre de commande.
- **Sources** : sources avec état de connexion, dernière acquisition, automatisation, action unique « Importer maintenant » ou « Configurer », et menu secondaire « Activer/Suspendre » ; `Ajouter une source`, `Import CSV`, `Importer manuellement`, `Partenaires` discrets.

## Matrice action → effet → propriétaire

| Action visible | Endpoint ou comportement actuel | Autorité future / garde |
|---|---|---|
| Importer · source | `POST /sources/{ref}/import-now` | Sources, ref exacte, renvoie KIR, anti-double lancement |
| Mettre à jour maintenant | Même `/import-now` | Supprimer doublon ; jamais présenté comme un simple refresh |
| Redémarrer | `POST /sources/{ref}/activate` | Sources uniquement, libellé explicite, garde credential/capabilities |
| Arrêter | `POST /sources/{ref}/deactivate` | Sources uniquement, confirmation |
| Classer dans KIR | `GET category-options` puis `POST resolve-category` | Lien Catalogue contextuel ; pas de formulaire duplicatif |
| Corriger prix/devise/poids fournisseur | `POST /candidates/{ref}/update` | Exception source directement actionable, pas une fiche produit à qualifier |
| Contrôler la source | `POST /candidates/{ref}/scan` | Sourcing, uniquement si input réel et état permet |
| Import CSV / manuel | `POST /imports` | Sous Sources, contrôle de format et résultat KIR |
| Ajouter / modifier un fournisseur | `POST /suppliers`, `/suppliers/{ref}/update` | Administration secondaire dans Sources |
| Corriger titres FR/taxonomie/médias | Endpoints canoniques de correction du Catalogue | Catalogue global uniquement |
| Prix, activation commerciale, publication marché | Marché | Catalogue pays uniquement |

## Recette et preuve de « sans superflu »

- Naviguer chaque onglet avec rôle admin et opérateur, desktop 1440, captures du dessus et des panneaux secondaires. Aucune page parallèle qui exige une décision de fiche hors Catalogue.
- Pour chaque contrôle cliquable : `UI → route → permission → mutation? → nouvel état → destination` ; aucun bouton muet, ambigu, doublonné ou à effet de bord non expliqué.
- Importer une source de test réelle et vérifier `run_ref`, progression, états de preuve, événements ; ne pas rejouer les cinq fixtures RCT1.
- Tester un KIR en cours, terminé, sans résultat, en erreur, en attente de remise et ancien KIR ; protéger la source associée strictement par ref.
- Tester WATCH économique, erreur fournisseur et dossier Catalogue à compléter ; les chiffres doivent provenir des mêmes scope/owner, les recouvrements explicités.
- Vérifier qu'une navigation ou un GET ne fait ni `POST`, ni activation source, ni mise en vente.
- Relancer Jest, Playwright desktop, droits et `Required verdict` avant fusion. Vérification humaine sur staging ensuite.

## Statut

- **Audit statique + deux captures : documenté** (16 décisions à instruire).
- **Audit utilisateur des onglets Passages et Sources et clics réels : à compléter**. Ne pas prétendre que ces parcours ont été certifiés.
- **Code de simplification : non modifié par ce document**, afin de laisser les décisions UX traçables avant d'enlever des contrôles utiles.
