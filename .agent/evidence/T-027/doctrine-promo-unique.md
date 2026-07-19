# T-027 — Doctrine unique : coral réservé à la promotion active (D-P3)

## Règle

`var(--coral)` et tokens dérivés (`--coral-dark`, `--border-coral-*`, `--coral-focus-*`,
`--coral-shadow-*`, etc.) ne doivent apparaître dans les fichiers PDP (`modal-shell.css`,
`modal-media.css`, `modal-product.css`, `modal-product-lot4-hybrid.css`,
`modal-mobile-canonical.css`, `modal-enriched-content.css`) que dans deux cas :

1. Le prix produit quand `.k-modal--has-promo` est posée (promo active réelle) — `k-modal-price` / `k-modal-price-unit`.
2. Le badge promo dédié — `.k-modal-promo-badge`.

Toute autre occurrence (focus, hover, état sélectionné persistant, texte statique, badge
non conditionnel) doit utiliser un token neutre :

- **Focus** (`:focus`, `:focus-within`) → `var(--accent-blue)` (nouveau token additif,
  alias `var(--blue-dark)`, aucune définition existante modifiée). Conforme au critère
  d'acceptation T-027 et à la spec `CHANTIER_PDP_MAQUETTE_PREMIUM_ORIGINAL.md` qui
  nomme ce token sans lui donner de valeur — la valeur a été dérivée des tokens bleus déjà
  en place plutôt que d'introduire une couleur brute inédite.
- **Hover / `:active` (interaction transitoire)** → `var(--ocean)` (ou son équivalent
  alpha existant, ex. `--border-ocean-18`, `--border-ocean-50`), cohérent avec la
  convention déjà en place ailleurs dans ces mêmes fichiers (`.k-modal-add-cart-btn:hover`).
- **État sélectionné persistant** (swatch couleur, variante prix, taille, onglet actif) →
  `var(--text)`. Ce choix reprend une décision déjà actée côté mobile
  (`modal-mobile-canonical.css`, commentaires M2/M3 : "état sélectionné neutre, jamais
  coral — le coral reste réservé à la promo active, D-P3"). Le desktop/partagé
  (`modal-product.css` : `.k-sku--active`, `.k-vp--active`, `.k-vs-trigger-val.is-set`,
  `.k-sg-tab.is-active`) était en retard sur cette doctrine ; T-027 l'aligne.
- **Texte/badge statique sans état** (sous-total, prix topbar persistant, icône
  back-to-top, colonne de tableau) → `var(--text)`.

## Exception documentée en plus des deux forbidden_files

`.k-topbar-price-promo` (modal-shell.css) n'est pas listé dans `forbidden_files` du
task mais fonctionne exactement comme `.k-modal-promo-badge` : masqué par `u-hidden`
et affiché seulement si `promo_pct > 0` (`b-modal-product.js`, confirmé dans le bundle
dist). Conservé coral par cohérence avec la doctrine, documenté en commentaire dans le
CSS.

## Bloc legacy neutralisé — non touché volontairement

`#k-modal-aed-price`, `.k-modal-eur-ref`, `.k-modal-aed-pct`, `#k-modal-flash-bar` et ses
enfants (`modal-product.css` ~L909-976) restent coral. Ces conteneurs sont vidés par JS
(`innerHTML = ''`) à chaque rendu (`_t()` / `Pt()` dans le bundle), donc jamais
visuellement rendus dans l'état actuel — le commentaire source indique explicitement
"PDC-6 supprimera leur code legacy". Toucher du code en cours de suppression ajoute du
risque de diff sans bénéfice visuel ; laissé en l'état, à traiter par PDC-6.

## Hors périmètre (autre feature, non touché)

- `.k-msearch-*` (recherche interne, `b-modal-core.js`)
- `.k-sug-*` (suggestions/curation, `b-modal-suggestions.js`)
- `.k-modal-recent-price` (carrousel "vu récemment", confirmé live dans le bundle dist —
  feature distincte, même traitement que les suggestions)

Ces trois familles utilisent coral pour leur propre mise en avant de prix, indépendante
de la doctrine PDP D-P3.

## Point d'arbitrage — non résolu unilatéralement

`.k-modal-meta-rank` (badge "Bestseller") apparaît dans **deux fichiers** :
`modal-shell.css` (desktop, tokens fonctionnels `--border-coral-09` / `--coral` /
`--border-coral-22`) et `modal-product.css` (partagé/mobile, `--coral` fonctionne mais
`--coral-bg` / `--coral-border` sont des tokens **inexistants** — confirmé absents de
`tokens.css`).

Le commentaire en place dans `modal-shell.css` indique une décision produit antérieure
explicite : *"Le rang Bestseller garde sa pastille coral pleine"*. Cela contredit
directement l'objectif T-027 ("supprimer tout coral hors promo"), et rien dans
`forbidden_files` ne protège ce sélecteur. Non modifié, laissé pour décision humaine.

**Options :**
1. Conserver coral (respecter la décision antérieure documentée) — nécessite d'ajouter
   `k-modal-meta-rank` à `forbidden_files` du prochain lot, et de corriger au passage les
   tokens cassés `--coral-bg`/`--coral-border` dans `modal-product.css` vers les tokens
   réels `--border-coral-09`/`--border-coral-22`.
2. Purger vers un badge neutre ou vers `--accent-orange`/`--orange` existant (évoqué dans
   la spec pour un futur "badge HOT" jamais implémenté), pour appliquer strictement D-P3.

**Recommandation :** option 1 — c'est une décision produit déjà prise et documentée,
pas une régression à corriger ; mais elle mérite une confirmation explicite avant d'être
gravée dans `forbidden_files`.
