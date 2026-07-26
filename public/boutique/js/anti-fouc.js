/**
 * @komerce-arch-lite
 * @role          boutique-anti-fouc
 * @domain        boutique
 * @layer         ui-bootstrap
 * @owner         public/boutique/js/b-home-premium-v1.js
 * @purpose       pose k-home-premium-v1 avant application du CSS (owner de la classe : b-home-premium-v1.js)
 * @impact-areas  boutique, hero, csp
 * @version       2026-07
 */

/**
 * anti-fouc.js — pose `k-home-premium-v1` sur <html> AVANT que le CSS ne soit appliqué.
 *
 * ── Pourquoi ce fichier existe (et pourquoi il ne doit PAS redevenir inline) ──
 * Ce code était un <script> inline dans index.html. Depuis le durcissement
 * FRESH-030 / AUD-04, la CSP de bootstrap/security.js pose
 * `script-src 'self'` SANS 'unsafe-inline' : le script était donc
 * silencieusement bloqué en production. Console observée :
 *
 *   Executing inline script violates the following Content Security Policy
 *   directive 'script-src self' … The action has been blocked.   (index):91
 *
 * Conséquence mesurée à 1440px : la classe n'étant plus posée avant le CSS,
 * `.k-hero-media` restait en `display:block` au lieu de `grid`, et l'image
 * hero s'affichait en PLEINE LARGEUR avant de rétrécir dès que
 * b-home-premium-v1.js (script externe, lui autorisé) finissait par la poser :
 *
 *   fenêtre de repli : image 1440 × 240,  hero 240px,  media=block
 *   état final       : image  648 × 224,  hero 224px,  media=grid
 *
 * → l'image faisait 2,2× sa largeur finale : c'est le « flash du hero en gros ».
 *
 * Le plafond `html:not(.k-home-premium-v1) .k-hero-img { max-height: 240px }`
 * posé dans hero.css borne la HAUTEUR (473px → 240px) mais ne peut rien contre
 * la LARGEUR, qui dépend du passage de .k-hero-media en grid. Les deux se
 * complètent : le plafond est la ceinture, ce fichier est la bretelle.
 *
 * ── Contraintes de chargement, non négociables ──
 *   1. Chargé en <script src> SYNCHRONE (jamais defer/async) dans <head>.
 *   2. Placé AVANT les <link rel=stylesheet> des bundles.
 * Sans ces deux conditions, la classe arrive après la première peinture et le
 * flash revient à l'identique.
 *
 * Gate associé : scripts/check-inline-scripts.js
 */
'use strict';

(function () {
  if (window.innerWidth >= 900) {
    document.documentElement.classList.add('k-home-premium-v1');
  }
}());
