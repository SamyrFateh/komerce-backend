'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {
  ACK_VALUE, PROFILES, assertProvisionAllowed, readProfiles, run,
} = require('../../scripts/recette/staging-e2e-provision');

const PW = (k) => `Zz9-${k}-SECRETVALUE`;
function baseEnv(over = {}) {
  const env = {
    KOMERCE_ENV: 'staging', NODE_ENV: 'test', DATABASE_URL: 'postgres://u:p@db.example:5432/staging',
    STAGING_BASE_URL: 'https://staging.example', EXPECTED_RAILWAY_ENVIRONMENT: 'staging',
    KOMERCE_STAGING_RESET_DB_PIN: 'db.example:5432/staging',
  };
  for (const p of PROFILES.filter((x) => x.key !== 'hub_director')) {
    env[`E2E_${p.prefix}_EMAIL`] = `${p.key}@komerce.test`; env[`E2E_${p.prefix}_PASSWORD`] = PW(p.key);
  }
  return { ...env, ...over };
}

function fakeWorld() {
  const w = { users: new Map(), relais: [], calls: [], tx: [], grants: [], sourcing: new Set(), markers: new Set(), leads: new Set(), seq: 0 };
  w.users.set('admin@komerce.test', { id: 'u-admin', role: 'admin', password_hash: 'H:other', account_activation_required: false });
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql, params = []) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) { w.tx.push(sql); return { rows: [] }; }
      if (/FROM users WHERE lower\(email\)/.test(sql) && /password_hash/.test(sql)) {
        const u = w.users.get(String(params[0]).toLowerCase()); return { rows: u ? [u] : [] };
      }
      if (/FROM users WHERE lower\(email\)/.test(sql)) {
        const u = w.users.get(String(params[0]).toLowerCase()); return { rows: u && u.role === 'admin' ? [{ id: u.id }] : [] };
      }
      if (/FROM markets/.test(sql)) return { rows: [{ id: `m-${params[0]}`, is_active: params[0] !== 'DJ' }] };
      if (/is_operating_lead FROM assignment_memberships/.test(sql)) return { rows: w.leads.has(`${params[0]}:${params[1]}`) ? [{ is_operating_lead: true }] : [] };
      if (/e2e_test_accounts/.test(sql)) { const had = w.markers.has(params[0]); w.markers.add(params[0]); return { rowCount: had ? 0 : 1 }; }
      if (/sourcing_global_access_grants/.test(sql)) { const had = w.sourcing.has(params[0]); w.sourcing.add(params[0]); return { rowCount: had ? 0 : 1 }; }
      throw new Error(`SQL inattendu: ${sql}`);
    }),
  };
  const db = { getClient: jest.fn(async () => client) };
  const deps = {
    bcrypt: { hash: async (p) => `H:${p}`, compare: async (p, h) => h === `H:${p}` },
    users: {
      createAdminUser: jest.fn(async (_c, a) => { const id = `u-${++w.seq}`; w.users.set(a.email, { id, role: a.role, password_hash: a.passwordHash, account_activation_required: false }); w.calls.push('createAdminUser'); return { rows: [{ id }] }; }),
      setUserPasswordHash: jest.fn(async (_c, a) => { for (const u of w.users.values()) if (u.id === a.userId) u.password_hash = a.passwordHash; w.calls.push('setUserPasswordHash'); }),
      assignAgentRelais: jest.fn(async () => ({ status: 'assigned' })),
    },
    operators: { grantOperatorScope: jest.fn(async () => ({ status: 'granted' })), targetCapabilitiesForScope: jest.fn(async () => ['team.grant', 'logistics.read']) },
    team: { inviteTeamMember: jest.fn(async (_c, a) => { w.calls.push(`lead:${a.assignmentId}:${a.grantsOperatingLead}:${a.actorIsCentral}`); w.leads.add(`${a.assignmentId}:u-?`); return { kind: 'membership' }; }) },
    relais: {
      listRelais: jest.fn(async (_c, { marketId }) => w.relais.filter((r) => r.market_id === marketId)),
      createRelais: jest.fn(async (_c, a) => { const r = { id: `r-${++w.seq}`, market_id: a.marketId, name: a.name, is_active: true }; w.relais.push(r); return r; }),
      setRelaisActive: jest.fn(),
    },
    delegation: {
      resolveActiveAssignmentByMarketCode: jest.fn(async (_c, code) => ({ assignment_id: `a-${code}` })),
      addMembership: jest.fn(async (_c, a) => { w.calls.push(`addMembership:${a.assignmentId}:${a.capabilities.join('+')}:${a.actorIsCentral}`); return { id: 'm1' }; }),
    },
    hubAuth: { grant: jest.fn(async ({ userId, authorizationType }) => { const k = `${userId}:${authorizationType}`; const had = w.grants.includes(k); if (!had) w.grants.push(k); return { idempotent_replay: had }; }) },
  };
  return { w, db, deps, guard: async () => ({ confirmed: true }) };
}

describe('gardes pures', () => {
  test.each([
    [{ KOMERCE_ENV: 'production' }, 'REFUSED_PRODUCTION'],
    [{ NODE_ENV: 'production' }, 'REFUSED_PRODUCTION'],
    [{ KOMERCE_ENV: 'local' }, 'REFUSED_NOT_STAGING'],
    [{ EXPECTED_RAILWAY_ENVIRONMENT: 'production' }, 'REFUSED_ENV_PIN'],
    [{ KOMERCE_STAGING_RESET_DB_PIN: 'autre:5432/x' }, 'NOT_PINNED'],
    [{ STAGING_BASE_URL: 'http://x' }, 'REFUSED_BASE_URL'],
  ])('refus hors staging prouvé %j', (over, code) => {
    expect(() => assertProvisionAllowed('dry-run', baseEnv(over))).toThrow(code);
  });
  test('execute exige la confirmation texte ; dry-run non', () => {
    expect(() => assertProvisionAllowed('execute', baseEnv())).toThrow('ACK_MISSING');
    expect(() => assertProvisionAllowed('execute', baseEnv({ KOMERCE_STAGING_E2E_PROVISION_ACK: 'oui' }))).toThrow('ACK_MISSING');
    expect(() => assertProvisionAllowed('execute', baseEnv({ KOMERCE_STAGING_E2E_PROVISION_ACK: ACK_VALUE }))).not.toThrow();
    expect(() => assertProvisionAllowed('dry-run', baseEnv())).not.toThrow();
    expect(() => assertProvisionAllowed(null, baseEnv())).toThrow('MODE_REQUIRED');
  });
});

describe('profils et secrets', () => {
  test('responsable Hub sans secrets : sautée avec avertissement, pas d\'échec', () => {
    const { accounts, skipped } = readProfiles(baseEnv());
    expect(accounts.map((a) => a.key)).not.toContain('hub_director');
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toContain('E2E_HUB_DIRECTOR_EMAIL');
  });
  test('responsable Hub avec secrets : incluse avec les deux grants', () => {
    const { accounts } = readProfiles(baseEnv({ E2E_HUB_DIRECTOR_EMAIL: 'hd@komerce.test', E2E_HUB_DIRECTOR_PASSWORD: PW('hd') }));
    expect(accounts.find((a) => a.key === 'hub_director').hubGrants).toEqual(['purchase_commitment', 'supplier_payment']);
  });
  test('secret requis manquant ou mot de passe faible : seuls les NOMS apparaissent', () => {
    const env = baseEnv(); delete env.E2E_FINANCE_PASSWORD;
    expect(() => readProfiles(env)).toThrow('E2E_FINANCE_PASSWORD');
    let msg = '';
    try { readProfiles(baseEnv({ E2E_FINANCE_PASSWORD: 'faible' })); } catch (e) { msg = e.message; }
    expect(msg).toContain('E2E_FINANCE_PASSWORD');
    expect(msg).not.toContain('faible');
  });
});

describe('run', () => {
  test('dry-run : transaction annulée, jamais de COMMIT, rapport sans secret', async () => {
    const { w, db, deps, guard } = fakeWorld();
    const env = baseEnv({ E2E_HUB_DIRECTOR_EMAIL: 'hd@komerce.test', E2E_HUB_DIRECTOR_PASSWORD: PW('hd') });
    const report = await run({ db, mode: 'dry-run', env, deps, guard });
    expect(w.tx).toEqual(['BEGIN', 'ROLLBACK']);
    expect(report.committed).toBe(false);
    const text = JSON.stringify(report);
    for (const p of PROFILES) expect(text).not.toContain(PW(p.key));
    expect(text).not.toContain('SECRETVALUE');
    expect(text).not.toContain('@komerce.test');
  });

  test('execute : COMMIT, 7 profils + responsable Hub, 4 relais (DJ inactif sauté), droits attendus', async () => {
    const { w, db, deps, guard } = fakeWorld();
    const env = baseEnv({ E2E_HUB_DIRECTOR_EMAIL: 'hd@komerce.test', E2E_HUB_DIRECTOR_PASSWORD: PW('hd'), KOMERCE_STAGING_E2E_PROVISION_ACK: ACK_VALUE });
    const report = await run({ db, mode: 'execute', env, deps, guard });
    expect(w.tx).toEqual(['BEGIN', 'COMMIT']);
    expect(Object.keys(report.relais)).toEqual(['KM', 'CM', 'CG', 'DJ', 'YT']);
    // DJ présent mais inactif (migration 310) : jamais activé, aucun relais créé
    expect(report.relais.DJ).toEqual({ status: 'skipped_market_inactive' });
    expect(w.relais.map((r) => r.market_id)).not.toContain('m-DJ');
    expect(w.relais).toHaveLength(4);
    // L'agent relais appartient au marche de son relais : membership d'execution via le writer canonique, bornee receive/collect.
    expect(w.calls.filter((c) => c.startsWith('addMembership:'))).toEqual(['addMembership:a-KM:execution.parcel.receive+execution.parcel.collect:true']);
    const by = Object.fromEntries(report.profiles.map((p) => [p.profile, p]));
    expect(by.admin.password).toBe('not_touched');
    expect(by.market_operator.market_scope).toMatchObject({ market: 'KM', role: 'manager' });
    expect(by.finance.market_scope.role).toBe('viewer');
    expect(by.agent_relais.relais).toEqual({ market: 'KM', status: 'assigned' });
    expect(by.sourcing.sourcing_global_authority).toBe('granted');
    expect(by.hub_director.hub_grants).toEqual({ purchase_commitment: 'granted', supplier_payment: 'granted' });
    expect(deps.users.createAdminUser).toHaveBeenCalledTimes(7);
    expect(deps.users.createAdminUser.mock.calls.some(([, a]) => a.role === 'admin')).toBe(false);
  });

  test('idempotence : un second execute ne crée ni ne modifie rien', async () => {
    const { w, db, deps, guard } = fakeWorld();
    const env = baseEnv({ E2E_HUB_DIRECTOR_EMAIL: 'hd@komerce.test', E2E_HUB_DIRECTOR_PASSWORD: PW('hd'), KOMERCE_STAGING_E2E_PROVISION_ACK: ACK_VALUE });
    await run({ db, mode: 'execute', env, deps, guard });
    const created = w.users.size; const relais = w.relais.length;
    deps.users.createAdminUser.mockClear(); deps.relais.createRelais.mockClear();
    const again = await run({ db, mode: 'execute', env, deps, guard });
    expect(w.users.size).toBe(created); expect(w.relais).toHaveLength(relais);
    expect(deps.users.createAdminUser).not.toHaveBeenCalled();
    expect(deps.relais.createRelais).not.toHaveBeenCalled();
    expect(deps.users.setUserPasswordHash).not.toHaveBeenCalled();
    expect(again.profiles.find((p) => p.profile === 'finance')).toMatchObject({ user: 'existing', password: 'unchanged' });
    expect(again.profiles.find((p) => p.profile === 'hub_director').hub_grants).toEqual({ purchase_commitment: 'unchanged', supplier_payment: 'unchanged' });
    expect(Object.values(again.relais).every((r) => ['unchanged', 'skipped_market_inactive'].includes(r.status))).toBe(true);
    // Marqueur E2E (e2e_test_accounts) : pose au premier execute pour chaque profil, inchange ensuite.
    expect(again.profiles.every((p) => p.e2e_marker === 'unchanged')).toBe(true);
    expect(w.markers.size).toBe(again.profiles.length);
  });

  test('execute pose le marqueur E2E pour chaque profil ; dry-run l\'annule (ROLLBACK)', async () => {
    const { w, db, deps, guard } = fakeWorld();
    const env = baseEnv({ KOMERCE_STAGING_E2E_PROVISION_ACK: ACK_VALUE });
    const dry = await run({ db, mode: 'dry-run', env, deps, guard });
    expect(dry.committed).toBe(false); expect(w.tx).toContain('ROLLBACK');
    const exec = await run({ db, mode: 'execute', env, deps, guard });
    expect(exec.profiles.every((p) => ['marked', 'unchanged'].includes(p.e2e_marker))).toBe(true);
  });

  test('mot de passe changé dans le secret : mis à jour via le writer canonique', async () => {
    const { db, deps, guard } = fakeWorld();
    await run({ db, mode: 'execute', env: baseEnv({ KOMERCE_STAGING_E2E_PROVISION_ACK: ACK_VALUE }), deps, guard });
    const rotated = baseEnv({ E2E_FINANCE_PASSWORD: 'Nouveau9-Valeur', KOMERCE_STAGING_E2E_PROVISION_ACK: ACK_VALUE });
    const rep = await run({ db, mode: 'execute', env: rotated, deps, guard });
    expect(deps.users.setUserPasswordHash).toHaveBeenCalledTimes(1);
    expect(rep.profiles.find((p) => p.profile === 'finance').password).toBe('updated');
    expect(JSON.stringify(rep)).not.toContain('Nouveau9');
  });

  test('refus : cible non confirmée, rôle différent, admin absent ; ROLLBACK', async () => {
    const a = fakeWorld();
    await expect(run({ db: a.db, mode: 'dry-run', env: baseEnv(), deps: a.deps, guard: async () => ({ confirmed: false }) })).rejects.toThrow('TARGET_NOT_CONFIRMED');
    expect(a.db.getClient).not.toHaveBeenCalled();
    const b = fakeWorld();
    b.w.users.set('finance@komerce.test', { id: 'u-x', role: 'client', password_hash: '', account_activation_required: false });
    await expect(run({ db: b.db, mode: 'execute', env: baseEnv({ KOMERCE_STAGING_E2E_PROVISION_ACK: ACK_VALUE }), deps: b.deps, guard: b.guard })).rejects.toThrow('ROLE_MISMATCH');
    expect(b.w.tx.at(-1)).toBe('ROLLBACK');
    const c = fakeWorld(); c.w.users.delete('admin@komerce.test');
    await expect(run({ db: c.db, mode: 'dry-run', env: baseEnv(), deps: c.deps, guard: c.guard })).rejects.toThrow('ADMIN_MISSING');
  });
});

describe('marches de recette supplementaires (CM, CG)', () => {
  test('sans E2E_PROVISION_EXTRA_MARKETS : comportement KM inchange, aucun appel equipe', async () => {
    const { w, db, deps, guard } = fakeWorld();
    const r = await run({ db, mode: 'execute', env: baseEnv({ KOMERCE_STAGING_E2E_PROVISION_ACK: ACK_VALUE }), deps, guard });
    expect(deps.team.inviteTeamMember).not.toHaveBeenCalled();
    expect(r.profiles.every((p) => p.extra_markets === undefined && p.extra_relay_memberships === undefined)).toBe(true);
    expect(w.calls.some((c) => c.startsWith('lead:'))).toBe(false);
  });

  test('CM,CG : responsable pays (manager) + responsable d\'exploitation, agent relais membre ; YT/DJ refuses', async () => {
    const { w, db, deps, guard } = fakeWorld();
    const env = baseEnv({ KOMERCE_STAGING_E2E_PROVISION_ACK: ACK_VALUE, E2E_PROVISION_EXTRA_MARKETS: 'CM,CG' });
    const r = await run({ db, mode: 'execute', env, deps, guard });
    const mo = r.profiles.find((p) => p.profile === 'market_operator');
    expect(mo.extra_markets).toEqual([
      { market: 'CM', scope: 'granted', operating_lead: 'assigned' },
      { market: 'CG', scope: 'granted', operating_lead: 'assigned' },
    ]);
    expect(w.calls.filter((c) => c.startsWith('lead:'))).toEqual(['lead:a-CM:true:true', 'lead:a-CG:true:true']);
    const relay = r.profiles.find((p) => p.profile === 'agent_relais');
    expect(relay.extra_relay_memberships.map((m) => m.market)).toEqual(['CM', 'CG']);
    for (const bad of ['YT', 'DJ', 'KM']) {
      await expect(run({ db, mode: 'dry-run', env: baseEnv({ E2E_PROVISION_EXTRA_MARKETS: bad }), deps, guard })).rejects.toMatchObject({ message: expect.stringContaining('E2E_PROVISION_EXTRA_MARKET_NOT_ALLOWED') });
    }
  });
});
