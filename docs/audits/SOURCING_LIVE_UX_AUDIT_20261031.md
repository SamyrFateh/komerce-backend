# Audit métier et navigation — Sourcing Live

Date : 31 octobre 2026 — audit sur `main` après l'alignement Catalogue global maître (#3204). Périmètre : `/admin/import-runtime`, `/admin/workspaces/sourcing`, navigation Live, propriétaire backend `services/import-runtime-runs.js` et `services/sourcing-workspace.js`.

## 1. Décision métier non négociable

- **Source / fournisseur** : connexion, identifiants, capacités, certification du fournisseur, mode automatique ON/OFF, lancement d'un nouveau passage. Ces mutations appartiennent à Sourcing.
- **Passage KIR** : preuve d'une acquisition passée ou en cours. Le suivi est **en lecture seule** ; on ne « relance » ni ne « met à jour » ce même passage. Une nouvelle acquisition crée un **autre KIR**.
- **Candidat produit** : pièce de provenance et statut du passage ; la complétion produit (catégorie économique/douane et boutique, médias, FR, approbation) se résout **dans le Catalogue global**, qui délègue l'écriture au service propriétaire avec ses garde-fous.
- **Catalogue pays** : prix marché et publication, jamais dans Sourcing Live.
- **Diagnostic** : preuve technique d'un passage (erreur fournisseur, comptage, certification), à consulter sans devenir une nouvelle file de tâches produit.

Le produit, la source et le passage ne sont pas la même entité. Un seul objet métier par action.

## 2. Inventaire actuel : quatre onglets primaires + écran imbriqué

| Entrée visible | Ce qu'elle affiche vraiment | Actions / destinations vérifiées dans le code | Défaut / priorité |
| --- | --- | --- | --- |
| **Suivi** (`/admin/import-runtime?run=KIR`) | **Un seul passage KIR** (souvent le dernier), flux 4 étapes, compteurs, événements et produits récents | Populations, sous-étapes, preuve technique, Catalogue ; barre *Mettre à jour / Arrêter / Redémarrer* | **P0** : commandes de source greffées au passage, association source passée par repli sur le libellé du fournisseur puis source unique activée. Risque de contrôler une autre source. *Mettre à jour* crée en réalité un nouveau KIR. |
| **Passages** (`?view=passages`) | Historique des KIR | Filtres source, état, période, texte ; ligne → Suivi du KIR | **P1** : 9 colonnes ; KPI « Candidats détectés » toujours « Non disponible » ; chiffre *Action requise* non cliquable dans la ligne ; recherche limitée à la page. |
| **Sources** (`?view=sources`) | Inventaire des connecteurs, assistants, secrets, états, certification, automatisation | Ajouter, configurer identifiants, tester, préparer/certifier (premier vrai passage), activer/désactiver, importer maintenant, renommer, archiver, restaurer | **P1** : trop de gestes sans hiérarchie ; *Préparer et certifier* peut changer les capacités `discovery/sync/import/production` et déclencher un passage. *Activer* peut lui aussi lancer un import réel. *Arrêter* cesse l'automatisation future, pas les KIR en cours. |
| **Exceptions source** (`/admin/workspaces/sourcing?tab=candidates`) | Ouvre une **deuxième application Sourcing** qui possède elle-même *Sources & imports / Exceptions source / Fournisseurs* | Corriger prix/devise fournisseur, scan source, et liens Catalogue | **P1** : la navigation donne l'impression de 7 rubriques. Le lien générique depuis *Action requise* ne conserve pas toujours le `candidate_ref`. Les écrans d'import et de fournisseurs doublonnent l'organisation du Live. |

### Autres ruptures de parcours confirmées

- **P0 — commande liée à une mauvaise source** : `sourceForRun()` accepte une association heuristique si `source_ref` du KIR est absent / non reconnu, et attache ensuite des POST de gestion de la source. **Aucune mutation fournisseur ne doit être proposée depuis une fiche KIR historique.**
- **P1 — correction catégorie en double** : `renderExceptions()` ouvrait un dialogue « Classer » dans Sourcing Live, avec `GET .../category-options` puis `POST .../resolve-category`. Le Catalogue global possède déjà ce parcours pour les candidats sans KPR.
- **P1 — perte de cible** : les actions autres que « Classer » ouvraient `/admin/workspaces/sourcing` sans `candidate_ref`, donc retour à une file générique et aucune réponse sur le produit cliqué.
- **P1 — « Voir le détail » du mauvais objet** : `itemHref()` renvoyait à une étape technique quand un produit n'avait pas encore de `product_ref`, même s'il avait son identifiant fournisseur. La vue `item` sait pourtant charger la trace exacte par `supplier_product_id`.
- **P1 — actions supposées par texte** : `actionKindFor()` déduit *corriger / choisir / compléter / examiner* par expressions régulières des motifs source et fabrique des éléments de liste sans `candidate_ref` pour réconcilier les compteurs. Ces lignes ne doivent **pas** se présenter comme des corrections produits directement réalisables.
- **P2 — densité et langage** : pipeline source + barres temps réel + compteurs + cartes produit + preuves de certification sur une vue de passage terminé ; la priorité opérateur n'est plus évidente.
- **P2 — doublons fournisseurs** : distinguer les *connecteurs/Sources* dans Live et les *partenaires commerciaux* gérés par `sourcing-workspace`. Les deux concepts peuvent exister, mais ne doivent pas être deux portes similaires pour un opérateur.

## 3. Matrice de destination cible — une action = un objet = un effet

| Problème constaté | Où ? | Action unique | Effet métier et preuve |
| --- | --- | --- | --- |
| Aucune source connectée | **Sources** | Configurer la source | Met à disposition une source enregistrée ; aucune importation inventée |
| Connexion invalide / clé absente | **Sources** | Fournir les identifiants ou tester la connexion | Requête de contrôle fournisseur, statut de la source actualisé |
| Source non certifiée | **Sources** | Préparer/certifier (avec explication qu'un **vrai premier passage** est effectué) | KIR de certification, décision runtime, autopilot OFF |
| Source prête, acquisition ponctuelle | **Sources** | Lancer un passage | `POST import-now` → **nouveau KIR** fourni par le serveur |
| Source prête, alimentation continue souhaitée | **Sources** | Activer l'automatisation | Peut préparer/certifier et lancer un passage ; journal et état ON |
| Alimentation continue en cours | **Sources** | Suspendre l'automatisation | Stoppe les prochains déclenchements ; **ne garantit pas l'arrêt du passage déjà lancé** |
| Passage en cours ou terminé | **Passages → Détail KIR** | Consulter les compteurs, populations et preuves | Lecture seule ; aucune commande de source attachée à un KIR |
| Candidat KSC, catégorie/media/titre/approbation | **Catalogue global** | Ouvrir la correction du candidat exact | `candidate_ref` conservé, moteur propriétaire sollicité sous ses grants |
| Prix fournisseur/devise réellement absent | **Exceptions fournisseur** (accès contextuel seulement) | Corriger les faits source exacts | Écriture Sourcing canonique + nouveau contrôle ; pas de prix de vente |
| Anomalie technique/comptage sans identifiant candidat | **Preuve du passage** | Voir le diagnostic | Pas de faux bouton « corriger le produit » |
| Fiche globale conforme | **Catalogue pays** | Décider du prix puis publier | Activation marché conditionnée aux gardes économiques et réglementaires |

## 4. UX cible en deux niveaux, pas sept écrans

**Niveau 1 : Sourcing Live.**
- **Sources** — configurer fournisseurs et automatisation ; l'état d'une source dicte **l'unique prochaine action principale**. Les actions secondaires (renommer/archiver/identifiants/détails techniques) sont repliées.
- **Passages** — tableau compact des KIR, avec *source, date, état, reçus/traités/remis, anomalies exploitables* et lien direct au passage.
- **Suivi** — pas une autre file : la fiche du KIR sélectionné depuis Passages. Affiche « Que s'est-il passé ? » avec 4 étapes métier et les populations. *Aucun bouton qui commande une autre source.*

**Niveau 2 : résolution contextuelle.** Depuis un KIR, le produit va vers **Catalogue global** et la vraie anomalie de connexion vers **Sources**. Les exceptions de faits fournisseur peuvent ouvrir le mini-écran spécialisé avec le `candidate_ref` déjà ciblé ; ce n'est pas un quatrième onglet Live. Une anomalie non résoluble reste un diagnostic.

### Critères d'acceptation

1. Trois entrées Live maximum (Suivi, Passages, Sources), pas de sous-menu « Exceptions source » général.
2. Dans Suivi du KIR : **zéro** POST source, zéro contrôle heuristique d'une source sans correspondance exacte.
3. Dans Action requise : **zéro** formulaire produit dupliqué, **zéro** lien générique qui perd la référence exacte, **zéro** correction inventée pour une anomalie de comptage.
4. Un produit source sans `product_ref` mais avec `supplier_product_id` ouvre sa **trace exacte**, pas l'étape technique entière.
5. Un passage terminé demeure une preuve immuable ; une nouvelle acquisition reçoit un nouveau KIR.
6. Tester les états réels : source prête, non certifiée, connexion invalide, KIR réussi, KIR bloqué, WATCH avec catégorie manquante, exception sans candidat, candidat déjà remis.
7. Audit Chromium desktop sur les trois onglets et 100 % des liens disponibles à l'état testé, avec navigation Retour ; aucun clic ne publie de produit ni prix.

## 5. Ordre d'implémentation recommandé

- **Lot A — intégrité des clics** : supprimer les commandes fournisseur sur le KIR, retirer la quatrième entrée, router les exceptions avec identité exacte, corriger `itemHref` et préserver le `return_to`. **C'est la branche de correction associée à cet audit.**
- **Lot B — clarification des Sources** : mode « source → étape requise → action unique », séparer *Lancer un passage* de *Activer la récurrence*, rendre explicitement visible que *Préparer* déclenche un passage et que *Suspendre* n'annule pas un passage actif.
- **Lot C — Passages lisible** : 6–7 colonnes maximum, retirer le KPI constamment indisponible, rendre les compteurs actionnables, vue Suivi = niveau 2 après un KIR, 1440 desktop.
- **Lot D — retirements UX** : fusionner ou rediriger les rubriques Import/Fournisseurs de l'ancienne `sourcing-workspace` vers Live sans retirer la correction source autorisée, garder `/admin/workspaces/sourcing?candidate_ref=...` comme route profonde.

## 6. Garde-fous

Aucune migration DB, aucun changement de rôle, aucune modification des règles de scanner, de source FX, du produit, du prix ni de l'exposition marché. Aucun raccourci qui transforme un WATCH en produit publié. Conserver les preuves KIR historiques et les données fournisseur d'origine. Une réforme d'interface ne masque jamais une anomalie métier persistée.
