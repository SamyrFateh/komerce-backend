## Checklist avant merge

Aucune PR ne doit être mergée sans avoir coché les points applicables.

### Documentation lue

- [ ] J'ai consulté docs/README.md avant de coder.
- [ ] J'ai consulté docs/CARTOGRAPHY_360.md si routes, domaines ou tables changent.
- [ ] J'ai consulté docs/ZONE_IMPACT.md si commande, paiement, wallet, colis, statut, scan ou pricing changent.
- [ ] J'ai consulté docs/BOUTIQUE_ARCHITECTURE.md si la PR touche la Boutique.

### Si modification Boutique

- [ ] Les fichiers touchés sont listés ci-dessous.
- [ ] L'owner du composant est identifié selon docs/BOUTIQUE_ARCHITECTURE.md.
- [ ] Le fichier modifié est bien propriétaire du problème traité.
- [ ] Aucune seconde source de vérité n'a été créée.
- [ ] Le mobile pager n'est pas cassé.
- [ ] Le desktop n'a pas reçu de hack mobile.
- [ ] Le rail catégories reste piloté par shop-schema.js -> render-categories.js -> home-controller.js.
- [ ] Les cartes produit restent pilotées par render-product-card.js.
- [ ] Aucune règle .k-chip / .k-cats n'a été ajoutée hors owner.
- [ ] Aucune règle .k-grid / .k-card de base n'a été dupliquée hors products.css.

### Sécurité

- [ ] Pas de secrets en dur dans le code.
- [ ] Les requêtes SQL sont paramétrées.
- [ ] Les routes sensibles ont authenticate + requireRole lorsque nécessaire.
- [ ] Les entrées utilisateur sont validées.

### Qualité

- [ ] Le code a été testé localement ou la raison de non-test est expliquée.
- [ ] Pas de console.log de debug restant.
- [ ] Les erreurs sont gérées proprement.

---

Fichiers modifiés et impact :

Endpoints impactés :

Tables DB impactées :

Owner Boutique concerné si applicable :
