# Référence modale desktop — Komerce juillet 2026

> Maquette validée. Toute modification structurelle doit être comparée à cette référence.
> Pendant desktop de `docs/reference/reference-modale-4-etats.html` (référence mobile — états 1 à 4, HTML/CSS fidèle au rendu réel). Les deux se corroborent : aucune ne supersède l'autre, elles couvrent chacune une largeur d'écran.

## Composition cible ≥900px

```
┌─────────────────────────────────────────────────────────────────────┐
│ Topbar : ← Retour   Catalogue › Cat › Sous-cat   ‹ N/M ›    ✕    │
├────────────────────────────────┬────────────────────┬───────────────┤
│                                │ Nom produit        │ Mon panier (N)│
│  Miniatures                    │ Réf. KPR-XXXXX     │               │
│  ┌──┐                          │ ● N en stock       │ ┌─────────┐  │
│  │  │  ┌────────────────────┐  │                    │ │ Article 1│  │
│  └──┘  │                    │  │ 1 500 KMF 1 875 −20│ │ 4 000    │  │
│  ┌──┐  │    Image produit   │  │                    │ │ − 1 +    │  │
│  │  │  │                    │  │ Description courte │ └─────────┘  │
│  └──┘  │      Badge −20%    │  │                    │ ┌─────────┐  │
│  ┌──┐  │              ♡     │  │ 🚢 Livraison pill  │ │ Article 2│  │
│  │  │  └────────────────────┘  │                    │ │ 13 000   │  │
│  └──┘                          │ Couleur · Naturel  │ │ − 2 +    │  │
│                                │ ■ ■ ■              │ └─────────┘  │
│                                │ Pointure · 38      │               │
│                                │ 36 37 [38] 39 40̶   │ ✓ Livr. incl.│
│                                │─────────────────── │               │
│                                │ 🧺 Ajouter  ⚡ Ach. │ Sous-total   │
│                                │                    │ 17 000 KMF   │
│                                │ ○ Paiement ○ Relais│ [Commander 2]│
│                                │ ○ Stock garanti    │ Voir panier  │
│                                │ Partager: WA Lien  │               │
├────────────────────────────────┴────────────────────┴───────────────┤
│ Vous aimerez aussi                                                  │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐                                       │
│ │    │ │    │ │    │ │    │                                         │
│ │    │ │    │ │    │ │    │                                         │
│ └────┘ └────┘ └────┘ └────┘                                        │
│ Nom     Nom     Nom     Nom                                        │
│ Prix  + Prix  + Prix  + Prix  +                                    │
└─────────────────────────────────────────────────────────────────────┘
```

## Principes structurels

### 3 zones

| Zone | Contenu | Owner CSS |
|---|---|---|
| Colonne gauche | Image, miniatures, badge promo, favori | `modal-media.css` |
| Colonne droite | Identité, prix, variantes, CTA, trust, partage | `modal-shell.css` (placement) + `lot4-hybrid.css` (grid) |
| Side cart | Panier visible, stepper, sous-total, commander | `boutique-desktop.css` |

### Zone basse pleine largeur

- Contenu enrichi (si disponible)
- Suggestions

### Doctrine colonne droite

- **CTA inline** dans le flux (pas sticky, pas grid-row:2)
- Livraison = **pill compacte uniquement** (mode + délai)
- Paiement = **absent** de la fiche (tunnel de commande)
- Sous-total = **absent** de la fiche
- Réassurance = 3 pills sur 1 ligne (`nowrap`)
- Partage = WhatsApp + Copier lien

### Side cart

- Visible quand la modale est ouverte (`body.modal-open .k-side-cart` n'est plus `display:none`)
- Masqué quand le drawer panier est ouvert (`body.cart-open .k-side-cart`)
- Composant existant `#k-side-cart`, pas de reconstruction

### Ce qui N'est PAS sur la fiche desktop

- Bloc "MODE DE PAIEMENT" avec tabs
- Liste détaillée des options de livraison
- Sous-total / total
- Adresse, identité récupérateur, point relais
- Mini-checkout

## Captures de référence

- `ref-desktop-enrichi-1280.png` — produit SKU enrichi
- `ref-desktop-simple-1280.png` — produit simple

## Breakpoints validés

| Largeur | Comportement |
|---|---|
| 900–1023px | 2 colonnes + side cart |
| ≥1024px | 3 pistes (thumbs 60px + média + détails 380px) + side cart |
| ≥1440px | Piste détails 420px |
| ≥1920px | max-width modale, pas d'étirement |
