# WATCH — autorisation humaine d'essai contrôlé (V1)

## Autorités et périmètre
Le moteur économique conserve exclusivement la décision `sourcing_candidates.scan_result.sourcing_decision`. Cette décision n'est ni éditée par l'interface ni convertie en `TEST` par un script. Le responsable admin peut enregistrer un **arbitrage commercial motivé** permettant à un candidat `WATCH` éligible de poursuivre la certification Catalogue, sans publier ni activer un prix marché.

La V1 est volontairement restrictive : `WATCH` avec santé économique `fragile`, marge de test calculée entre 15 % inclus et 25 % exclu, contribution de test strictement positive, achat et conversion KMF prouvés, catégorie douanière connue, source V2, aucune cotation FX ou douane en attente. `LOSS`, `AVOID`, `EXCLUDED`, `UNKNOWN`, `WATCH` sans données exploitables, quarantaines et produits déjà actifs sont refusés.

## Audit et caducité
Une décision `AUTHORIZE_CONTROLLED_TEST` ou `REVOKE` écrit un événement append-only dans la table existante `sourcing_candidate_events` avec `event_type = note_added`, `result.kind = CONTROLLED_WATCH_TEST_V1`, source de scan, faits fournisseur/coûts, date et identifiant admin ; motif entre 30 et 1 500 caractères.

Le dernier événement applicable prévaut. La certification n'accepte une autorisation que si l'horodatage de scan, le `scan_result` complet **et** tous les faits source enregistrés correspondent encore au candidat. Une nouvelle analyse ou modification du prix d'achat, devise, poids, volume, marge cible, catégorie, données de provenance ou contrat source annule implicitement l'autorisation courante. La révocation reste disponible via l'interface.

## Parcours
Dans `/admin/workspaces/sourcing?candidate_ref=...`, l'opérateur admin ouvre **Arbitrer un test limité**, saisit son motif et confirme. Le statut économique affiché reste `WATCH`. Le produit doit ensuite réussir la classification, la traduction éditoriale, la revue visuelle FR, la résolution des SKU/fournisseurs, l'approbation Catalogue, les contrôles économiques et l'activation du prix local par chaque Market.

Cette autorisation **n'est pas** une attestation visuelle, **n'est pas** un prix décidé, **n'est pas** un permis de publication en masse, **n'est pas** une commande fournisseur et **n'autorise aucun geste de paiement externe**.

## Tests et preuve avant fusion
- Unitaires : WATCH marginal éligible, tous refus économiques/métier, motivation et acteur obligatoires, écriture via l'autorité unique `sourcing-candidate-actions`, snapshot et révocation.
- Intégration PostgreSQL : dernier événement applicable, événement invalide non retenu, replay idempotent côté métier, scan et source modifiés invalidants, refus rôles non admin.
- Chromium desktop staging : parcours complet sous admin puis refus au profil non autorisé, revue visible et révocation ; vérifier qu'aucun produit, prix, commande ou notification n'est créé par le geste.
- **Ne pas fusionner si Required verdict échoue.** Aucun GO staging ne peut être déduit d'un test purement unitaire.
