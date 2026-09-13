/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const semantic = require('../../services/aliexpress-golden-semantic');

const usbMeter = {
  product_name: 'USB C Digital Power Meter Tester 100W Voltage Current Monitor',
  supplier_category: 'Consumer Electronics > Test Equipment',
  description: 'USB Type C charging power tester with digital display.',
};

const earbuds = {
  product_name: 'E6S Wireless Bluetooth Earphones TWS Bluetooth Headset Wireless Earbuds',
  supplier_category: 'Consumer Electronics > Portable Audio',
  description: 'Wireless earbuds with microphone.',
};

describe('AliExpress Golden semantic relevance', () => {
  test('accepts a source result aligned with a specific search query', () => {
    const result = semantic.audit(usbMeter, 'usb c digital power meter tester');
    expect(result.relevant).toBe(true);
    expect(result.matched_tokens).toEqual(expect.arrayContaining(['usb', 'digital', 'power', 'meter', 'tester']));
  });

  test('rejects a rich but off-query AliExpress result', () => {
    const result = semantic.audit(earbuds, 'usb c digital power meter tester');
    expect(result.relevant).toBe(false);
    expect(result.matched_tokens).toHaveLength(0);
  });
});
