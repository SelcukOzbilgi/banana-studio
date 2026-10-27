import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { FORK_REPOSITORY } from './fork-identity.mjs';

const fail=()=>{throw new Error('Release signature or metadata verification failed.');};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const base64=(text,length)=>{
 if(typeof text!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(text))return fail();
 const bytes=Buffer.from(text,'base64');
 if(bytes.length!==length||bytes.toString('base64')!==text)return fail();
 return bytes;
};
const keyObject=publicKey=>createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),base64(publicKey,32)]),format:'der',type:'spki'});
const checkSignature=(bytes,signature,publicKey)=>{if(!verify(null,bytes,keyObject(publicKey),base64(signature,64)))fail();};

// Validate the exact signed-feed format produced by pinned Sparkle 2.10 tools.
// Signature verification operates on original bytes, before reading XML fields.
// This helper deliberately supports our single-release feed, not arbitrary RSS.
// Format reference: https://github.com/sparkle-project/Sparkle/blob/2.10.0/common_cli/Signing.swift
export function verifySignedFeed(bytes,publicKey) {
 if(!Buffer.isBuffer(bytes)||bytes.length>2*1024*1024)return fail();
 const marker=Buffer.from('<!-- sparkle-signatures:\n'),index=bytes.lastIndexOf(marker);
 if(index<0||bytes.indexOf(marker)!==index)return fail();
 const content=bytes.subarray(0,index),tail=bytes.subarray(index).toString('utf8');
 const block=tail.match(/^<!-- sparkle-signatures:\nedSignature: ([A-Za-z0-9+/]{86}==)\nlength: ([1-9][0-9]*)\n-->\n$/);
 if(!block||Number(block[2])!==content.length)return fail();
 checkSignature(content,block[1],publicKey);
 const xml=content.toString('utf8');
 if(!Buffer.from(xml).equals(content)||/<!DOCTYPE|<!ENTITY/i.test(xml))return fail();
 return xml;
}

const readFile=(file,limit)=>{
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.size<1||stat.size>limit)return fail();
 return fs.readFileSync(file);
};
const singleText=(xml,tag)=>{
 const matches=[...xml.matchAll(new RegExp(`<${tag}>([^<>]*)</${tag}>`,'g'))];
 if(matches.length!==1)return fail();
 return matches[0][1].trim();
};
export function verifyReleaseArtifacts({archivePath,feedPath,publicKey,version,build,architecture,sourceCommit,repository=FORK_REPOSITORY}) {
 if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)||!['arm64','x64'].includes(architecture)||!/^\d+$/.test(build)||!Number.isSafeInteger(Number(build))||Number(build)<1||!/^[a-f0-9]{40}$/.test(sourceCommit)||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))return fail();
 const archiveName=`Banana-Studio-${version}-macos-${architecture}.zip`,feedName=`appcast-${architecture}.xml`;
 if(path.basename(archivePath)!==archiveName||path.basename(feedPath)!==feedName)return fail();
 const feedBytes=readFile(feedPath,2*1024*1024),xml=verifySignedFeed(feedBytes,publicKey);
 if((xml.match(/<item\b/g)||[]).length!==1||!xml.includes('xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"')||singleText(xml,'sparkle:version')!==build||singleText(xml,'sparkle:shortVersionString')!==version||singleText(xml,'sparkle:minimumSystemVersion')!=='13.5.0')return fail();
 const item=xml.match(/<item>([\s\S]*?)<\/item>/)?.[1];
 if(!item||singleText(item,'link')!==`https://github.com/${repository}/commit/${sourceCommit}`)return fail();
 if(architecture==='arm64'&&singleText(xml,'sparkle:hardwareRequirements')!=='arm64')return fail();
 if(architecture==='x64'&&xml.includes('<sparkle:hardwareRequirements'))return fail();
 const enclosures=[...xml.matchAll(/<enclosure\b([^<>]*?)(?:\/>|>\s*<\/enclosure>)/g)];
 if(enclosures.length!==1||(xml.match(/<enclosure\b/g)||[]).length!==1)return fail();
 const entries=[...enclosures[0][1].matchAll(/([A-Za-z:]+)="([^"<>]*)"/g)];
 if(enclosures[0][1].replace(/([A-Za-z:]+)="([^"<>]*)"/g,'').trim()||entries.length!==4||new Set(entries.map(v=>v[1])).size!==4)return fail();
 const attrs=Object.fromEntries(entries.map(v=>[v[1],v[2]]));
 const url=`https://github.com/${repository}/releases/download/v${version}/${archiveName}`;
 if(attrs.url!==url||attrs.type!=='application/octet-stream'||!/^\d+$/.test(attrs.length)||!attrs['sparkle:edSignature'])return fail();
 const archive=readFile(archivePath,512*1024*1024);
 if(Number(attrs.length)!==archive.length)return fail();
 checkSignature(archive,attrs['sparkle:edSignature'],publicKey);
 return {version,build,architecture,sourceCommit,archive:archiveName,feed:feedName,archiveSha256:digest(archive),feedSha256:digest(feedBytes),signatureVerified:true};
}
