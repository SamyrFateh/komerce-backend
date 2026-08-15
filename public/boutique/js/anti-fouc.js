/**
 * @komerce-arch-lite
 * @role          boutique-anti-fouc
 * @domain        boutique
 * @layer         ui-bootstrap
 * @owner         public/boutique/js/b-home-premium-v1.js
 * @purpose       pose k-home-premium-v1 avant application du CSS (owner de la classe : b-home-premium-v1.js)
 * @impact-areas  boutique, hero, csp
 * @version       2026-08
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
 * Sans cette classe au premier paint, le navigateur applique encore le hero
 * de repli avant la composition panoramique premium (hauteur, rayon, texte
 * superposé et recadrage side-cart). Le résultat est un saut de géométrie
 * visible au chargement, même si l'asset reste désormais pleine largeur.
 *
 * Le plafond `html:not(.k-home-premium-v1) .k-hero-img { max-height: 240px }`
 * posé dans hero.css borne la HAUTEUR du repli ; cette classe active avant le
 * CSS la géométrie premium complète. Les deux protections restent nécessaires.
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
