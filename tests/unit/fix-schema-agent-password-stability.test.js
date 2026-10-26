'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const mockQuery=jest.fn();
const mockHash=jest.fn();
jest.mock('../../db',()=>({query:(...args)=>mockQuery(...args)}));
jest.mock('bcryptjs',()=>({hash:(...args)=>mockHash(...args)}));
const {fixAdminHash}=require('../../scripts/fix-schema');

const ORIGINAL_ENV=process.env;
beforeEach(()=>{
  jest.clearAllMocks();
  process.env={...ORIGINAL_ENV,
    NODE_ENV:'production',
    ADMIN_PASSWORD:'admin-opaque-fixture',
    HUB_PASSWORD:'hub-opaque-fixture',
    RELAIS_PASSWORD:'relais-opaque-fixture',
  };
  mockQuery.mockResolvedValue({rowCount:1,rows:[]});
  mockHash.mockResolvedValue('hashed-fixture');
  jest.spyOn(console,'log').mockImplementation(()=>{});
  jest.spyOn(console,'warn').mockImplementation(()=>{});
  jest.spyOn(console,'error').mockImplementation(()=>{});
});
afterEach(()=>{jest.restoreAllMocks();process.env=ORIGINAL_ENV;});

test('boot no longer overwrites any Hub/Relay user hash even if legacy env vars exist',async()=>{
  await fixAdminHash();
  const sql=mockQuery.mock.calls.map(([query])=>String(query)).join('\n');
  expect(sql).not.toMatch(/role\s*=\s*['"]agent_hub['"]/);
  expect(sql).not.toMatch(/role\s*=\s*['"]agent_relais['"]/);
  expect(sql).not.toMatch(/UPDATE users SET password_hash[^\n]*WHERE role/i);
  expect(sql).toContain("email = 'admin@komerce.km'");
  expect(mockHash).not.toHaveBeenCalledWith(process.env.HUB_PASSWORD,expect.anything());
  expect(mockHash).not.toHaveBeenCalledWith(process.env.RELAIS_PASSWORD,expect.anything());
});

test('boot does not rewrite Hub/Relay credentials when admin password is unset',async()=>{
  delete process.env.ADMIN_PASSWORD;
  await fixAdminHash();
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockHash).not.toHaveBeenCalled();
});

test('production boot does not silently replace client passwords with demo credentials',async()=>{
  await fixAdminHash();
  expect(mockHash).not.toHaveBeenCalledWith('client123',expect.anything());
  expect(mockQuery.mock.calls.map(([sql])=>sql).join('\n')).not.toContain("role = 'client'");
});
