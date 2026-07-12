'use strict';

const mockSetupProductDetailModal = jest.fn();

jest.mock('../../js/b-modal-product-detail-bootstrap.js', () => ({
  setupProductDetailModal: mockSetupProductDetailModal,
}));

const { setupMobileProductDetail } = require('../../js/b-modal-mobile-product-bootstrap.js');

describe('mobile product detail bootstrap compatibility alias', () => {
  test('délègue au bootstrap Product Detail commun', () => {
    setupMobileProductDetail();
    expect(mockSetupProductDetailModal).toHaveBeenCalledTimes(1);
  });
});
