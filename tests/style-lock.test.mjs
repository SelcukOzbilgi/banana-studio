import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { LocalWorkspace } from '../desktop/server/store.mjs';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
export * from './src/lib/styleLock/styleLock.ts';
export { buildForkTextGuidance, buildForkFinalPromptAddenda } from './src/lib/prompts/forkGuidance.ts';
export { buildSunburstGenerationPrompt } from './src/lib/images/imagePrompting.ts';` },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const m = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const settings = { imageModel: 'gpt-image-2.5-sunburst', aspectRatio: '1:1', resolution: '1K' };
const lock = { enabled: true, folderName: 'saidwho', paragraph: 'Warm 35mm film look, soft window light, muted earth palette (#8A5A44).', never: ['neon colours', 'watermarks'] };

test('an enabled lock is appended verbatim with its NEVER list to the final image prompt', () => {
  const final = m.buildSunburstGenerationPrompt('A ceramic mug on a table', [], { ...settings, styleLock: lock });
  assert.ok(final.includes('FOLDER STYLE LOCK · saidwho'));
  assert.ok(final.includes(lock.paragraph));
  assert.ok(final.includes('NEVER: neon colours; watermarks'));
  assert.ok(final.indexOf('CREATIVE BRIEF') < final.indexOf('FOLDER STYLE LOCK'));
  assert.doesNotMatch(final, /appends this block unchanged/);
});

test('disabled, empty or malformed locks change nothing', () => {
  const plain = m.buildSunburstGenerationPrompt('A ceramic mug on a table', [], settings);
  for (const styleLock of [{ ...lock, enabled: false }, { enabled: true, paragraph: '  ', never: [] }, 'enabled', { ...lock, enabled: 'true' }, null]) {
    assert.equal(m.buildSunburstGenerationPrompt('A ceramic mug on a table', [], { ...settings, styleLock }), plain);
  }
});

test('local edits never receive the style lock; text tasks get the text variant', () => {
  assert.equal(m.buildForkFinalPromptAddenda('Change the cup colour', { styleLock: lock }, true), '');
  const text = m.buildForkTextGuidance({ task: 'enhance', category: 'simple', brief: 'Mug', edit: false, youtube: false, settings: { styleLock: lock } });
  assert.match(text, /FOLDER STYLE LOCK · saidwho[\s\S]*appends this block unchanged/);
  assert.doesNotMatch(m.buildForkTextGuidance({ task: 'enhance', category: 'simple', brief: 'Mug', edit: true, youtube: false, settings: { styleLock: lock } }), /STYLE LOCK/);
});

test('style lock input is bounded and the NEVER list is one item per line', () => {
  assert.deepEqual(m.parseNeverList('- neon\n\n• Neon\n2) logos\n * blur '), ['neon', 'logos', 'blur']);
  const long = m.sanitizeStyleLock({ enabled: true, paragraph: 'x'.repeat(5000), never: Array.from({ length: 50 }, (_, i) => `item ${i} ${'y'.repeat(300)}`), folderName: 'f'.repeat(500) });
  assert.equal(long.paragraph.length, m.STYLE_LOCK_LIMITS.paragraph);
  assert.equal(long.never.length, m.STYLE_LOCK_LIMITS.neverItems);
  assert.ok(long.never.every(item => item.length <= m.STYLE_LOCK_LIMITS.neverItem));
  assert.equal(long.folderName.length, m.STYLE_LOCK_LIMITS.folderName);
  assert.equal(m.sanitizeStyleLock([lock]), undefined);
});

test('the local store saves, reads, clears and scopes style locks to existing folders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-style-lock-'));
  const workspace = new LocalWorkspace(dir);
  try {
    assert.equal(workspace.execute({ table: 'folders', operation: 'insert', value: { id: 'f1', name: 'saidwho' } }, false).error, null);
    workspace.execute({ table: 'folders', operation: 'insert', value: { id: 'f2', name: 'deneme' } }, false);
    assert.deepEqual(workspace.execute({ rpc: 'get_folder_style_locks' }, false).data, {});
    const saved = workspace.execute({ rpc: 'save_folder_style_lock', args: { p_folder_id: 'f1', p_lock: { enabled: true, paragraph: lock.paragraph, never: lock.never, extra: 'dropped' } } }, false);
    assert.equal(saved.error, null);
    assert.deepEqual({ ...saved.data, updatedAt: 0 }, { enabled: true, paragraph: lock.paragraph, never: lock.never, updatedAt: 0 });
    workspace.execute({ rpc: 'save_folder_style_lock', args: { p_folder_id: 'f2', p_lock: { enabled: false, paragraph: 'Pastel', never: [] } } }, false);
    // Reopen: settings survive a restart.
    workspace.close?.();
    const reopened = new LocalWorkspace(dir);
    const all = reopened.execute({ rpc: 'get_folder_style_locks' }, false).data;
    assert.deepEqual(Object.keys(all).sort(), ['f1', 'f2']);
    assert.equal(all.f2.enabled, false);
    // Unknown folder and malformed locks are refused without changing anything.
    assert.ok(reopened.execute({ rpc: 'save_folder_style_lock', args: { p_folder_id: 'missing', p_lock: { enabled: true, paragraph: 'x', never: [] } } }, false).error);
    assert.ok(reopened.execute({ rpc: 'save_folder_style_lock', args: { p_folder_id: 'f1', p_lock: 'x' } }, false).error);
    // Empty lock clears; deleted folders disappear from the list.
    assert.equal(reopened.execute({ rpc: 'save_folder_style_lock', args: { p_folder_id: 'f2', p_lock: { enabled: true, paragraph: '', never: [] } } }, false).data, null);
    reopened.execute({ table: 'folders', operation: 'delete', filters: [{ column: 'id', operator: 'eq', value: 'f1' }] }, false);
    assert.deepEqual(reopened.execute({ rpc: 'get_folder_style_locks' }, false).data, {});
    reopened.close?.();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
