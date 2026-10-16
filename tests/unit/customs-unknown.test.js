'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { customsUnknownSql } = require('../../services/finance-metrics/customs-unknown');

describe('customs-unknown (prédicat #2554)', () => {
  it('cible l\'alias fourni et le prédicat pending / customs_paid_kmf NULL', () => {
    const sql = customsUnknownSql('o');
    expect(sql).toContain('p.order_id = o.id');
    expect(sql).toContain('cs.is_active');
    expect(sql).toContain("cs.status = 'pending' OR cs.customs_paid_kmf IS NULL");
  });

  it('fragment SQL pur : aucune écriture', () => {
    expect(customsUnknownSql('orders')).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });
});
