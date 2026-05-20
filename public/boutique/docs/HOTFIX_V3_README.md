# HOTFIX v3 — Balise </div> manquante qui imbrique tous les modals

> Date : 2026-05-19
> **Cause racine identifiée. Bug structurel HTML.**

---

## Le vrai bug, enfin

`public/boutique/index.html` contient **une `</div>` manquante** au niveau de `#k-modal-overlay` (modal produit Temu).

Vérifié par analyse de l'arbre DOM :

```
Ouvrants <div>  : 84
Fermants </div> : 83
Différence      : +1 div jamais fermée
Stack non fermé : <div id="k-modal-overlay"> ligne 284
```

Conséquence : le navigateur, à l'auto-correction, **imbrique tous les éléments DOM qui suivent à l'intérieur de `#k-modal-overlay`** :

```
Attendu :                    Réel au runtime :
body                         body
├── #k-modal-overlay         └── #k-modal-overlay (display:none par défaut)
├── #k-cart-overlay              ├── #k-cart-overlay
├── #k-cart-drawer               ├── #k-cart-drawer
└── #k-order-modal               └── #k-order-modal
```

Quand `#k-modal-overlay` n'est pas ouvert (cas normal), il a `display:none`. **Tous ses enfants héritent et sont invisibles**, y compris le modal de commande.

## Explications des symptômes observés

| Symptôme | Pourquoi |
|---|---|
| Bouton "Commander" semblait mort | Le modal s'ouvrait correctement (classe `.open` posée, `dom.orderModal.classList.add('open')` exécuté), **mais restait invisible** parce que son parent `#k-modal-overlay` était `display:none`. |
| Pas d'erreur dans la console | Le JS s'exécutait sans crash. Comportement DOM parfaitement légal. |
| `getBoundingClientRect()` retournait 0×0 | Confirme : élément techniquement présent mais pas rendu (parent caché). |
| `getComputedStyle` retournait `position:fixed inset:0` | Confirme : le CSS du modal est correct, c'est juste le parent qui le cache. |
| Clic carte → panier bloqué | Clic carte ouvre `#k-modal-overlay` (display:flex). Du coup `#k-cart-drawer` et `#k-order-modal` deviennent **soudainement visibles à l'intérieur**, par-dessus la modale produit. Plus rien ne se ferme proprement parce que les conteneurs sont enfants l'un de l'autre. |

## Diagnostic en console (preuve)

Test fait par l'utilisateur sur la prod :

```js
const o = document.getElementById('k-order-modal');
console.log({
  parent: o.parentElement.tagName + '#' + o.parentElement.id,
  parentDisplay: getComputedStyle(o.parentElement).display
});
// → { parent: "DIV#k-modal-overlay", parentDisplay: "none" }
```

Le modal de commande a `<div id="k-modal-overlay">` comme parent avec `display:none`. **Bug structurel confirmé.**

## Le fix

Une seule modification dans `public/boutique/index.html` ligne 359 : ajouter une `</div>` fermante après celle qui ferme `<div id="k-modal" id="k-modal">`.

```diff
        <div class="k-sug-rail" id="k-sug-rail"></div>
      </div>
    </div>
  </div>
- </div>
+ </div><!-- /#k-modal — modal interne -->
+ </div><!-- /#k-modal-overlay — FIX HTML 2026-05-19 -->

  <!-- ═══ CART DRAWER ═══ -->
  <div id="k-cart-overlay" class="k-cart-overlay"></div>
```

Vérification post-fix :

```
Ouvrants <div>  : 84
Fermants </div> : 84
Équilibre       : OK
Stack final     : 0 non fermé
```

## Application

Remplacer `public/boutique/index.html` par celui livré ici (le fichier diffère de l'original d'**un seul caractère** : un `</div>` supplémentaire après la ligne 359).

## Validation post-déploiement

Après merge + redéploiement Railway :

- [ ] Hard reload (`Cmd+Shift+R`).
- [ ] Inspecter `#k-order-modal` → onglet Elements doit montrer qu'il est **enfant direct de `<body>`**, pas de `#k-modal-overlay`.
- [ ] Console : `document.getElementById('k-order-modal').parentElement.tagName` doit retourner `"BODY"` et non `"DIV"`.
- [ ] Ajouter un produit au panier → cliquer "Commander" → **le modal de commande s'affiche enfin**.
- [ ] Cliquer Escape ou la croix → modal de commande se ferme proprement.
- [ ] Cliquer une carte produit → modale produit s'ouvre **pleine page Temu** (§7 a toujours fonctionné, c'est désormais clairement visible).
- [ ] Fermer la modale produit → retour au catalogue normalement, sans état coincé.

## Note importante

Toutes les corrections JS précédentes (HOTFIX v1 et v2 : imports manquants `getScrollY`, retrait orphelin `cart-product-open.css`) restent valides et nécessaires. Ce HOTFIX v3 corrige un **3ᵉ bug indépendant** que les précédents ne touchaient pas.

**Trois bugs distincts identifiés au total** :
1. ✅ HOTFIX v1 : `b-desktop-upgrade.js` + orphelin CSS
2. ✅ HOTFIX v2 : imports `b-checkout.js` + `b-catalog-desktop-enhancers.js`
3. **HOTFIX v3** : balise `</div>` manquante dans `index.html`

## Commit

```
fix(boutique): ajouter </div> manquante qui imbriquait cart-drawer et order-modal dans modal-overlay

#k-modal-overlay (modale produit Temu) n'était jamais fermé : le navigateur
imbriquait #k-cart-overlay, #k-cart-drawer et #k-order-modal comme enfants
de #k-modal-overlay au lieu de frères de body. Quand #k-modal-overlay avait
display:none (état normal), tous les modals enfants étaient invisibles
malgré leur état logique correct (.open posée, classList valide).

Conséquences corrigées :
- Bouton "Commander" qui semblait mort (modal ouvert mais invisible)
- Panier qui se "bloquait" après ouverture d'une fiche produit (états
  superposés impossibles à fermer)

Diagnostic console :
  document.getElementById('k-order-modal').parentElement
  → <div id="k-modal-overlay" style="display:none">

Branche : fix/frontend-HOTFIX-3-html-div-balance-index
```
