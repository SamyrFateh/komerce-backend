# Discovery locale — médias de démonstration (STAGING uniquement)

## Pourquoi

Les images de catégories Komerce (`cat-bricolage-v3.webp`, `cat-maison-v3.webp`, etc.) illustrent des univers **produit** ; elles ne représentent ni une intervention artisanale, ni des samboussas, ni un sac de ciment. Elles ne doivent jamais servir de substitut à une photographie de la prestation. Les offres de démonstration restent synthétiques et ne constituent aucune promesse de disponibilité, de prix ou d'intervention réelle.

Le seed `scripts/seed-discovery-staging.js` associe désormais une **photo illustrative spécifique à chaque prestation** ; chaque image reste clairement étiquetée comme « Photo illustrative · démo ». Les personnes photographiées ne sont pas les prestataires fictifs du seed et les lieux photographiés ne sont pas nécessairement Anjouan. Ne jamais importer ces médias dans une véritable fiche partenaire sans vérification éditoriale et autorisation d'usage.

## Sélection éditoriale : photographie source

| Offre / prestation staging | ID Pexels | Source et sujet exact |
|---|---:|---|
| Samboussas au bœuf | 14883752 | https://www.pexels.com/photo/food-on-brown-and-white-ceramic-plate-14883752/ — samboussas servis dans une assiette |
| Plateau de samboussas | 37068875 | https://www.pexels.com/fr-fr/photo/samoussas-fraichement-prepares-sur-plateau-traiteur-37068875/ — plateau de samoussas |
| Ciment local | 29519165 | https://www.pexels.com/photo/stack-of-cement-bags-in-warehouse-setting-29519165/ — sacs de ciment entreposés |
| Maçonnerie | 10383579 | https://www.pexels.com/photo/worker-on-construction-site-10383579/ — maçon appliquant du ciment |
| Plomberie | 32588548 | https://www.pexels.com/photo/plumber-repairing-pipe-with-wrench-indoors-32588548/ — réparation de tuyau |
| Électricité bâtiment | 34054475 | https://www.pexels.com/photo/electrician-inspecting-a-circuit-panel-indoors-34054475/ — inspection d'un tableau électrique |
| Mécanique automobile | 11139242 | https://www.pexels.com/photo/a-man-repairing-a-car-11139242/ — mécanicien en garage |
| Menuiserie / pose de fenêtre | 5691503 | https://www.pexels.com/photo/anonymous-man-installing-window-in-room-5691503/ — pose de fenêtre |
| Livraison / manutention | 6169670 | https://www.pexels.com/photo/delivery-man-carrying-boxes-6169670/ — chargement de colis |
| Climatisation | 32588555 | https://www.pexels.com/photo/technician-performing-air-conditioning-maintenance-32588555/ — entretien d'un climatiseur |

Les URL directes des images sont construites avec l'ID et le modèle public de CDN Pexels (`https://images.pexels.com/photos/<id>/pexels-photo-<id>.jpeg`). La vérification des pages sources et du **sujet photographié** ne vaut pas test de disponibilité réseau du CDN. Avant utilisation en staging, vérifier HTTP 200, type image, dimensions réelles, cache, mobile et ratio de recadrage. Aucune image distante ne doit être considérée comme « validée en production » sur la seule base de son ID.

La fiche « Pack d’eau 6 × 1,5 L » ne reçoit volontairement **aucun visuel** : aucune photo d'un véritable pack de six bouteilles n'a été approuvée pour ce seed. Elle ne doit pas être ajoutée aux candidats Discovery tant que sa photographie et son format commercial ne sont pas vérifiés.

## Portes de sortie non négociables

1. `DISCOVERY_RAIL_ENABLED=false` en production tant que l'expérience réelle complète n'est pas prouvée. Ne pas exposer les fiches `[STAGING]` au public, y compris lorsqu'une photo de substitution a été sélectionnée.
2. Image principale de l'offre = photographie spécifique au sujet et, pour une offre **réelle**, image fournie/validée par le prestataire ou clairement marquée « Photo illustrative » ; une photo générique ne prouve ni prix, ni stock, ni identité.
3. Ne jamais fabriquer une galerie de trois miniatures en répétant `image_ref`. Le contrat actuel des tables `services` / `physical_offers` ne fournit qu'une image principale. La galerie validée sera alimentée uniquement après ajout d'une collection médias canonique (source, crédit, ordre, association provider/offer).
4. La démonstration doit vérifier : rail → détail de même `kind/ref` → photographie chargée → identité/zone/description → contact, sans panier pour Service. Vérifier desktop et mobile **dans un navigateur**, pas seulement avec des tests unitaires.
5. Dès qu'un vrai partenaire fournit ses médias, conserver un enregistrement de provenance, vérifier le droit de publication, et remplacer les illustrations fictives par ses images réelles. Ne pas attribuer les personnes ou lieux des photos de stock aux partenaires Komerce.
