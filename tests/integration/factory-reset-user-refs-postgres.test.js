'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration factory-reset-user-refs-postgres.test.js
 * @brief Reset d'usine/utilisateurs : une délégation Hub (hub_authorization_grants) dont granted_by/revoked_by est un compte non-admin ne bloque plus la suppression des comptes. Transaction annulée : aucune donnée partagée modifiée.
 */
jest.setTimeout(60000);
if (!process.env.DATABASE_URL) {
  describe.skip('factory-reset-user-refs (needs DATABASE_URL)', () => { test('skipped', () => {}); });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const { deleteNonAdminUsers, releaseNonAdminUserReferences } = require('../../services/user-mutation-service');
  const tag = `FRU-${crypto.randomBytes(3).toString('hex')}`;
  const uid = () => crypto.randomUUID();
  const phone = () => `+2693${String(BigInt(`0x${crypto.randomBytes(4).toString('hex')}`) % 10000000n).padStart(7, '0')}`;

  afterAll(async () => { await db.pool.end().catch(() => {}); });

  test('grant dont granted_by / revoked_by est un non-admin : sans libération le reset échoue, avec elle il réussit', async () => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const mk = async (role, label) => {
        const id = uid();
        await client.query('INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,$5)', [id, `${label} ${tag}`, `${label}-${tag}@komerce.test`.toLowerCase(), phone(), role]);
        return id;
      };
      const admin = await mk('admin', 'adm'); const directrice = await mk('agent_hub', 'dir'); const other = await mk('agent_hub', 'oth');
      // (1) directrice ← directrice (auto-délégation), (2) admin ← non-admin (granted_by RESTRICT), (3) révocation par un non-admin.
      await client.query("INSERT INTO hub_authorization_grants(user_id,authorization_type,granted_by) VALUES ($1,'supplier_payment',$1)", [directrice]);
      await client.query("INSERT INTO hub_authorization_grants(user_id,authorization_type,granted_by) VALUES ($1,'purchase_commitment',$2)", [admin, other]);
      await client.query(`INSERT INTO hub_authorization_grants(user_id,authorization_type,granted_by,revoked_by,revoked_at,revoke_reason)
                          VALUES ($1,'supplier_payment',$2,$3,now(),'test')`, [admin, admin, other]);

      await client.query('SAVEPOINT before_delete');
      await expect(deleteNonAdminUsers(client)).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK TO SAVEPOINT before_delete');

      const released = await releaseNonAdminUserReferences(client);
      expect(released.blocked.filter((b) => /hub_authorization_grants/.test(b.table))).toEqual([]);
      expect(released.cleared['hub_authorization_grants.granted_by']).toBeGreaterThanOrEqual(1);
      await expect(deleteNonAdminUsers(client)).resolves.toBeDefined();
      const { rows: [left] } = await client.query('SELECT COUNT(*)::int n FROM hub_authorization_grants WHERE granted_by = ANY($1::uuid[]) OR user_id = ANY($1::uuid[])', [[directrice, other]]);
      expect(left.n).toBe(0);
      expect((await client.query('SELECT 1 FROM users WHERE id = $1', [admin])).rows).toHaveLength(1);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });
}
