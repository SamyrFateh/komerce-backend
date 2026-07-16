/**
 * Fixture du contrat Product Detail v1 pour le Golden Product
 * 'Chaussure de football Elite Pro' (GOLDEN-ELITE-PRO).
 *
 * PROVENANCE — ne pas modifier à la main :
 *   Ce JSON est la sortie réelle et déjà validée (Ajv, schema v1) de
 *   services/catalog-product-detail.js::getProductDetail() appelé avec
 *   les lignes de tests/fixtures/catalog/golden-elite-pro.js (racine du
 *   repo). Une seule source de vérité produit : si le fixture racine
 *   change, régénérer ce fichier avec le même service plutôt que
 *   d'éditer les valeurs ci-dessous à la main (doctrine : un seul
 *   produit métier, zéro divergence entre backend et tests front).
 *
 * Utilisé par : tests/unit/golden-product-selection-gpm3.test.js
 * pour verrouiller modal-selection-model.js (front-end pur, sans DOM ni
 * fetch) sur les 6 scénarios du chantier GPM.
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
    "subcategory": "chaussures-football"
  },
  "pricing": {
    "price_kmf": 42000,
    "old_price_kmf": null,
    "promo_pct": null
  },
  "media": [
    {
      "id": "product-1",
      "url": "https://cdn.example.com/golden-elite-pro/neutral-main.jpg",
      "role": "PRODUCT",
      "alt": "Chaussure de football Elite Pro",
      "option_values": {}
    },
    {
      "id": "variant-1-1",
      "url": "https://cdn.example.com/golden-elite-pro/bleu-main.jpg",
      "role": "PRODUCT",
      "alt": "Chaussure de football Elite Pro",
      "option_values": {
        "Couleur": "Bleu"
      }
    },
    {
      "id": "variant-1-3",
      "url": "https://cdn.example.com/golden-elite-pro/bleu-scene.jpg",
      "role": "PRODUCT",
      "alt": "Chaussure de football Elite Pro",
      "option_values": {
        "Couleur": "Bleu"
      }
    },
    {
      "id": "variant-2-1",
      "url": "https://cdn.example.com/golden-elite-pro/noir-main.jpg",
      "role": "PRODUCT",
      "alt": "Chaussure de football Elite Pro",
      "option_values": {
        "Couleur": "Noir"
      }
    },
    {
      "id": "variant-2-3",
      "url": "https://cdn.example.com/golden-elite-pro/noir-scene.jpg",
      "role": "PRODUCT",
      "alt": "Chaussure de football Elite Pro",
      "option_values": {
        "Couleur": "Noir"
      }
    }
  ],
  "option_axes": [
    {
      "key": "Couleur",
      "display_name": "Couleur",
      "values": [
        {
          "value": "Bleu",
          "thumbnail_url": "https://cdn.example.com/golden-elite-pro/bleu-main.jpg"
        },
        {
          "value": "Noir",
          "thumbnail_url": "https://cdn.example.com/golden-elite-pro/noir-main.jpg"
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
        "variant-1-1",
        "variant-1-3"
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
        "variant-1-1",
        "variant-1-3"
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
        "variant-1-1",
        "variant-1-3"
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
        "variant-2-1",
        "variant-2-3"
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
        "variant-2-1",
        "variant-2-3"
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
  ]
};
