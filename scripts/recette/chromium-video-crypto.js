/**
 * @komerce-arch-lite
 * @role chromium-e2e-private-artifact-envelope
 * @domain dashboard
 * @layer script
 * @owner backend-core
 * @purpose Chiffrer les artefacts vidéos/traces authentifiés avant toute publication GitHub.
 * @impact-areas staging-only, dashboard
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const MAGIC = 'KOMERCE_CHROMIUM_ENC_V1\n';
const INFO = Buffer.from('komerce-staging-chromium-recording/v1');
const PUBLIC_KEY_PATH = path.join(__dirname, 'chromium-recording-public.pem');

function encryptBuffer(plain, recipientPem) {
  const pub = crypto.createPublicKey(recipientPem);
  if (pub.asymmetricKeyType !== 'x25519') throw Error('CHROMIUM_RECIPIENT_KEY_INVALID');
  const eph = crypto.generateKeyPairSync('x25519');
  const shared = crypto.diffieHellman({privateKey:eph.privateKey,publicKey:pub});
  const key = crypto.hkdfSync('sha256',shared,Buffer.alloc(0),INFO,32);
  const iv = crypto.randomBytes(12);
  const enc = crypto.createCipheriv('aes-256-gcm',key,iv);
  const cipherText=Buffer.concat([enc.update(plain),enc.final()]);
  const header={v:1,epk:eph.publicKey.export({type:'spki',format:'der'}).toString('base64'),iv:iv.toString('base64'),tag:enc.getAuthTag().toString('base64'),sha256:crypto.createHash('sha256').update(plain).digest('hex')};
  return Buffer.concat([Buffer.from(MAGIC+JSON.stringify(header)+'\n'),cipherText]);
}
function decryptBuffer(envelope, recipientPrivatePem) {
  if (!envelope.subarray(0,MAGIC.length).equals(Buffer.from(MAGIC))) throw Error('CHROMIUM_ENVELOPE_INVALID');
  const pos=envelope.indexOf(10,MAGIC.length);
  if (pos < 0 || pos-MAGIC.length>2048) throw Error('CHROMIUM_ENVELOPE_HEADER_INVALID');
  const h=JSON.parse(envelope.subarray(MAGIC.length,pos).toString('utf8'));
  if(h.v!==1)throw Error('CHROMIUM_ENVELOPE_VERSION');
  const priv=crypto.createPrivateKey(recipientPrivatePem);
  if(priv.asymmetricKeyType!=='x25519')throw Error('CHROMIUM_PRIVATE_KEY_INVALID');
  const publicKey=crypto.createPublicKey({key:Buffer.from(h.epk,'base64'),format:'der',type:'spki'});
  const shared=crypto.diffieHellman({privateKey:priv,publicKey});
  const key=crypto.hkdfSync('sha256',shared,Buffer.alloc(0),INFO,32);
  const dec=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(h.iv,'base64'));
  dec.setAuthTag(Buffer.from(h.tag,'base64'));
  const clear=Buffer.concat([dec.update(envelope.subarray(pos+1)),dec.final()]);
  if(crypto.createHash('sha256').update(clear).digest('hex')!==h.sha256)throw Error('CHROMIUM_ARTIFACT_DIGEST_MISMATCH');
  return clear;
}
function encryptFile(input,output,recipientPem=fs.readFileSync(PUBLIC_KEY_PATH,'utf8')) {
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,encryptBuffer(fs.readFileSync(input),recipientPem),{mode:0o600});
  // Never leave a decrypted video or trace in artifact directories.
  fs.rmSync(input,{force:true});
}
if(require.main===module){
  const [action,file,target,privateKeyPath]=process.argv.slice(2);
  if(action==='encrypt'&&file&&target)encryptFile(file,target);
  else if(action==='decrypt'&&file&&target&&privateKeyPath){
    fs.writeFileSync(target,decryptBuffer(fs.readFileSync(file),fs.readFileSync(privateKeyPath,'utf8')),{mode:0o600});
  }else{console.error('Usage: node chromium-video-crypto.js encrypt INPUT OUTPUT | decrypt INPUT.enc OUTPUT PRIVATE_KEY.pem');process.exitCode=2;}
}
module.exports={MAGIC,encryptBuffer,decryptBuffer,encryptFile};
