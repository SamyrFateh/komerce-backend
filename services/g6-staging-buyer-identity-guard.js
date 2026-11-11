/**
 * @komerce-arch-lite
 * @role          g6-staging-buyer-identity-guard
 * @domain        auth-identity
 * @layer         service
 * @owner         backend-core
 * @purpose       Restrict G6 browser fixtures to owner-provisioned, DB-marked client identities.
 * @db-read       users, e2e_test_accounts, otp_codes
 * @db-write      otp_codes (owner-only staging fixture preseed)
 * @impact-areas  auth, orders, checkout
 */
'use strict';
const bcrypt = require('bcryptjs');
const G6_BUYER_EMAIL = /^g6-e2e-[a-f0-9]{8}@komerce\.test$/i;
const fail = code => Object.assign(new Error(code), {code, status:409});

function isStaging(env=process.env) {
  return String(env.KOMERCE_ENV||'').toLowerCase()==='staging';
}
function isG6BuyerName(user) {
  return user?.role==='client' && G6_BUYER_EMAIL.test(String(user.email||''));
}
async function verifyMarkedG6Buyer(executor,user,env=process.env) {
  if(!isStaging(env)||!isG6BuyerName(user))return false;
  const {rows}=await executor.query(
    'SELECT 1 FROM e2e_test_accounts WHERE user_id=$1::uuid LIMIT 1',[user.id]);
  if(rows.length!==1)throw fail('G6_MARKED_BUYER_REQUIRED');
  return true;
}
async function findMarkedG6BuyerByPhone(executor,phone,env=process.env) {
  if(!isStaging(env)||!/^\+269\d{7}$/.test(String(phone||'')))return null;
  const {rows}=await executor.query(
    `SELECT u.id,u.email,u.role::text AS role
       FROM users u JOIN e2e_test_accounts e ON e.user_id=u.id
      WHERE (u.phone=$1 OR u.whatsapp_phone=$1)
        AND u.role='client' AND u.email ~* '^g6-e2e-[a-f0-9]{8}@komerce\\.test$'
      LIMIT 2`,[phone]);
  if(rows.length>1)throw fail('G6_PHONE_AMBIGUOUS');
  return rows[0]||null;
}
async function preseedG6BuyerOtp(executor,{buyer,phone,code,purpose='login',env=process.env}) {
  if(!isStaging(env)||env.NODE_ENV!=='test'||!/^\+269\d{7}$/.test(String(phone||''))||
     !/^\d{6}$/.test(String(code||''))||purpose!=='login'||!await verifyMarkedG6Buyer(executor,buyer,env))
    throw fail('G6_OTP_FIXTURE_PROVISION_FORBIDDEN');
  const known=await findMarkedG6BuyerByPhone(executor,phone,env);
  if(!known||String(known.id)!==String(buyer.id))throw fail('G6_OTP_BUYER_NOT_MATCHED');
  const hash=await bcrypt.hash(code,8);
  await executor.query(
    'UPDATE otp_codes SET verified=TRUE,consumed_at=COALESCE(consumed_at,NOW()) WHERE phone=$1 AND purpose=$2 AND verified=FALSE',
    [phone,purpose]);
  await executor.query(
    `INSERT INTO otp_codes(phone,code,purpose,expires_at,attempts,created_at)
     VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes',0,NOW())`,[phone,hash,purpose]);
  return {prepared:true,expires_in_seconds:600};
}
async function hasPreparedG6BuyerOtp(executor,{phone,purpose='login',env=process.env}) {
  const buyer=await findMarkedG6BuyerByPhone(executor,phone,env);
  if(!buyer)return null;
  const {rows}=await executor.query(
    `SELECT 1 FROM otp_codes WHERE phone=$1 AND purpose=$2
      AND verified=FALSE AND expires_at>NOW() AND attempts<5 LIMIT 1`,[phone,purpose]);
  return {buyer,prepared:rows.length===1};
}
module.exports={
  isG6BuyerName,verifyMarkedG6Buyer,findMarkedG6BuyerByPhone,
  preseedG6BuyerOtp,hasPreparedG6BuyerOtp
};
