import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, verify as verifySignature } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { verifyReleaseArtifacts } from './release-signatures.mjs';
import { signMacRelease } from './sign-macos-release.mjs';

// An isolated trust test. The ephemeral signing seed stays in memory and is
// passed through stdin. No maintainer key or Keychain access is involved.
const root=path.resolve(import.meta.dirname,'..');
const toolkit=path.join(root,'desktop/macos/.build/artifacts/sparkle/Sparkle/bin');
const pair=generateKeyPairSync('ed25519');
const seed=pair.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32);
const tool=path.join(toolkit,'sign_update');
const options=()=>({input:seed.toString('base64')+'\n',encoding:'utf8',timeout:15_000,stdio:['pipe','pipe','pipe']});
const run=args=>{try{return execFileSync(tool,['--ed-key-file','-',...args],options()).trim();}catch{throw new Error('Sparkle could not sign the synthetic fixture.');}};
const verify=(file,signature)=>{
 const result=spawnSync(tool,['--ed-key-file','-','--verify',file,...(signature?[signature]:[])],options());
 if(result.error)throw new Error('The Sparkle signature verifier could not run.');
 return result.status===0;
};
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'banana-update-trust-'));
try {
 const version='0.1.0',build='1',architecture=process.arch,sourceCommit='f'.repeat(40);
 const archiveName=`Banana-Studio-${version}-macos-${architecture}.zip`;
 const archive=path.join(temporary,archiveName);
 fs.writeFileSync(archive,Buffer.from('synthetic update bytes; no application or user data'));
 const signature=run(['-p',archive]);
 assert.equal(Buffer.from(signature,'base64').length,64);
 assert.ok(verifySignature(null,fs.readFileSync(archive),pair.publicKey,Buffer.from(signature,'base64')),'The archive must also verify independently with Node crypto.');
 assert.ok(verify(archive,signature),'An unchanged signed archive must verify.');
 const archiveBytes=fs.readFileSync(archive);fs.appendFileSync(archive,'tampered');
 assert.equal(verify(archive,signature),false,'A changed archive must be rejected.');
 fs.writeFileSync(archive,archiveBytes);
 const feed=path.join(temporary,`appcast-${architecture}.xml`);
 fs.writeFileSync(feed,`<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Synthetic update trust test</title><item><link>https://github.com/SelcukOzbilgi/banana-studio/commit/${sourceCommit}</link><sparkle:version>${build}</sparkle:version><sparkle:shortVersionString>${version}</sparkle:shortVersionString><sparkle:minimumSystemVersion>13.5.0</sparkle:minimumSystemVersion>${architecture==='arm64'?'<sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>':''}<enclosure url="https://github.com/SelcukOzbilgi/banana-studio/releases/download/v${version}/${archiveName}" length="${archiveBytes.length}" type="application/octet-stream" sparkle:edSignature="${signature}" /></item></channel></rss>\n`);
 run([feed]);
 assert.ok(verify(feed),'An unchanged signed feed must verify.');
 const publicKey=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
 assert.equal(verifyReleaseArtifacts({archivePath:archive,feedPath:feed,publicKey,version,build,architecture,sourceCommit}).signatureVerified,true,'The read-only public-key verifier must accept the actual Sparkle tool output.');
 fs.writeFileSync(feed,fs.readFileSync(feed,'utf8').replace('Synthetic update trust test','Altered update information'));
 assert.equal(verify(feed),false,'Changed feed content must be rejected.');
 const previous={identity:process.env.BANANA_SIGNING_IDENTITY,profile:process.env.BANANA_NOTARY_PROFILE};
 try {
  process.env.BANANA_SIGNING_IDENTITY='synthetic-identity';process.env.BANANA_NOTARY_PROFILE='synthetic-profile';
  const developmentApp=path.join(temporary,'Development.app');fs.mkdirSync(path.join(developmentApp,'Contents'),{recursive:true});
  fs.writeFileSync(path.join(developmentApp,'Contents/Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>BananaDevelopmentBuild</key><true/></dict></plist>');
  for(const community of [false,true])assert.throws(()=>signMacRelease(developmentApp,{community}),/development app cannot be published/,'A development app must never pass either release gate.');
 } finally {
  for(const [name,value] of [['BANANA_SIGNING_IDENTITY',previous.identity],['BANANA_NOTARY_PROFILE',previous.profile]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}
 }
 console.log('Sparkle archive/feed signatures verified independently; tampered files and development releases were rejected. No update was published.');
} finally { seed.fill(0); fs.rmSync(temporary,{recursive:true,force:true}); }
