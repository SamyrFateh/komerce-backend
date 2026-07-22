# Prompt d'exécution — refacto modale produit (pour Claude Sonnet)

> Copier le bloc ci-dessous comme instruction à Sonnet. Les gates existent déjà.
> **Point zéro (baseline) : ownership = 5 violations · layout = 0 · à confirmer par un run.**

```
RÔLE
Tu es l'agent d'exécution du refacto de la modale produit de Komerce (public/boutique).
Tu mets en œuvre une architecture déjà décidée et documentée. Tu N'inventes PAS de
direction : tu implémentes ce qui est spécifié, tu fais passer les oracles, et tu ne
te déclares PAS « terminé » — la validation finale est réservée à un second passage.

TROIS SOURCES DE VÉRITÉ (lis les trois avant d'écrire une ligne)
1. RUNBOOK : public/boutique/HANDOFF_MODALE_PROPRIETE_UNIQUE.md
   → contrats, ownership, séquence des chantiers, machine à états, oracles. C'est LE plan.
2. RÉFÉRENCE VISUELLE :
   - docs/reference/reference-modale-architecture.html → LE MODÈLE de layout
     (un seul conteneur qui scrolle + CTA sticky, densité-robuste).
   - docs/reference/reference-modale-4-etats.html → détail des 4 états.
3. GATES (garde-fous exécutables, déjà en place) :
   - scripts/audit-modal-ownership.js + modal-ownership.contract.json
   - scripts/audit-modal-layout.js    + modal-layout.contract.json

ORACLES NON NÉGOCIABLES (aucun chantier fini tant qu'ils ne sont pas verts)
  cd public/boutique
  npm run audit:modal-ownership   → exit 0  (baseline : 5 violations à clore)
  npm run audit:modal-layout      → exit 0  (baseline : déjà vert — NE PAS le casser)
  npm run test:unit               → 0 échec (inclut modal-layout-invariant.test.js)
Lance-les après CHAQUE étape. Commit par étape. Colle la sortie + le compte restant.
Si un test casse, tu répares AVANT de continuer.

RÈGLES DURES (violer = régression)
A. La maquette est une INTENTION, pas du code. NE recopie JAMAIS ses hauteurs en px.
   Traduis : hero relatif (vh + min/max px bornés), un seul conteneur qui scrolle, CTA
   sticky. Toute height:Npx sur une zone de flux fait échouer audit:modal-layout.
B. Une zone DOM = un seul owner. Pour lever une violation : déplace l'écriture chez
   l'owner, ou ajoute au `allow` UNIQUEMENT si co-écriture intentionnelle ET documentée.
   Jamais d'`allow` de confort.
C. Données depuis le contrat détail / view-model partagé, jamais en dur. swatch = image
   de variante (media du SKU) ; pill livraison = delivery.mode ("air"|"sea", défaut
   "sea") ; stock = modèle de sélection ; prix idem.
D. Réassurance, partage ET suggestions TOUJOURS montés — jamais conditionnés à
   hasEnrichedContent. Suggestions du non-enrichi = cross-sell (autres produits).
E. Variantes en flex-wrap : peu → 1 ligne, beaucoup (22 coloris) → plusieurs lignes qui
   participent au scroll. Jamais de cadre à hauteur fixe qui tronque.
F. Bouton panier ↔ stepper : qté 0 = « Ajouter au panier » ; après ajout = stepper
   − N + ; retour à 0 via − = removeFromCart PUIS le bouton réapparaît. Un seul contrôle
   affiché à la fois.
G. NE PAS rejouer le correctif viewport (manche 0) sans son lot de tests (handoff §4).
   NE PAS supprimer un module à l'aveugle : morts = tests + manifestes (handoff §5).

SÉQUENCE (chaque étape : implémente → 3 oracles → commit)
1. Chantier Desktop (handoff §2) : clore les 5 violations d'ownership restantes
   (k-modal-variants, k-sug-rail, k-add-cart-btn, k-buy-now-btn, k-qty-val).
2. Chantier Déduplication (handoff §3) : converger le DOM scalaire des renderers dans
   b-modal-product-fields.js ; vider le `allow` scalaire. NE fusionne PAS ce qui est
   légitimement différent (pill stock vs texte, below-fold vs panel) — état déjà partagé.
3. Chantier UI (handoff §6) :
   3a. Passer la modale au modèle densité-robuste (réf. architecture.html) : conteneur
       scroll + CTA sticky compact (Ajouter primaire / Acheter secondaire, une rangée),
       hauteurs relatives. Supprimer toute logique de fold-fitting.
   3b. Ordre des blocs : image → titre → prix → pill livraison → couleur → taille →
       suggestions. Couleur+taille sous le prix (immédiateté en faible densité).
   3c. shipping_mode : champ delivery.mode + pill sous le prix (air = accent bleu, sea =
       neutre). Owner = k-modal-delivery. Supprimer l'ancienne ligne livraison en bas.
   3d. Suggestions : rail présent sur les 4 états ; une demi-rangée affleure sous le CTA
       sticky en faible densité (teasing cross-sell).
4. Garantie déjà en place : le test tests/unit/modal-layout-invariant.test.js et le gate
   audit:modal-layout doivent rester verts. Ajoute les oracles UI du handoff §6.3
   (shipping_mode air/sea + fallback ; cycle bouton↔stepper avec removeFromCart).

INTERDITS
- Ne te déclare pas « terminé » sans les 3 oracles verts + violations à 0.
- Ne recopie pas les px de la maquette. Pas de height fixe sur les zones de flux.
- Ne conditionne pas réassurance/partage/suggestions à l'enrichissement.
- Pas d'`allow` de complaisance pour faire taire un gate.

LIVRABLE
Un commit par étape avec : le diff, la sortie des 3 oracles, le compte restant. À la fin :
ownership = 0, layout = 0, test:unit vert. Laisse l'analyse finale au second passage.
```
