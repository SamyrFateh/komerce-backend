# Hub Live — Dossiers vivants · UX V3 (2 novembre 2026)

## Décision
La première vue Hub Live desktop est **Dossiers**, plutôt qu'un tableau de tâches techniques. Référence métier : mock Work du 2 novembre (dossier alimenté par les commandes ; PO indépendantes, réception partielle, refus/dommage, reliquats suivis). Le visuel exact du mock Work n'était pas directement accessible dans cette reprise : conformité pixel **non certifiée**.

## Poste de travail
- **Dossiers** : quatre métriques au plus, projetées par le service Hub (ne pas recopier le tableau Relais). Chemin cinq étapes : Besoins → PO → Réceptions → Colis/Cartons → Départs.
- **Besoins à approvisionner** : lignes de commandes et quantités ouvertes. Lien vers Achats fournisseurs, propriétaire de la constitution/émission des PO.
- **PO fournisseurs** : un panneau par PO, état, preuve d'envoi, barre *reçu / confirmé* de simple présentation, tableau des lignes commande → article → quantité confirmée → reçue → reliquat → anomalie. Filiation demandée à l'API serveur existante et affichée sous les dossiers.
- **Réceptions** : ancien outil physique conservé, quantité reçue explicitement saisie, jamais déduite du statut fournisseur, référence idempotente.
- **Actions Hub** : répartition/expédition du module existant, non réimplémentée. **Stock à affecter** : ancien outil d'affectation, pas de seconde mutation.
- **Cartons** : ouverture d'un dossier expédition même vide, association/dissociation avant remise et contrôles déjà effectués par le backend.
- **Écarts** : information de suivi dans le dossier ; ne pas qualifier de « critique » un simple délai/quantité restant à recevoir. Seules les véritables décisions bloquantes vont dans « À traiter ».

## Invariants
1. 1 PO = 1 fournisseur + 1 Hub + 1 marché. Un carton ne mélange pas les marchés.
2. Une commande peut avoir plusieurs PO et plusieurs réceptions ; ne jamais dériver son état final du seul avancement d'une PO.
3. Le reçu/confirmé est strictement *indicatif* : la réception physique prouvée et les mutations restent serveur.
4. Les reliquats et dommages ne ferment pas la commande client, ne disparaissent pas du journal, ni ne réattribuent des quantités.
5. LOCAL_STOCK n'emprunte jamais les étapes d'import. Commande mixte et retrait partiel : issue #3264, aucune fausse certification.
6. Aucune nouvelle API ou route d'écriture dans ce lot ; hors lot réconciliation backorder et dernier kilomètre.

## Recette exigée avant fusion
- E2E Chromium desktop 1440 : premier écran Dossiers, PO avec articles et reliquat, filiation, ouverture des autres onglets, actions conservées, rôles, marché.
- PostgreSQL : vérifier un dossier avec deux PO dont une partiellement reçue, un colis endommagé et un reliquat ; aucun état fabriqué par le frontend.
- Recette visuelle sur SHA Railway, capture avant/après ; comparer la vraie maquette Work quand son fichier sera accessible.
- Preflight + Required verdict verts ; ne pas fusionner le brouillon tant que non prouvé.

## Exclusions
Pas de réécriture du moteur PO, de la state machine des commandes, du service de collecte, ni d'invention de stock local. Les autres PR ouvertes, en particulier #3263/#3264 et #3265, doivent être réconciliées séparément.