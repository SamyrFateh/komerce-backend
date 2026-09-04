'use strict';

const {
  FAMILIES,
  TARGET,
  TARGET_PER_FAMILY,
  SORT_BASE,
  slotSortOrder,
  frenchName,
  frenchDescription,
} = require('../../scripts/cj-real-showcase-seed');

describe('cj-real-showcase-seed contract', () => {
  it('keeps the 21 x 3 = 63 deterministic plan', () => {
    expect(FAMILIES).toHaveLength(21);
    expect(TARGET_PER_FAMILY).toBe(3);
    expect(TARGET).toBe(63);
    expect(FAMILIES.length * TARGET_PER_FAMILY).toBe(TARGET);
  });

  it('allocates a unique stable sort slot to every planned product', () => {
    const slots = [];
    for (let family = 0; family < FAMILIES.length; family += 1) {
      for (let slot = 0; slot < TARGET_PER_FAMILY; slot += 1) {
        slots.push(slotSortOrder(family, slot));
      }
    }
    expect(new Set(slots).size).toBe(TARGET);
    expect(Math.min(...slots)).toBe(SORT_BASE);
    expect(Math.max(...slots)).toBe(SORT_BASE + TARGET - 1);
  });

  it('prepares concise French client copy without erasing source lineage', () => {
    const family = FAMILIES.find((row) => row.key === 'kitchen');
    expect(frenchName(family, 0)).toBe('Blender de cuisine — modèle A');
    expect(frenchName(family, 0).length).toBeLessThanOrEqual(80);
    expect(frenchDescription(family)).toMatch(/Visuel réel fournisseur/);
    expect(frenchDescription(family)).toMatch(/traçabilité Komerce/);
  });
});
