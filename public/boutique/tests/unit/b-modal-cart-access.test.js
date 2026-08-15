'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { focusIntegratedSideCart } = require('../../js/b-modal-cart-access.js');

test('le bouton panier desktop cible la surface intégrée et rejoue son signal', () => {
  document.body.innerHTML = '<aside id="k-side-cart" class="k-side-cart--in-modal is-attention"></aside>';
  const sideCart = document.getElementById('k-side-cart');
  sideCart.scrollIntoView = jest.fn();

  focusIntegratedSideCart(sideCart);

  expect(sideCart.scrollIntoView).toHaveBeenCalledWith({
    behavior: 'smooth',
    block: 'nearest',
    inline: 'nearest',
  });
  expect(sideCart.getAttribute('tabindex')).toBe('-1');
  expect(document.activeElement).toBe(sideCart);
  expect(sideCart.classList.contains('is-attention')).toBe(true);
});
