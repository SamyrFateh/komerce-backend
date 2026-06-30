'use strict';

/**
 * tests/unit/csv-connector.test.js
 * Couvre services/suppliers/connectors/csv-connector.js
 *
 * Connecteur fonctionnel pur (pas de DB, pas de mock nécessaire) :
 * parseCSV → rowsToNormalized → fetchProducts (délègue à partitionValid
 * de normalized-product.js, lui aussi pur — pas mocké, comportement réel testé).
 */

const { fetchProducts, parseCSV, rowsToNormalized, DEFAULT_HEADER_ALIASES } = require('../../services/suppliers/connectors/csv-connector');

describe('parseCSV', () => {
  it('csvText vide/null/undefined → tableau vide', () => {
    expect(parseCSV('')).toEqual([]);
    expect(parseCSV(null)).toEqual([]);
    expect(parseCSV(undefined)).toEqual([]);
  });

  it('csvText non-string → tableau vide', () => {
    expect(parseCSV(42)).toEqual([]);
  });

  it('une seule ligne (headers seuls, pas de données) → tableau vide', () => {
    expect(parseCSV('name,price')).toEqual([]);
  });

  it('CSV séparé par virgules, headers anglais → mappe correctement', () => {
    const csv = 'name,price,stock\nCasque,5000,10';
    const rows = parseCSV(csv);
    expect(rows).toEqual([{ product_name: 'Casque', purchase_price: 5000, stock_available: 10 }]);
  });

  it('CSV séparé par point-virgules (auto-détection)', () => {
    const csv = 'name;price\nCasque;5000';
    const rows = parseCSV(csv);
    expect(rows).toEqual([{ product_name: 'Casque', purchase_price: 5000 }]);
  });

  it('headers français reconnus via DEFAULT_HEADER_ALIASES', () => {
    const csv = 'nom,prix_achat,categorie\nCasque,5000,Audio';
    const rows = parseCSV(csv);
    expect(rows).toEqual([{ product_name: 'Casque', purchase_price: 5000, supplier_category: 'Audio' }]);
  });

  it('headers insensibles à la casse', () => {
    const csv = 'NAME,PRICE\nCasque,5000';
    const rows = parseCSV(csv);
    expect(rows[0].product_name).toBe('Casque');
  });

  it('plusieurs lignes de données → une entrée par ligne, dans l\'ordre', () => {
    const csv = 'name,price\nA,100\nB,200\nC,300';
    const rows = parseCSV(csv);
    expect(rows.map(r => r.product_name)).toEqual(['A', 'B', 'C']);
  });

  it('ligne sans product_name → exclue du résultat', () => {
    const csv = 'name,price\n,100\nB,200';
    const rows = parseCSV(csv);
    expect(rows).toEqual([{ product_name: 'B', purchase_price: 200 }]);
  });

  it('lignes vides (blank lines) → ignorées', () => {
    const csv = 'name,price\nA,100\n\n\nB,200';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
  });

  it('valeurs entourées de guillemets → guillemets retirés', () => {
    const csv = 'name,price\n"Casque Bluetooth",5000';
    const rows = parseCSV(csv);
    expect(rows[0].product_name).toBe('Casque Bluetooth');
  });

  it('champ numérique avec virgule décimale (FR) → convertie en point', () => {
    const csv = 'name,weight\nCasque,1,5';
    // weight alias = 'weight' colonne 2 ; valeur "1,5" mais séparateur global est ",", donc
    // la colonne weight serait coupée — on teste plutôt avec un CSV ; pour isoler la virgule décimale
    const csvSemi = 'name;weight\nCasque;1,5';
    const rows = parseCSV(csvSemi);
    expect(rows[0].weight_kg).toBe(1.5);
  });

  it('champ numérique invalide → ignoré (pas ajouté à la ligne)', () => {
    const csv = 'name,price\nCasque,non-numerique';
    const rows = parseCSV(csv);
    expect(rows[0]).toEqual({ product_name: 'Casque' });
  });

  it('champ entier (stock) invalide → ignoré', () => {
    const csv = 'name,stock\nCasque,beaucoup';
    const rows = parseCSV(csv);
    expect(rows[0]).toEqual({ product_name: 'Casque' });
  });

  it('colonnes inconnues (sans alias) → ignorées silencieusement', () => {
    const csv = 'name,couleur_preferee\nCasque,bleu';
    const rows = parseCSV(csv);
    expect(rows[0]).toEqual({ product_name: 'Casque' });
  });

  it('customMapping → force le mapping même si le header ne matche pas les alias par défaut', () => {
    const csv = 'libelle,montant\nCasque,5000';
    const rows = parseCSV(csv, { product_name: 'libelle', purchase_price: 'montant' });
    expect(rows).toEqual([{ product_name: 'Casque', purchase_price: 5000 }]);
  });

  it('customMapping insensible à la casse', () => {
    const csv = 'LIBELLE\nCasque';
    const rows = parseCSV(csv, { product_name: 'libelle' });
    expect(rows[0].product_name).toBe('Casque');
  });

  it('retours chariot Windows (\\r\\n) → gérés comme \\n', () => {
    const csv = 'name,price\r\nCasque,5000\r\nEnceinte,8000';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
  });

  it('toutes les colonnes DEFAULT_HEADER_ALIASES sont mappables', () => {
    const fields = Object.keys(DEFAULT_HEADER_ALIASES);
    expect(fields).toContain('product_name');
    expect(fields).toContain('purchase_price');
    expect(fields).toContain('supplier_product_id');
    expect(fields.length).toBe(15);
  });
});

describe('rowsToNormalized', () => {
  it('rawRows null/undefined → tableau vide', () => {
    expect(rowsToNormalized(null, 'Fournisseur')).toEqual([]);
    expect(rowsToNormalized(undefined, 'Fournisseur')).toEqual([]);
  });

  it('mappe les champs simples et applique supplier_name', () => {
    const result = rowsToNormalized([{ product_name: 'Casque', purchase_price: 5000 }], 'Dragon Mart');
    expect(result[0]).toEqual(expect.objectContaining({
      supplier_name: 'Dragon Mart',
      product_name: 'Casque',
      purchase_price: 5000,
    }));
  });

  it('currency absente → défaut AED, uppercase appliqué', () => {
    const r1 = rowsToNormalized([{ product_name: 'A' }], 'F')[0];
    expect(r1.currency).toBe('AED');
    const r2 = rowsToNormalized([{ product_name: 'A', currency: 'eur' }], 'F')[0];
    expect(r2.currency).toBe('EUR');
  });

  it('champs optionnels absents → null', () => {
    const r = rowsToNormalized([{ product_name: 'A' }], 'F')[0];
    expect(r.supplier_product_id).toBeNull();
    expect(r.supplier_category).toBeNull();
    expect(r.purchase_price).toBeNull();
    expect(r.image_url).toBeNull();
    expect(r.product_url).toBeNull();
    expect(r.description).toBeNull();
    expect(r.stock_available).toBeNull();
    expect(r.min_order_qty).toBeNull();
    expect(r.supplier_delay_days).toBeNull();
    expect(r.weight_kg).toBeNull();
    expect(r.dimensions).toBeNull();
  });

  it('regroupe les dimensions (dim_l_cm/dim_w_cm/dim_h_cm) dans un sous-objet', () => {
    const r = rowsToNormalized([{ product_name: 'A', dim_l_cm: 10, dim_w_cm: 20, dim_h_cm: 30 }], 'F')[0];
    expect(r.dimensions).toEqual({ l_cm: 10, w_cm: 20, h_cm: 30 });
  });

  it('dimensions partielles (une seule fournie) → sous-objet partiel', () => {
    const r = rowsToNormalized([{ product_name: 'A', dim_l_cm: 10 }], 'F')[0];
    expect(r.dimensions).toEqual({ l_cm: 10 });
  });

  it('aucune dimension fournie → dimensions:null', () => {
    const r = rowsToNormalized([{ product_name: 'A' }], 'F')[0];
    expect(r.dimensions).toBeNull();
  });

  it('conserve raw_payload (copie de la ligne brute)', () => {
    const row = { product_name: 'A', purchase_price: 100 };
    const r = rowsToNormalized([row], 'F')[0];
    expect(r.raw_payload).toEqual(row);
    expect(r.raw_payload).not.toBe(row); // copie, pas la même référence
  });

  it('plusieurs lignes → une entrée normalisée par ligne, dans l\'ordre', () => {
    const result = rowsToNormalized([{ product_name: 'A' }, { product_name: 'B' }], 'F');
    expect(result.map(r => r.product_name)).toEqual(['A', 'B']);
  });
});

describe('fetchProducts — intégration parse + normalize + validation', () => {
  it('supplier_name manquant → throw', () => {
    expect(() => fetchProducts({ csv_text: 'name,price\nA,1' })).toThrow('supplier_name requis');
  });

  it('supplier_name vide (espaces) → throw', () => {
    expect(() => fetchProducts({ csv_text: 'name,price\nA,1', supplier_name: '   ' })).toThrow('supplier_name requis');
  });

  it('csv_text manquant → throw', () => {
    expect(() => fetchProducts({ supplier_name: 'Fournisseur' })).toThrow('csv_text requis');
  });

  it('csv_text vide → throw', () => {
    expect(() => fetchProducts({ supplier_name: 'Fournisseur', csv_text: '' })).toThrow('csv_text requis');
  });

  it('nominal → produits valides dans products, total = nombre de lignes parsées', () => {
    const result = fetchProducts({ supplier_name: 'Dragon Mart', csv_text: 'name,price\nCasque,5000\nEnceinte,8000' });
    expect(result.products).toHaveLength(2);
    expect(result.invalid).toEqual([]);
    expect(result.total).toBe(2);
    expect(result.products[0].supplier_name).toBe('Dragon Mart');
  });

  it('produit avec currency invalide → rejeté dans invalid avec ses erreurs', () => {
    const result = fetchProducts({ supplier_name: 'F', csv_text: 'name,currency\nCasque,XYZ' });
    expect(result.products).toEqual([]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors).toContain('currency doit être AED, EUR, USD ou KMF');
  });

  it('produit avec purchase_price négatif (forcé via mapping custom) → rejeté', () => {
    const result = fetchProducts({
      supplier_name: 'F',
      csv_text: 'name,price\nCasque,-100',
    });
    // parseFloat("-100") = -100, valide numériquement côté parseCSV mais rejeté par validateNormalizedProduct
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors).toContain('purchase_price doit être un nombre positif');
  });

  it('csv_mapping personnalisé propagé jusqu\'au parsing', () => {
    const result = fetchProducts({
      supplier_name: 'F',
      csv_text: 'libelle\nCasque',
      csv_mapping: { product_name: 'libelle' },
    });
    expect(result.products[0].product_name).toBe('Casque');
  });

  it('mix produits valides et invalides → partition correcte, total = somme des deux', () => {
    const result = fetchProducts({
      supplier_name: 'F',
      csv_text: 'name,currency\nValide,AED\nInvalide,XYZ',
    });
    expect(result.products).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);
    expect(result.total).toBe(2);
  });

  it('CSV sans lignes de données → products/invalid vides, total 0', () => {
    const result = fetchProducts({ supplier_name: 'F', csv_text: 'name,price' });
    expect(result).toEqual({ products: [], invalid: [], total: 0 });
  });
});
