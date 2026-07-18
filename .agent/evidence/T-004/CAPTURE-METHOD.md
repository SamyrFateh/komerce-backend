# T-004 — Méthode de capture

Même méthode que T-002/T-003 : harnais HTML statique temporaire (non
committé), chargeant `css/dist/base.css` + `css/dist/components.css` réels,
reconstruisant `#k-modal .k-vg[data-axis-key="taille"]` avec la structure
produite par `renderAxis()` (`.k-vg-label`, `.k-vg-sizes`, `.k-vp`,
`.k-vp--active`, `.k-vp--out`) — 5 chips pour vérifier qu'au moins quatre
tiennent à 390px sans que le sélectionné (M) et l'indisponible (L) ne soient
confondus visuellement. Capture via Playwright (Chromium), viewport 390px,
wrapper `#k-modal` uniquement.

`tests.txt` = sortie de `npm --prefix public/boutique run test:unit`
(93 suites / 1744 tests, verts, incluant les 2 nouveaux tests M3).
