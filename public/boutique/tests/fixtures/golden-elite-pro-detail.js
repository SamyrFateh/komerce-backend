/**
 * Fixture du contrat Product Detail v1 pour le Golden Product
 * 'Chaussure de football Elite Pro' (GOLDEN-ELITE-PRO).
 *
 * PROVENANCE — ne pas modifier à la main :
 *   Ce JSON est la sortie réelle et déjà validée (Ajv, schema v1) de
 *   services/catalog-product-detail.js::getProductDetail() appelé avec
 *   les lignes de tests/fixtures/catalog/golden-elite-pro.js (racine du
 *   repo), y compris désormais le contenu enrichi promu (Lot Content,
 *   commit 5 : golden.contentContract() → mappers purs de
 *   services/catalog-promotion/content.js → buildContent()). Une seule
 *   source de vérité produit : si le fixture racine change, régénérer
 *   ce fichier avec le même service plutôt que d'éditer les valeurs
 *   ci-dessous à la main (doctrine : un seul produit métier, zéro
 *   divergence entre backend et tests front).
 *
 * Utilisé par : tests/unit/golden-product-selection-gpm3.test.js
 * (front-end pur, sans DOM ni fetch) et, depuis le Lot Content commit 5,
 * par tests/unit/golden-product-content-render.test.js pour verrouiller
 * le rendu mobile/desktop du contenu enrichi réel.
 */
'use strict';

module.exports = {
  "contract_version": "1",
  "inventory_model": "SKU",
  "product": {
    "id": "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa0001",
    "reference": "GOLDEN-ELITE-PRO",
    "name": "Chaussure de football Elite Pro",
    "description": "Chaussure de football haute performance pour terrain synthétique, tige textile renforcée, semelle multi-crampons et maintien ajusté.",
    "category": "sport",
    "subcategory": "chaussures-football",
    "series": "Golden Performance Series"
  },
  "pricing": {
    "price_kmf": 42000,
    "old_price_kmf": null,
    "promo_pct": null
  },
  "media": [
    {
      "id": "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2001",
      "url": "/images/products/golden-elite-pro/neutral-main.svg",
      "role": "PRODUCT",
      "alt": "Chaussure de football Elite Pro",
      "option_values": {}
    },
    {
      "id": "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2002",
      "url": "/images/products/golden-elite-pro/bleu-main.svg",
      "role": "PRODUCT",
      "alt": "Elite Pro Bleu",
      "option_values": {
        "Couleur": "Bleu"
      }
    },
    {
      "id": "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2003",
      "url": "/images/products/golden-elite-pro/bleu-scene.svg",
      "role": "SCENE",
      "alt": "Elite Pro Bleu en situation",
      "option_values": {
        "Couleur": "Bleu"
      }
    },
    {
      "id": "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2004",
      "url": "/images/products/golden-elite-pro/bleu-detail-semelle.svg",
      "role": "DETAIL",
      "alt": "Détail semelle Elite Pro Bleu",
      "option_values": {
        "Couleur": "Bleu"
      }
    },
    {
      "id": "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2005",
      "url": "/images/products/golden-elite-pro/noir-main.svg",
      "role": "PRODUCT",
      "alt": "Elite Pro Noir",
      "option_values": {
        "Couleur": "Noir"
      }
    },
    {
      "id": "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2006",
      "url": "/images/products/golden-elite-pro/noir-scene.svg",
      "role": "SCENE",
      "alt": "Elite Pro Noir en situation",
      "option_values": {
        "Couleur": "Noir"
      }
    },
    {
      "id": "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2007",
      "url": "/images/products/golden-elite-pro/size-guide.svg",
      "role": "SIZE_GUIDE",
      "alt": "Guide des tailles Elite Pro",
      "option_values": {}
    }
  ],
  "option_axes": [
    {
      "key": "Couleur",
      "display_name": "Couleur",
      "values": [
        {
          "value": "Bleu",
          "thumbnail_url": "/images/products/golden-elite-pro/bleu-main.svg"
        },
        {
          "value": "Noir",
          "thumbnail_url": "/images/products/golden-elite-pro/noir-main.svg"
        }
      ]
    },
    {
      "key": "Taille",
      "display_name": "Taille",
      "values": [
        {
          "value": "42",
          "thumbnail_url": null
        },
        {
          "value": "43",
          "thumbnail_url": null
        },
        {
          "value": "44",
          "thumbnail_url": null
        }
      ]
    }
  ],
  "sellable_units": [
    {
      "sku_id": "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa1042",
      "sku": "GOLD-BLU-42",
      "option_values": {
        "Couleur": "Bleu",
        "Taille": "42"
      },
      "stock_status": "AVAILABLE",
      "available_quantity": 8,
      "price_kmf": 42000,
      "media_ids": [
        "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2002",
        "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2003",
        "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2004"
      ]
    },
    {
      "sku_id": "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa1043",
      "sku": "GOLD-BLU-43",
      "option_values": {
        "Couleur": "Bleu",
        "Taille": "43"
      },
      "stock_status": "OUT_OF_STOCK",
      "available_quantity": 0,
      "price_kmf": 42000,
      "media_ids": [
        "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2002",
        "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2003",
        "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2004"
      ]
    },
    {
      "sku_id": "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa1044",
      "sku": "GOLD-BLU-44",
      "option_values": {
        "Couleur": "Bleu",
        "Taille": "44"
      },
      "stock_status": "AVAILABLE",
      "available_quantity": 5,
      "price_kmf": 45000,
      "media_ids": [
        "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2004"
      ]
    },
    {
      "sku_id": "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa1142",
      "sku": "GOLD-BLK-42",
      "option_values": {
        "Couleur": "Noir",
        "Taille": "42"
      },
      "stock_status": "AVAILABLE",
      "available_quantity": 4,
      "price_kmf": 42000,
      "media_ids": [
        "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2005",
        "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2006"
      ]
    },
    {
      "sku_id": "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa1143",
      "sku": "GOLD-BLK-43",
      "option_values": {
        "Couleur": "Noir",
        "Taille": "43"
      },
      "stock_status": "AVAILABLE",
      "available_quantity": 3,
      "price_kmf": 43000,
      "media_ids": [
        "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2005",
        "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaa2006"
      ]
    }
  ],
  "delivery_options": [
    {
      "code": "SEA_STANDARD",
      "label": "Livraison standard",
      "available": true,
      "price_kmf": null,
      "eta_label": null,
      "unavailable_reason": null
    }
  ],
  "content": {
    "brand": "Elite Pro",
    "short_description": "Chaussure de football terrain synthétique, maintien ajusté.",
    "highlights": [
      {
        "key": "h1",
        "label": "Semelle multi-crampons adhérence optimale sur synthétique"
      },
      {
        "key": "h2",
        "label": "Tige textile renforcée résistante à l’abrasion"
      },
      {
        "key": "h3",
        "label": "Maintien ajusté sans point de pression"
      },
      {
        "key": "h4",
        "label": "Doublure respirante anti-transpiration"
      }
    ],
    "specifications": [
      {
        "group": "Semelle",
        "key": "type-semelle",
        "label": "Type",
        "value": "Crampons FG multi-directionnels",
        "unit": null,
        "display_order": 0
      },
      {
        "group": "Semelle",
        "key": "matiere-semelle",
        "label": "Matière",
        "value": "TPU injecté",
        "unit": null,
        "display_order": 1
      },
      {
        "group": "Tige",
        "key": "matiere-tige",
        "label": "Matière",
        "value": "Textile technique renforcé",
        "unit": null,
        "display_order": 2
      },
      {
        "group": "Tige",
        "key": "fermeture",
        "label": "Fermeture",
        "value": "Lacets classiques",
        "unit": null,
        "display_order": 3
      },
      {
        "group": "Général",
        "key": "poids",
        "label": "Poids (paire, taille 42)",
        "value": "420",
        "unit": "g",
        "display_order": 4
      },
      {
        "group": "Général",
        "key": "terrain",
        "label": "Terrain recommandé",
        "value": "Synthétique (SG/AG)",
        "unit": null,
        "display_order": 5
      }
    ],
    "sections": [
      {
        "key": "size-guide",
        "title": "Guide des tailles",
        "type": "KEY_VALUE",
        "text": null,
        "items": [],
        "entries": [
          {
            "label": "42",
            "value": "EU 42 / UK 8"
          },
          {
            "label": "43",
            "value": "EU 43 / UK 9"
          },
          {
            "label": "44",
            "value": "EU 44 / UK 9.5"
          }
        ],
        "display_order": 0
      }
    ],
    "materials": [
      "Tige textile technique renforcée",
      "Semelle TPU injecté",
      "Doublure respirante"
    ],
    "care": [
      "Nettoyer avec un chiffon humide après usage",
      "Ne pas laver en machine",
      "Laisser sécher à l’air libre, loin d’une source de chaleur directe"
    ],
    "warnings": [
      "Ne convient pas à un usage sur terrain naturel ou stabilisé (crampons non adaptés)"
    ],
    "provenance": {
      "source": "SUPPLIER",
      "enrichment_version": null,
      "reviewed": false
    }
  }
};
