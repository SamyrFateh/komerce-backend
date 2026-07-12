'use strict';

const {
  modalProductSession,
  setModalProductDetail,
  setModalProductSelection,
  resetModalProductSession,
} = require('../../js/view-models/modal-product-session.js');

describe('modal-product-session', () => {
  beforeEach(() => {
    resetModalProductSession();
  });

  test('démarre vide après reset', () => {
    expect(modalProductSession).toEqual({
      detail: null,
      selection: null,
    });
  });

  test('conserve explicitement le contrat détail courant', () => {
    const detail = { contract_version: '1', inventory_model: 'SKU' };
    setModalProductDetail(detail);

    expect(modalProductSession.detail).toBe(detail);
    expect(modalProductSession.selection).toBeNull();
  });

  test('conserve explicitement l’instance courante du reducer', () => {
    const selection = { selected_sku_id: 'sku-1' };
    setModalProductSelection(selection);

    expect(modalProductSession.detail).toBeNull();
    expect(modalProductSession.selection).toBe(selection);
  });

  test('reset purge détail et sélection ensemble', () => {
    setModalProductDetail({ id: 'detail' });
    setModalProductSelection({ id: 'selection' });

    resetModalProductSession();

    expect(modalProductSession.detail).toBeNull();
    expect(modalProductSession.selection).toBeNull();
  });
});
