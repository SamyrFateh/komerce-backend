'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  applyFileEvents,
  collectTypeRenameEvents,
} = require('../../scripts/check-schema-resurrection');

describe('check-schema-resurrection — ALTER TYPE RENAME', () => {
  test('order_status reconstruit termine en CREATE sous son nom canonique', () => {
    const timeline = new Map([
      ['type:order_status', {
        num: 124,
        fname: '124_order_status_minimal_domain.sql',
        eventType: 'drop',
        kind: 'type',
        name: 'order_status',
      }],
    ]);

    const events = [];

    collectTypeRenameEvents(
      'ALTER TYPE order_status_new RENAME TO order_status;',
      events
    );

    applyFileEvents(
      events,
      '124_order_status_minimal_domain.sql',
      124,
      timeline
    );

    expect(timeline.get('type:order_status_new').eventType).toBe('drop');
    expect(timeline.get('type:order_status').eventType).toBe('create');
  });

  test('shared_cart_status reconstruit termine également en CREATE', () => {
    const timeline = new Map([
      ['type:shared_cart_status', {
        num: 125,
        fname: '125_shared_cart_minimal_domain.sql',
        eventType: 'drop',
        kind: 'type',
        name: 'shared_cart_status',
      }],
    ]);

    const events = [];

    collectTypeRenameEvents(
      'ALTER TYPE shared_cart_status_new RENAME TO shared_cart_status;',
      events
    );

    applyFileEvents(
      events,
      '125_shared_cart_minimal_domain.sql',
      125,
      timeline
    );

    expect(timeline.get('type:shared_cart_status_new').eventType).toBe('drop');
    expect(timeline.get('type:shared_cart_status').eventType).toBe('create');
  });
});
