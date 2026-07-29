Q : Où en est le chantier reprise Air Shipped / Livraison Express ?
R : Clos côté code. §8, §9 et §1.4 livrés et vérifiés. Un seul point reste ouvert — une décision business (ETA par rail), pas un bug.

============================================================
STATUT FINAL
============================================================

§8 — Transport dans le total commande                                 ✅ FAIT
  services/transport-pricing.js (nouveau)
  migrations/118_transport_pricing.sql (nouveau)
  routes/orders/create.js (modifié)
  Devis commercial (price_kmf) par ligne, agrégé sur la commande,
  persisté dans orders.transport_price_kmf. Plus aucun rail codé en dur
  (SEA_STANDARD dérivé de listCommercialTransportRails()). AIR_EXPRESS
  reste bloqué tant que pricing_status != ACTIVE (doctrine transport-rails).
  Tests : 14/14 (transport-pricing.test.js) + 29/29 (orders-create-route,
  3 assertions recalculées avec fret ajouté).

§9 — price_kmf / eta_label dans la fiche produit (buildDeliveryOptions) ✅ FAIT (price_kmf)
                                                                        ⛔ BLOQUÉ (eta_label — business)
  services/catalog-product-detail.js (modifié)
  price_kmf réel via quoteTransportPriceForItem() (quantity=1, poids/volume
  produit), mêmes business_rules que §8. Retombe honnêtement à null si
  poids absent ou tarif manquant — ne casse jamais la fiche produit.
  eta_label reste null : aucune table ne relie un délai à SEA_STANDARD/
  AIR_EXPRESS. La table carriers existe mais c'est un seed d'exemple
  générique (Dubai→Moroni), sans FK vers les rails, explicitement marqué
  "à adapter avant la mise en prod" dans sa propre migration (065).
  Aucune donnée inventée pour combler ce gap — cf. doctrine "zéro donnée
  inventée".
  Tests : 17/17 (catalog-product-detail.test.js, +1 nouveau test prix réel).

§1.4 — Sélecteur mobile AIR non-fonctionnel                            ✅ FAIT
  public/boutique/js/b-modal-mobile-product.js (modifié)
  public/boutique/css/modal-mobile-canonical.css (modifié, rebundlé)
  Les chips livraison mobile deviennent de vrais boutons radio
  (role="radio", aria-checked) quand plusieurs options sont disponibles —
  clic → state.modalDeliverySelection, miroir exact du sélecteur desktop
  (k-dsel-wrap). Les options indisponibles restent affichées en info seule
  (comportement mobile préexistant, préservé).
  Tests : 13/13 (shipping-mode-pill.test.js, +3 nouveaux) + 4/4
  (b-modal-mobile-product-pdc6-coverage.test.js, mock b-store étendu).

============================================================
CE QUI RESTE OUVERT (hors périmètre code)
============================================================

ETA par rail — décision business requise avant de pouvoir câbler
eta_label. Deux options pour la trancher :
  a) Ajouter des clés business_rules dédiées (ex.
     SEA_STANDARD_TRANSIT_DAYS / AIR_EXPRESS_TRANSIT_DAYS), même pattern
     que SEA_KMF_PER_KG_COMMERCIAL (migration 118) : valeur par défaut
     explicitement marquée "à recalibrer", ajustable ensuite via
     l'interface admin.
  b) Lier la table carriers existante aux rails commerciaux via une FK
     réelle, si un mapping carrier ↔ rail a un sens métier (aujourd'hui
     carriers.type est libre-texte 'maritime'/'aerien'/'mixte', sans lien
     structurel avec TRANSPORT_RAILS).
Tant qu'aucune des deux n'est tranchée, eta_label reste null partout
(fiche produit ET sélecteur, desktop ET mobile) — comportement honnête,
pas un bug à corriger.

============================================================
INCIDENT DE PARCOURS (corrigé, pour mémoire)
============================================================

Un header @db-read mal formaté dans catalog-product-detail.js
(annotation inline "(via utils/rules.js)" au lieu d'un nom de table plat)
a fait échouer scripts/arch-schema-drift-check.js en fiction hors-liste.
Corrigé : liste plate `business_rules, catalog_media, ...` — convention
déjà utilisée dans hub-operations.js / sourcing-analysis.js. Gate
revérifié : 0 fiction hors-liste, 0 drift bloquant.

============================================================
VALIDATION GLOBALE (conteneur, ce lot)
============================================================

Backend  : npm test → 6278/6337 (24 échecs = ECONNREFUSED Postgres +
           JWT_SECRET absent du sandbox, aucun lien avec ce chantier).
Boutique : npx jest tests/unit → 1885/1885.
Gates    : catalog-contract-gate (36/36), feature-guard (0 erreur,
           5 avertissements pré-existants sans rapport), css-guard
           (110 conflits = baseline, aucun nouveau), boutique-ownership-
           full-check (88%, aucun fichier touché dans les 14 non
           rattachés), arch-schema-drift-check (0 fiction hors-liste).

Aucun commit/push effectué — livré en zip, comme d'habitude.
