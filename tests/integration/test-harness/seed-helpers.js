'use strict';
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-prod';
const PFX = 'itest+';
let db;
const getDb = () => (db = db || require('../../../db'));

async function createUser(opts = {}) {
  const role = opts.role || 'client';
  const phone = opts.phone || `+2693${Math.floor(1000000 + Math.random()*8999999)}`;
  const email = `${PFX}${role}.${Date.now()}.${Math.random().toString(36).slice(2,8)}@test.local`;
  const { rows } = await getDb().query(
    `INSERT INTO users (email, full_name, phone, role, relais_id)
     VALUES ($1,$2,$3,$4::public.user_role,$5)
     RETURNING id, email, phone, role`,
    [email, `ITest ${role}`, phone, role, opts.relais_id || null]
  );
  const u = rows[0];
  const jti = opts.jti || `itest-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  return { ...u, jti, token: tokenFor(u.id, { jti }) };
}
function tokenFor(id, { jti } = {}) {
  const p = { id }; if (jti) p.jti = jti;
  return jwt.sign(p, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}
async function revoke(jti) {
  await getDb().query(`INSERT INTO revoked_tokens (jti, expires_at) VALUES ($1, now()+interval '1 hour') ON CONFLICT DO NOTHING`, [jti]);
}
async function cleanup() {
  try { await getDb().query(`DELETE FROM users WHERE email LIKE $1`, [`${PFX}%`]); } catch(_){}
}
module.exports = { createUser, tokenFor, revoke, cleanup };
