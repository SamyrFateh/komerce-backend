# PDP Komerce — doctrine de densité

Statut : **VERROUILLÉ — 2026-08**

## Principe

**Compression ≠ miniaturisation.**

On élimine l'air mort avant de réduire les éléments utiles.
Chaque pixel placé avant les variantes mobile doit servir la décision d'achat.

## Mobile — ordre canonique

```text
TOPBAR
MEDIA / HERO
IDENTITÉ
  Titre ≤ 2 lignes
  Référence = 1 ligne immédiatement dessous
  Prix
RÉASSURANCE
VARIANTES
  Couleur
  Taille
  autres axes
LIVRAISON
CONTENU
  short_description = 1 ligne
  description complète
  contenu enrichi
  suggestions
CTA STICKY
```

### Invariants mobile

- Hero compact et proportionné : **16:9**.
- Référence sur une seule ligne immédiatement sous le titre.
- Favori hors flux du titre.
- Réassurance générale avant variantes.
- WA / Lien restent techniquement montés mais sont masqués dans le coeur transactionnel mobile.
- Toutes les variantes précèdent la livraison.
- Variantes indisponibles visibles mais désactivées.
- Variante photo cible : ~58 px.
- Pills texte : ~36 px minimum.
- Livraison compacte et secondaire.
- short_description sous le transactionnel, une seule ligne.
- Ellipsis = garde-fou, pas méthode normale de rédaction.
- Description complète et contenu enrichi restent sous le coeur transactionnel.

## Desktop — ordre canonique

```text
MEDIA | BUYBOX

        Titre
        Référence
        Prix
        short_description
        Variantes
        Livraison
        CTA
        Trust / partage

SUGGESTIONS pleine largeur
DESCRIPTION / CONTENU ENRICHI
```

### Invariants desktop

- short_description reste dans la BuyBox et demeure compacte.
- Suggestions jamais dans le rail droit.
- Description complète sous la zone transactionnelle.
- Tous les axes produit restent visibles.
- BuyBox compacte ; média dominant sans écraser le transactionnel.

## Anti-régression

Ne pas réintroduire :

- livraison avant variantes ;
- gros messages génériques « Choisissez vos options » ;
- grosses cartes de livraison ;
- padding décoratif important avant Couleur ;
- partage WA/Lien dans le coeur transactionnel mobile ;
- référence éloignée du titre ;
- favori dictant la hauteur du titre ;
- variantes photo microscopiques ;
- description longue au-dessus des variantes.

## Doctrine

**Mobile**

> MEDIA → IDENTITÉ/PRIX → CONFIANCE → VARIANTES → LIVRAISON → CONTENU.

**Desktop**

> MEDIA | IDENTITÉ/PRIX → MICRO-PROMESSE → VARIANTES → LIVRAISON → ACTION.

La place gagnée sert d'abord à faire apparaître les variantes plus tôt.
