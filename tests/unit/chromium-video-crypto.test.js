/** @test-kind unit @test-runner jest @test-requires none */
/**
 * @komerce-arch-lite
 * @role chromium-video-crypto-envelope-tests
 * @domain dashboard
 * @layer unit-test
 * @owner backend-core
 * @purpose Chiffrement à clé publique, intégrité et absence de déchiffrement avec mauvaise clé.
 * @impact-areas dashboard, staging-only
 */
'use strict';
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const os=require('os');
const {encryptBuffer,decryptBuffer,encryptFile}=require('../../scripts/recette/chromium-video-crypto');
describe('Chromium encrypted video/trace envelope',()=>{
 test('roundtrip with recipient private key',()=>{
  const kp=crypto.generateKeyPairSync('x25519');
  const pub=kp.publicKey.export({type:'spki',format:'pem'});
  const priv=kp.privateKey.export({type:'pkcs8',format:'pem'});
  const original=Buffer.from('webm-fixture-data-123');
  const cipher=encryptBuffer(original,pub);
  expect(cipher.includes(original)).toBe(false);
  expect(decryptBuffer(cipher,priv)).toEqual(original);
 });
 test('tampering or a different private key fails closed',()=>{
  const a=crypto.generateKeyPairSync('x25519'),b=crypto.generateKeyPairSync('x25519');
  const pub=a.publicKey.export({type:'spki',format:'pem'});
  const priv=b.privateKey.export({type:'pkcs8',format:'pem'});
  const cipher=encryptBuffer(Buffer.from('webm-encrypted'),pub);
  expect(()=>decryptBuffer(cipher,priv)).toThrow();
  cipher[cipher.length-1]^=1;
  expect(()=>decryptBuffer(cipher,a.privateKey.export({type:'pkcs8',format:'pem'}))).toThrow();
 });
 test('encryptFile removes original recording after ciphertext is saved',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'komerce-crypt-'));
  const a=crypto.generateKeyPairSync('x25519');
  const pub=a.publicKey.export({type:'spki',format:'pem'});
  try{
   const clear=path.join(temp,'record.webm'),out=path.join(temp,'artifacts/record.webm.enc');
   fs.writeFileSync(clear,'private-recording');
   encryptFile(clear,out,pub);
   expect(fs.existsSync(clear)).toBe(false);
   expect(fs.existsSync(out)).toBe(true);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
 });
});
