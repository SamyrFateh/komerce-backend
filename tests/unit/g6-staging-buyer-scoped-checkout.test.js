/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('fs');
const path=require('path');
const {
 isG6BuyerName,verifyMarkedG6Buyer,findMarkedG6BuyerByPhone,
 preseedG6BuyerOtp,hasPreparedG6BuyerOtp
}=require('../../services/g6-staging-buyer-identity-guard');
const USER={id:'76dacd6c-c1d8-4313-9455-f0d8f063835b',email:'g6-e2e-8acbf99f@komerce.test',role:'client'};
const P='+2693123456';
const staging={KOMERCE_ENV:'staging',NODE_ENV:'test'};

test('G6 fixture designation is narrow and never inferred from a client-supplied header',()=>{
 expect(isG6BuyerName(USER)).toBe(true);
 expect(isG6BuyerName({...USER,email:'some-person@example.com'})).toBe(false);
 expect(isG6BuyerName({...USER,role:'admin'})).toBe(false);
 expect(isG6BuyerName({...USER,email:'g6-e2e-8acbf99f@komerce.test.evil'})).toBe(false);
});
test('production identity check always fails closed without querying the DB',async()=>{
 const db={query:jest.fn()};
 expect(await verifyMarkedG6Buyer(db,USER,{KOMERCE_ENV:'production'})).toBe(false);
 expect(await findMarkedG6BuyerByPhone(db,P,{KOMERCE_ENV:'production'})).toBeNull();
 expect(db.query).not.toHaveBeenCalled();
});
test('staging buyer requires owner-provisioned DB marker; synthetic email alone is insufficient',async()=>{
 const db={query:jest.fn().mockResolvedValue({rows:[]})};
 await expect(verifyMarkedG6Buyer(db,USER,staging)).rejects.toMatchObject({code:'G6_MARKED_BUYER_REQUIRED'});
 expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM e2e_test_accounts'),[USER.id]);
});
test('G6 phone must be unambiguous and previously marked',async()=>{
 const db={query:jest.fn().mockResolvedValue({rows:[USER,USER]})};
 await expect(findMarkedG6BuyerByPhone(db,P,staging)).rejects.toMatchObject({code:'G6_PHONE_AMBIGUOUS'});
});
test('G6 OTP fixture refuses provisioning outside isolated staging/test runner',async()=>{
 const db={query:jest.fn()};
 await expect(preseedG6BuyerOtp(db,{buyer:USER,phone:P,code:'623172',env:{KOMERCE_ENV:'production',NODE_ENV:'test'}}))
   .rejects.toMatchObject({code:'G6_OTP_FIXTURE_PROVISION_FORBIDDEN'});
 await expect(preseedG6BuyerOtp(db,{buyer:USER,phone:P,code:'623172',env:{KOMERCE_ENV:'staging',NODE_ENV:'production'}}))
   .rejects.toMatchObject({code:'G6_OTP_FIXTURE_PROVISION_FORBIDDEN'});
 expect(db.query).not.toHaveBeenCalled();
});
test('G6 OTP preseed bcrypt-hashes one private code and never returns it',async()=>{
 const db={query:jest.fn()
  .mockResolvedValueOnce({rows:[{one:1}]})
  .mockResolvedValueOnce({rows:[USER]})
  .mockResolvedValueOnce({rowCount:0})
  .mockResolvedValueOnce({rowCount:1})};
 const out=await preseedG6BuyerOtp(db,{buyer:USER,phone:P,code:'623172',env:staging});
 expect(out).toEqual({prepared:true,expires_in_seconds:600});
 expect(db.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO otp_codes'))).toBe(true);
 const insert=db.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO otp_codes'));
 expect(insert[1][1]).not.toBe('623172');
 expect(await require('bcryptjs').compare('623172',insert[1][1])).toBe(true);
});
test('G6 OTP request tests DB preparation, never echoes secret to caller',async()=>{
 const db={query:jest.fn().mockResolvedValueOnce({rows:[USER]}).mockResolvedValueOnce({rows:[{exists:1}]})};
 const a=await hasPreparedG6BuyerOtp(db,{phone:P,purpose:'login',env:staging});
 expect(a.prepared).toBe(true);
 expect(JSON.stringify(a)).not.toContain('623172');
});
test('order fixture is committed as simulated BEFORE notifier and real POST route remains canonical',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../../services/order-checkout-service.js'),'utf8');
 const run=s.indexOf('const g6Buyer=await verifyMarkedG6Buyer(client,user)');
 const scope=s.indexOf("scope:'G6-BUYER'");
 const commit=s.indexOf("await client.query('COMMIT')",scope);
 const hook=s.indexOf('runOrderPostCommitHooks({',commit);
 expect(run).toBeGreaterThan(0);
 expect(scope).toBeGreaterThan(run);
 expect(commit).toBeGreaterThan(scope);
 expect(hook).toBeGreaterThan(commit);
 expect(s).toContain("payment_mode!=='cash_relais'");
 const route=fs.readFileSync(path.join(__dirname,'../../routes/orders/create.js'),'utf8');
 expect(route).toMatch(/runOrderCheckout\(\{\s*user:\s*req\.user,\s*body:\s*req\.body,\s*idempotencyKey\s*\}/);
 expect(route).toContain("const idempotencyKey = req.get('Idempotency-Key') || null");
 expect(route).toContain("code: 'idempotency_key_required'");
 expect(route).not.toContain('internalSimulation: req.body');
 const notify=fs.readFileSync(path.join(__dirname,'../../services/order-post-commit-hooks.js'),'utf8');
 expect(notify).toContain('if (order && order.simulation_scope != null) return');
});
test('dedicated G6 OTP request branches before global test mode and WhatsApp send',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../../routes/otp.js'),'utf8');
 const branch=s.indexOf('const g6 = await hasPreparedG6BuyerOtp(pool, {phone,purpose})');
 const test=s.indexOf('if (isOtpTestMode())');
 const provider=s.indexOf('const waResult = await sendOtpMessage');
 expect(branch).toBeGreaterThan(0);
 expect(test).toBeGreaterThan(branch);
 expect(provider).toBeGreaterThan(test);
 expect(s).toContain('G6_OTP_FIXTURE_MISSING');
});
