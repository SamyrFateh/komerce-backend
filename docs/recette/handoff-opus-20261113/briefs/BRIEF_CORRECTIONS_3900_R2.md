# Brief Sonnet ÉCO : correctifs issus de la passe #3900 (GO du propriétaire, 13/11 à 09h54)

Source : issue #3900, commentaire 6848393664 (passe MANUAL KM, commande KC692IV). Lis-le, puis va droit au code. Règles communes : celles de `/home/claude/BRIEF_CORRECTIONS_PRE_E2E.md` (« Règles communes »), à appliquer telles quelles. Une PR par lot, correctif minimal sur les writers existants, tests ciblés, **pas de fusion**. Pousse au fil de l'eau et tiens `## Reprise` à jour.

## Lot R1 (P0) : code de retrait accessible au client
Constat : le code n'est affiché nulle part côté client. `reveal-once` renvoie 410 après 30 minutes, même après un `regenerate` admin.

Correctif :
- Dans « Mon Komerce », sur une commande prête au retrait dont il est propriétaire, le client peut **générer un nouveau code**. Le geste fait tourner le secret, invalide l'ancien code et affiche le nouveau une seule fois.
- Réutilise le service canonique (`ensureSecretGenerated`, rotation existante). Pas de second writer, pas de stockage du code en clair.
- Garde-fous :
  - session du propriétaire de la commande seulement ;
  - au plus 5 générations par commande et par 24 h ;
  - audit de chaque génération ;
  - refus si la commande est déjà retirée ou annulée.
- Le parcours normal (reveal one-shot juste après paiement ou disponibilité) reste inchangé.
- Tests : propriétaire OK, autre client 403, quota, ancien code refusé après rotation, commande retirée refusée.

## Lot R2 (P0) : anti-bruteforce réel au retrait par code
Constat : l'agent saisit le code sans désigner de commande. Un code inconnu renvoie 404 sans aucun compteur, ce qui permet des essais illimités. Le verrou L1 ne joue que si une commande est ciblée.

Correctif :
- Ajoute un compteur d'échecs par **agent et relais** sur `collectByPickupCode`, pour les codes inconnus comme pour les mauvais codes.
- Au-delà de 5 échecs en 15 minutes : 429 pour cet agent sur ce relais pendant 15 minutes, et alerte de sécurité.
- Le compteur L1 par commande est conservé.
- Stockage durable : réutilise une table d'audit ou de compteur existante si possible, sinon une migration additive minimale.
- Tests : 5 codes inconnus puis 429 ; un autre agent du même relais n'est pas bloqué, ou l'est selon la clé choisie (le choix est à justifier dans la PR) ; remise à zéro après la fenêtre ; aucun impact sur un bon code avant le seuil.

## Lot R3 (P0) : preuve de retrait visible par le client
Constat : `pickup_proof` est ancrée sur `pickup_handoff`, mais « Mon Komerce » ne liste que la facture.

Correctif : la liste des documents client inclut les preuves `subject_type='pickup_handoff'` de ses commandes, téléchargeables avec le même contrôle propriétaire que les autres documents.

Tests : propriétaire voit et télécharge la preuve, autre client 403.

## Lot R4 (P0) : vrai mode manuel à la réception fournisseur Hub
Constat : dans `public/dashboards/canonical/js/operations-workspace.js` `collect()` (l.~488-493), un code saisi puis Entrée est enregistré comme `SCAN` et la justification est perdue. Un scanner physique émule un clavier : on ne peut pas distinguer les deux à la frappe.

Correctif :
- Ajoute un **interrupteur explicite « Saisie manuelle »**, comme le dépôt en sac l'a déjà (#3902, #3923).
- Interrupteur actif : le code saisi est enregistré avec la provenance `MANUAL`/`manual_confirmation`, la justification est obligatoire et conservée, et le writer et les contrôles sont les mêmes que pour le scan.
- Interrupteur inactif : `SCAN`.
- Tests UI et service : provenance stockée correcte, justification exigée en manuel.

## Lot R5 (P0) : montants et libellés côté client
- **Total à 0 KMF** : « Mon Komerce » affiche 0 KMF comme total de la commande KC692IV. Trouve la cause (champ lu, devise ou pivot) et corrige la lecture, sans recalcul côté client.
- **Produits manuels sans nom ni image** dans le récapitulatif du checkout (Fournisseur central). Corrige la projection lue par le récapitulatif.
- Tests de non-régression, y compris CM et CG (XAF).

## Lot R6 (P1) : défauts opérationnels
- Le relais live affiche « 1 Encaisser » sur une commande déjà encaissée : la projection doit exclure le cash confirmé.
- Réception relais : refus **serveur** d'une quantité reçue supérieure à la quantité expédiée, plus un blocage à l'écran.
- La création de dossier douane présélectionne les colis du marché : aucune présélection, sélection explicite seulement (vérifie d'abord ce que #3887 avait corrigé).

## Rendu
Rapport court : PR par lot, état de « Required verdict », points arrêtés faute de décision métier.
