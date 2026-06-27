## Checklist avant merge

Aucune PR ne doit être mergée sans avoir coché les points applicables.

---

### Gouvernance carte-first

> Ces champs sont **obligatoires**. Ils sont les deux checkpoints humains que
> les gates CI ne peuvent pas remplacer.

**Feature(s) concernée(s) :**
<!-- Nom exact du manifest : orders, payments, logistics, etc. -->
<!-- Si transversal : indiquer le périmètre (ex: middleware/auth) -->

**Opération CRUD :**
- [ ] Create — nouveau fichier / route / comportement
- [ ] Read — lecture seule, refactoring interne sans changement d'interface
- [ ] Update — modification de comportement existant
- [ ] Delete / Archive / Deprecate

**Checkpoint A — L'intention de la feature change-t-elle ?**
- [ ] Non — la carte n'est pas modifiée
- [ ] Oui — carte `features/<feature>.feature.js` mise à jour dans cette PR
- [ ] Incertain — revue humaine obligatoire (ne pas merger sans validation)

**Checkpoint B — Un document est-il archivé ou renommé ?**
- [ ] Non applicable
- [ ] Oui — confirmé vivant (listé dans `docs/README.md`)
- [ ] Oui — déplacé vers `docs/_archive/` (était historique)
- [ ] Ambigu — classé `À REVOIR` dans `docs/chantier/STATUS.md`

**Générateurs relancés :**
- [ ] `npm run arch:gen` (si fichiers source touchés)
- [ ] `npm run dashboards:360` (si dashboards touchés)
- [ ] `npm run boutique:360` (si boutique touchée)
- [ ] `npm run meta:graph` (si structure globale change)
- [ ] Non applicable

**Vérification finale :**
- [ ] `npm run map:check` vert ✔

---

### Documentation lue

- [ ] J'ai consulté `docs/README.md` avant de coder.
- [ ] J'ai lu la carte `features/<feature>.feature.js` de la feature concernée.
- [ ] J'ai consulté `docs/CARTOGRAPHY_360.md` si routes, domaines ou tables changent.
- [ ] J'ai consulté `docs/ZONE_IMPACT.md` si commande, paiement, wallet, colis, statut, scan ou pricing changent.
- [ ] J'ai consulté `public/boutique/README.md` si la PR touche la Boutique.

---

### Si modification Boutique

- [ ] Les fichiers touchés sont listés ci-dessous.
- [ ] L'owner du composant est identifié.
- [ ] Le fichier modifié est bien propriétaire du problème traité.
- [ ] Aucune seconde source de vérité n'a été créée.
- [ ] Le mobile pager n'est pas cassé.
- [ ] Le desktop n'a pas reçu de hack mobile.
- [ ] Le rail catégories reste piloté par shop-schema.js → render-categories.js → home-controller.js.
- [ ] Les cartes produit restent pilotées par render-product-card.js.
- [ ] Aucune règle `.k-chip` / `.k-cats` n'a été ajoutée hors owner.
- [ ] Aucune règle `.k-grid` / `.k-card` de base n'a été dupliquée hors products.css.

---

### Sécurité

- [ ] Pas de secrets en dur dans le code.
- [ ] Les requêtes SQL sont paramétrées.
- [ ] Les routes sensibles ont `authenticate` + `requireRole` lorsque nécessaire.
- [ ] Les entrées utilisateur sont validées.

---

### Qualité

- [ ] Le code a été testé localement ou la raison de non-test est expliquée ci-dessous.
- [ ] Pas de `console.log` de debug restant.
- [ ] Les erreurs sont gérées proprement.

---

**Feature(s) et opération :**

**Fichiers modifiés et impact :**

**Endpoints impactés :**

**Tables DB impactées :**

**Raison de non-test si applicable :**

**Éléments "À REVOIR" identifiés :**
