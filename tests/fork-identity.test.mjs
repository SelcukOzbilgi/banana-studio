import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FORK_REPOSITORY, UPSTREAM_SPARKLE_PUBLIC_KEY, assertForkUpdateChannel, feedUrl } from '../scripts/fork-identity.mjs';

const root=path.resolve(import.meta.dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('release packaging refuses upstream Sparkle key while development builds still package',()=>{
 assert.throws(()=>assertForkUpdateChannel({development:false,publicKey:UPSTREAM_SPARKLE_PUBLIC_KEY+'\n'}),/no Sparkle signing key of its own/);
 assert.doesNotThrow(()=>assertForkUpdateChannel({development:true,publicKey:UPSTREAM_SPARKLE_PUBLIC_KEY}));
 assert.doesNotThrow(()=>assertForkUpdateChannel({development:false,publicKey:Buffer.alloc(32,7).toString('base64')}));
});

test('update feed and app identity point at the fork, not upstream',()=>{
 assert.equal(FORK_REPOSITORY,'SelcukOzbilgi/banana-studio');
 assert.equal(feedUrl('arm64'),'https://github.com/SelcukOzbilgi/banana-studio/releases/latest/download/appcast-arm64.xml');
 const packager=read('scripts/package-macos.mjs');
 assert.match(packager,/<key>CFBundleIdentifier<\/key><string>io\.github\.selcukozbilgi\.bananastudio<\/string>/);
 assert.match(packager,/<key>SUFeedURL<\/key><string>\$\{feedUrl\(process\.arch\)\}<\/string>/);
 assert.doesNotMatch(packager,/orkunisitmak/);
 assert.match(read('desktop/macos/Sources/BananaStudio/KeyVault.swift'),/static let service = "io\.github\.selcukozbilgi\.bananastudio\.provider-keys"/);
});
