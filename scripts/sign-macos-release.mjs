import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { auditDistribution } from './audit-distribution.mjs';
import { verifyReleaseArtifacts } from './release-signatures.mjs';
import { FORK_REPOSITORY } from './fork-identity.mjs';

const root=path.resolve(import.meta.dirname,'..');
const run=(command,args,options={})=>execFileSync(command,args,{encoding:'utf8',maxBuffer:8*1024*1024,...options});
const readPlist=(app,key)=>run('/usr/libexec/PlistBuddy',['-c','Print :'+key,path.join(app,'Contents/Info.plist')]).trim();
const machoMagic=new Set(['feedface','feedfacf','cefaedfe','cffaedfe','cafebabe','bebafeca','cafebabf']);
export function signMacRelease(app,{community=false,prepare=false}={}) {
 const identity=process.env.BANANA_SIGNING_IDENTITY,profile=process.env.BANANA_NOTARY_PROFILE;
 if(!community&&(!identity||!profile))throw new Error('Developer ID and a Keychain notarization profile are required for a notarized release.');
 if(prepare&&!community)throw new Error('Preparation without update signatures is only supported for community builds.');
 if(readPlist(app,'BananaDevelopmentBuild')!=='false')throw new Error('A development app cannot be published as an official release.');
 const distribution=community?'community':'notarized',architecture=readPlist(app,'BananaArchitecture');
 if(readPlist(app,'BananaDistribution')!==distribution||!['arm64','x64'].includes(architecture))throw new Error('The app distribution type or architecture does not match the requested release.');
 const machine=run('/usr/bin/lipo',['-archs',path.join(app,'Contents/MacOS/BananaStudio')]).trim();
 if(machine!==(architecture==='arm64'?'arm64':'x86_64'))throw new Error('The executable does not match the app architecture.');
 if(!prepare&&run('git',['status','--porcelain'],{cwd:root}).trim())throw new Error('Commit and verify source changes before signing an official release.');
 const sourceCommit=run('git',['rev-parse','HEAD'],{cwd:root}).trim();
 if(readPlist(app,'BananaSourceCommit')!==sourceCommit)throw new Error('Rebuild the app from the current source commit before signing a release.');
 const privateMarkers=Object.entries(process.env).filter(([name,value])=>/(?:KEY|TOKEN|SECRET|PASSWORD)$/.test(name)&&value?.length>=16).map(([,value])=>value);
 const audit=auditDistribution(app,{privateMarkers});if(!audit.ok)throw new Error('App privacy audit failed. No release was produced.');
 const toolkit=path.join(root,'desktop/macos/.build/artifacts/sparkle/Sparkle/bin');
 const publicKey=readPlist(app,'SUPublicEDKey');
 const trackedPublicKey=fs.readFileSync(path.join(root,'desktop/macos/Resources/SparklePublicKey.txt'),'utf8').trim();
 if(publicKey!==trackedPublicKey)throw new Error('The app does not use the tracked update public key.');
 const files=[],containers=[];
 const visit=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);if(entry.isSymbolicLink())continue;
  if(entry.isDirectory()){visit(file);if(/\.(?:app|framework|xpc)$/.test(entry.name))containers.push(file);}
  else {const handle=fs.openSync(file,'r');const bytes=Buffer.alloc(4);fs.readSync(handle,bytes,0,4,0);fs.closeSync(handle);if(machoMagic.has(bytes.toString('hex')))files.push(file);}
 }};visit(app);
 const runtime=path.join(app,'Contents/Resources/runtime/node'),main=path.join(app,'Contents/MacOS/BananaStudio');
 for(const file of files.filter(file=>file!==main)){
  const args=community?['--force','--sign','-']:['--force','--options','runtime','--timestamp','--sign',identity];
  if(file===runtime){if(community)args.push('--options','runtime');args.push('--entitlements',path.join(root,'desktop/macos/Resources/Node.entitlements'));}
  else args.push('--preserve-metadata=identifier,entitlements');
  run('/usr/bin/codesign',[...args,file],{stdio:'inherit'});
 }
 for(const container of containers.sort((a,b)=>b.split(path.sep).length-a.split(path.sep).length))run('/usr/bin/codesign',[...(community?['--force','--sign','-']:['--force','--options','runtime','--timestamp','--sign',identity]),'--preserve-metadata=identifier,entitlements',container],{stdio:'inherit'});
 run('/usr/bin/codesign',community?['--force','--sign','-',app]:['--force','--options','runtime','--timestamp','--sign',identity,app],{stdio:'inherit'});
 run('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
 if(!auditDistribution(app,{privateMarkers}).ok)throw new Error('The final signed app failed its privacy audit.');
 if(prepare)return {app,distribution,architecture,sourceCommit,prepared:true,updateSignaturesPending:true};
 const signingPublicKey=run(path.join(toolkit,'generate_keys'),['--account','banana-studio','-p']).trim();
 if(publicKey!==signingPublicKey)throw new Error('The update signing account does not match this app public key.');
 const version=readPlist(app,'CFBundleShortVersionString'),build=readPlist(app,'CFBundleVersion');
 const directory=path.join(root,'release-artifacts',version);fs.mkdirSync(directory,{recursive:true});
 const filename=`Banana-Studio-${version}-macos-${architecture}.zip`,archive=path.join(directory,filename);
 const zip=()=>run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,archive]);zip();
 // Credentials are referenced by Keychain profile. Passwords/API keys never
 // appear in arguments, environment substitutions, app files or release notes.
 if(!community){
  const notarized=JSON.parse(run('/usr/bin/xcrun',['notarytool','submit',archive,'--keychain-profile',profile,'--wait','--output-format','json']));
  if(notarized.status!=='Accepted')throw new Error('Apple did not accept this release. The archive was not approved for publication.');
  run('/usr/bin/xcrun',['stapler','staple',app],{stdio:'inherit'});run('/usr/bin/xcrun',['stapler','validate',app],{stdio:'inherit'});
  run('/usr/sbin/spctl',['--assess','--type','execute','--verbose=2',app],{stdio:'inherit'});
  if(!auditDistribution(app,{privateMarkers}).ok)throw new Error('The final notarized app failed its privacy audit.');
  zip();
 }
 const signature=run(path.join(toolkit,'sign_update'),['--account','banana-studio','-p',archive]).trim();
 if(Buffer.from(signature,'base64').length!==64)throw new Error('The archive signature could not be verified.');
 const feed=path.join(directory,`appcast-${architecture}.xml`);
 const url=`https://github.com/${FORK_REPOSITORY}/releases/download/v${version}/${filename}`;
 fs.writeFileSync(feed,`<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Banana Studio</title><link>https://github.com/${FORK_REPOSITORY}</link><description>Signed Banana Studio updates</description><item><title>Banana Studio ${version}</title><link>https://github.com/${FORK_REPOSITORY}/commit/${sourceCommit}</link><sparkle:version>${build}</sparkle:version><sparkle:shortVersionString>${version}</sparkle:shortVersionString><sparkle:minimumSystemVersion>13.5.0</sparkle:minimumSystemVersion>${architecture==='arm64'?'<sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>':''}<pubDate>${new Date().toUTCString()}</pubDate><description>${community?'Community release. Apple notarization is not provided. ':'Application update. '}Your local data and Keychain entries stay on this Mac.</description><enclosure url="${url}" sparkle:edSignature="${signature}" length="${fs.statSync(archive).size}" type="application/octet-stream" /></item></channel></rss>\n`);
 run(path.join(toolkit,'sign_update'),['--account','banana-studio',feed]);
 const verified=verifyReleaseArtifacts({archivePath:archive,feedPath:feed,publicKey,version,build,architecture,sourceCommit});
 fs.writeFileSync(path.join(directory,`verification-${architecture}.json`),JSON.stringify({version,build,architecture,distribution,notarization:community?'NotRequested':'Accepted',signatureVerified:true,privacyAuditPassed:true,archive:filename,sourceCommit,archiveSha256:verified.archiveSha256,feedSha256:verified.feedSha256},null,2)+'\n');
 return {archive,feed,version,build};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
 const app=process.argv[2];if(!app)throw new Error('Pass the prepared app bundle path.');
 console.log(JSON.stringify(signMacRelease(path.resolve(app),{community:process.argv.includes('--community')}),null,2));
}
