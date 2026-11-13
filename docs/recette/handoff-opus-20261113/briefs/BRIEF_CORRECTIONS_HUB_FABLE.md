# Brief Sonnet ÉCO : correctifs Hub issus de l'audit Fable #3998 (GO du propriétaire, 13/11 à 16h10)

Source : issue #3998. Lis-la entièrement : elle donne les preuves `fichier:ligne`, les correctifs minimaux et les invariants H1 à H9. Ne refais pas l'audit.

Règles communes : celles de `/home/claude/BRIEF_CORRECTIONS_PRE_E2E.md`, section « Règles communes ». Elles imposent notamment une PR par lot, un correctif minimal sur le writer existant (pas de second writer), une migration additive seulement, la mise à jour de SCHEMA.md (bloc `schema-pending`) et **aucune fusion**. Pousse au fil de l'eau et tiens `## Reprise` à jour.

## Décisions du propriétaire (ambiguïtés 1 à 7 de #3998)
1. **Rupture définitive d'une ligne** : la commande part avec ce qui a été reçu, et la quantité manquante est remboursée. Le remboursement passe par la voie de remboursement de ligne existante (`refund-intent-ledger`, `item-refund-psp-orchestrator`). L'avoir partiel n'est émis qu'à la confirmation (L4, déjà en place).
2. **Réception avant confirmation fournisseur** : autorisée. En revanche, une confirmation inférieure à la quantité déjà reçue est **refusée**, avec un code explicite.
3. **Ordre de service** : la commande la plus ancienne d'abord, comme dans le code actuel. Pas de changement.
4. **PO automatique** : la soumission API vaut preuve d'envoi. Le geste « Enregistrer l'envoi » est supprimé pour les PO automatiques.
5. **Unité en quarantaine** : elle ne compte **pas** comme reçue tant que la quarantaine n'est pas levée. Il faut une seule définition SQL de la quantité reçue.
6. **Vue directrice** : tous marchés confondus, avec l'**ancienneté** de chaque tâche et une alerte au-delà de 48 h.
7. **Anciennes routes de colis (HB-09)** : suppression confirmée, **mais après les E2E**. Hors périmètre ici.

## Lots
**Agent A**
- **H1, avancement automatique (HB-01, HB-02, HB-03)** :
  - La complétude est recalculée aussi sur un rejeu de réception.
  - Un balayage périodique dans `bootstrap/crons.js`, idempotent, reprend les commandes `ordered` entièrement reçues (invariant H1).
  - À la clôture d'une ligne sans reliquat : la complétude retient la quantité soldée, le reçu peut être réparti, une demande de remboursement de ligne est ouverte pour la quantité manquante (décision 1) et une alerte apparaît dans le dossier.
  - `distributeOrder` est appelé automatiquement au passage en `preparation`. Le bouton « Répartir » reste disponible comme reprise manuelle.
  - Tests : redémarrage simulé entre la réception et la complétude, puis rattrapage par le balayage ; rupture ; répartition automatique.
- **H2, double répartition (HB-04)** : verrou sur la commande dans `distributeOrder`, plus un index unique partiel `(order_item_id)` sur les lignes des colis actifs (migration additive). Avant de créer l'index, vérifie l'invariant H4 sur les données de test : si des doublons existent, arrête-toi et rapporte-les. Test de concurrence.

**Agent B**
- **H3, quantités (HB-05, HB-06, HB-07, HB-11)** :
  - Refus d'une confirmation inférieure à la quantité reçue (décision 2).
  - Une seule fonction ou vue de « quantité reçue », hors quarantaine (décision 5), utilisée par la répartition, la progression et le dossier.
  - `FOR UPDATE` sur les lignes à la réception simultanée, et erreur traduite en message exploitable (HB-07).
  - Refus à la création d'une ligne de PO regroupée sans variante (HB-11), sauf cas manuel prévu par L5 : vérifie comment les produits manuels du Fournisseur central portent leur SKU, et ne casse pas M06.
- **H4, visibilité directrice (HB-08 et décision 6)** :
  - Tâche « colis arrivé à rapprocher », avec son âge.
  - Ancienneté sur toutes les tâches du dossier Hub.
  - Vue tous marchés pour la directrice, avec une alerte au-delà de 48 h.
  - Tâche « commande bloquée par rupture ».
  - Tout se fait dans l'écran et le service existants (`hub-procurement-dossier`) : **aucun nouveau dashboard**.
- **Décision 4** : la soumission API d'une PO automatique pose la date d'envoi, et le geste manuel est retiré pour ce cas uniquement.

## Rendu
Rapport court : PR par lot, état de « Required verdict », points arrêtés faute de décision. Indique pour chaque lot quels scénarios de #3944 (N13 à N16, M01, M06) et quels invariants H1 à H9 il sécurise.
