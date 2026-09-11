from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'anchor missing in {path}: {old[:100]!r}')
    p.write_text(s.replace(old, new, 1))


p = 'services/pricing-period-structure.js'
replace_once(p,
    'async function recordStructureCostEvent(input = {}, actorId) {',
    'async function recordStructureCostEvent(input = {}, actorId, options = {}) {')
replace_once(p,
    "  const client = await db.getClient();\n  try {\n    await client.query('BEGIN');",
    "  const injectedExecutor = options && options.executor ? options.executor : null;\n  if (injectedExecutor && typeof injectedExecutor.query !== 'function') {\n    throw new TypeError('recordStructureCostEvent options.executor.query is required');\n  }\n  const client = injectedExecutor || await db.getClient();\n  const ownsTransaction = !injectedExecutor;\n  try {\n    if (ownsTransaction) await client.query('BEGIN');")
replace_once(p,
    "    await client.query('COMMIT');\n    return insertRes.rows[0];\n  } catch (error) {\n    try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }\n    throw error;\n  } finally {\n    client.release();\n  }",
    "    if (ownsTransaction) await client.query('COMMIT');\n    return insertRes.rows[0];\n  } catch (error) {\n    if (ownsTransaction) {\n      try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }\n    }\n    throw error;\n  } finally {\n    if (ownsTransaction && typeof client.release === 'function') client.release();\n  }")

p = 'services/market-delegation-structure-event-service.js'
replace_once(p,
    " * recordStructureCostEvent() gère sa propre transaction (BEGIN/COMMIT\n * internes via db.getClient()) — pas un executor injectable. L'audit\n * market-delegation est donc un second appel, après succès du premier :\n * deux écritures atomiques distinctes, pas une transaction unique combinée.\n * Documenté ici plutôt que de modifier la signature du writer canonique\n * (economic-engine, lifecycle owner).",
    " * Le writer canonique accepte ici l'executor transactionnel du caller.\n * Le fait économique et market_delegation_audit utilisent donc exactement\n * la même transaction : si l'audit échoue, le fait est rollbacké.\n * economic-engine reste lifecycle owner et seul writer de la table métier.")
replace_once(p,
    "      { ...payload, scope_kind: pricingPeriodStructure.SCOPE_KINDS.MARKET_DIRECT, market_id: authz.market_id },\n      actorUserId\n    );",
    "      { ...payload, scope_kind: pricingPeriodStructure.SCOPE_KINDS.MARKET_DIRECT, market_id: authz.market_id },\n      actorUserId,\n      { executor: db }\n    );")
replace_once(p,
    '  // Second appel, transaction distincte — voir doc ci-dessus.\n  await audit(db, {',
    '  // Même executor transactionnel que le writer : vérité + preuve sont atomiques.\n  await audit(db, {')

p = 'routes/market-delegation-structure-event.js'
replace_once(p,
    "// recordStructureEvent gère sa propre transaction via le writer canonique\n// (economic-engine) — pas de withTransaction ici, l'audit market-delegation\n// est un second appel distinct après succès. Voir la doc du service.",
    "// Une seule transaction englobe autorisation, writer economic-engine et audit.\n// Un échec d'audit rollbacke donc également le fait structurel append-only.")
replace_once(p,
    "    const event = await recordStructureEvent(db, {\n      marketCode: req.params.marketCode,\n      actorUserId: req.user.id,\n      correlationId: correlationId(req),\n      payload: req.body || {},\n    });",
    "    const event = await withTransaction(client => recordStructureEvent(client, {\n      marketCode: req.params.marketCode,\n      actorUserId: req.user.id,\n      correlationId: correlationId(req),\n      payload: req.body || {},\n    }));")

p = 'tests/unit/market-delegation-structure-event-service.test.js'
replace_once(p,
    "      expect.objectContaining({ scope_kind: 'MARKET_DIRECT', market_id: 'mkt-cm', charge_id: 'c1' }),\n      'u1'\n    );",
    "      expect.objectContaining({ scope_kind: 'MARKET_DIRECT', market_id: 'mkt-cm', charge_id: 'c1' }),\n      'u1',\n      { executor: db }\n    );")

p = 'tests/unit/pricing-period-structure.test.js'
anchor = "  test('MARKET_DIRECT vérifie que le marché existe et est actif', async () => {"
addition = """  test('réutilise un executor injecté sans ouvrir ni fermer une seconde transaction', async () => {
    const injected = { query: jest.fn() };
    injected.query
      .mockResolvedValueOnce({ rows: [chargeRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-atomic', ...baseInput(), recorded_by: 'actor-1' }] });

    const result = await recordStructureCostEvent(baseInput(), 'actor-1', { executor: injected });

    expect(result.id).toBe('event-atomic');
    expect(db.getClient).not.toHaveBeenCalled();
    expect(injected.query).toHaveBeenCalledTimes(2);
    expect(injected.query.mock.calls.map(([sql]) => String(sql).trim())).not.toContain('BEGIN');
    expect(injected.query.mock.calls.map(([sql]) => String(sql).trim())).not.toContain('COMMIT');
  });

"""
replace_once(p, anchor, addition + anchor)

p = 'tests/unit/market-delegation-structure-event-routes.test.js'
anchor = "  test('no DELETE, no PUT — append-only, corrections go through recordStructureEvent as new events', () => {"
addition = """  test('POST est enveloppé dans withTransaction : writer + audit partagent le même client', () => {
    expect(routeSource).toMatch(/withTransaction\\(client\\s*=>\\s*recordStructureEvent\\(client/);
  });

"""
replace_once(p, anchor, addition + anchor)

p = 'tests/e2e-api/market-delegation.structure.e2e.test.js'
anchor = "  it('5 — même un SQL direct ordinaire ne peut réécrire ni supprimer l’historique', async () => {"
atomic = """  it('5 — si l’audit échoue, le fait économique est rollbacké dans la même transaction', async () => {
    const correlation = 'e2e-ma-04-force-audit-fail';
    const evidence = 'E2E-ATOMIC-ROLLBACK';
    const constraintName = `e2e_audit_fail_${uuid().replace(/-/g, '')}`;

    await db.query(
      `ALTER TABLE market_delegation_audit
         ADD CONSTRAINT "${constraintName}"
         CHECK (correlation_id IS DISTINCT FROM '${correlation}') NOT VALID`
    );
    try {
      const res = await request(app)
        .post(`/api/market-delegation/markets/${fx.marketA.code}/structure-events`)
        .set('Authorization', fx.managerA.token)
        .set('x-correlation-id', correlation)
        .send(accrual({ evidence_ref: evidence }));

      expect(res.status).toBe(500);
      const persisted = await db.query(
        `SELECT COUNT(*)::int AS n
           FROM economic_structure_cost_events
          WHERE charge_id=$1 AND evidence_ref=$2`,
        [chargeId, evidence]
      );
      expect(persisted.rows[0].n).toBe(0);
    } finally {
      await db.query(`ALTER TABLE market_delegation_audit DROP CONSTRAINT IF EXISTS "${constraintName}"`);
    }
  });

"""
replace_once(p, anchor, atomic + anchor.replace("'5 —", "'6 —"))

Path('.github/workflows/tmp-structure-audit-atomicity.yml').unlink(missing_ok=True)
Path('scripts/tmp-patch-structure-atomicity.py').unlink(missing_ok=True)
