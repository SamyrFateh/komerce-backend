'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));

const {
  PartnerAdminError,
  listPartners,
  updatePartner,
  deletePartner,
} = require('../../services/partner-admin-service');

describe('partner-admin-service', () => {
  it('paramètre les filtres partenaire sans interpoler leurs valeurs', async () => {
    const q = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const malicious = "sourcing' OR 1=1 --";

    await listPartners({ type: malicious, island: 'Anjouan', active: false }, q);

    const [sql, params] = q.query.mock.calls[0];
    expect(sql).not.toContain(malicious);
    expect(sql).toContain('partner_type = $1');
    expect(sql).toContain('island = $2');
    expect(sql).toContain('is_active = $3');
    expect(params).toEqual([malicious, 'Anjouan', false]);
  });

  it('refuse un update vide avant toute écriture DB', async () => {
    const q = { query: jest.fn() };
    await expect(updatePartner('partner-1', {}, q))
      .rejects.toMatchObject({ name: 'PartnerAdminError', status: 400, code: 'partner_no_changes' });
    expect(q.query).not.toHaveBeenCalled();
  });

  it('signale précisément la dissociation métier lors de la suppression', async () => {
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ c: 2 }] })
        .mockResolvedValueOnce({ rows: [{ c: 1 }] })
        .mockResolvedValueOnce({ rowCount: 1 }),
    };

    const result = await deletePartner('partner-1', q);

    expect(result.deleted).toBe(true);
    expect(result.links_unset).toEqual({ shipments: 2, orders: 1 });
    expect(result.message).toContain('2 envois et 1 commandes');
  });

  it('renvoie partner_not_found si aucune ligne n’est supprimée', async () => {
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ c: 0 }] })
        .mockResolvedValueOnce({ rows: [{ c: 0 }] })
        .mockResolvedValueOnce({ rowCount: 0 }),
    };

    await expect(deletePartner('missing', q)).rejects.toBeInstanceOf(PartnerAdminError);
  });
});
