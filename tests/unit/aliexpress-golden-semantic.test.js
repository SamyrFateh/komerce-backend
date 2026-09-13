/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const semantic = require('../../scripts/aliexpress-golden-semantic');

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

const chargingCable = {
  product_name: '120W USB To Type-C Cable 90 Degree Elbow Mobile Phone Fast Charging Cord',
  supplier_category: 'Consumer Electronics > Cables',
  description: 'USB power charging cable for mobile phones.',
};

const displayCable = {
  product_name: 'Toocki 100W Type C to Type C Cable PD Fast Charging USB C Display Cable',
  supplier_category: 'Consumer Electronics > Cables',
  description: 'Digital power display charging cable for Macbook and iPad.',
};

describe('AliExpress Golden semantic relevance', () => {
  test('accepts a source result aligned with a specific search query', () => {
    const result = semantic.audit(usbMeter, 'usb c digital power meter tester');
    expect(result.relevant).toBe(true);
    expect(result.matched_tokens).toEqual(expect.arrayContaining(['usb', 'digital', 'power', 'meter', 'tester']));
    expect(result.required_matches).toBe(3);
    expect(result.coverage_ratio).toBe(1);
    expect(result.intent_anchors).toEqual(['meter', 'tester']);
    expect(result.matched_intent_anchors).toEqual(expect.arrayContaining(['meter', 'tester']));
  });

  test('rejects a rich but off-query AliExpress result', () => {
    const result = semantic.audit(earbuds, 'usb c digital power meter tester');
    expect(result.relevant).toBe(false);
    expect(result.matched_tokens).toHaveLength(0);
  });

  test('rejects a generic USB power cable that only matches two generic tokens', () => {
    const result = semantic.audit(chargingCable, 'usb c digital power meter tester');
    expect(result.matched_tokens).toEqual(expect.arrayContaining(['usb', 'power']));
    expect(result.matched_tokens).toHaveLength(2);
    expect(result.required_matches).toBe(3);
    expect(result.relevant).toBe(false);
  });

  test('rejects a digital power display cable when no meter/tester intent anchor matches', () => {
    const result = semantic.audit(displayCable, 'usb c digital power meter tester');
    expect(result.matched_tokens).toEqual(expect.arrayContaining(['usb', 'digital', 'power']));
    expect(result.matched_tokens).toHaveLength(3);
    expect(result.required_matches).toBe(3);
    expect(result.matched_intent_anchors).toEqual([]);
    expect(result.relevant).toBe(false);
  });
});
