import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { seedanceProviderError } from '../src/lib/video/seedanceProviders.ts';
import { LocalWorkspace } from '../desktop/server/store.mjs';
import { createMediaUploader } from '../desktop/server/uploads.mjs';

// Fork: Wiro Seedance video. Every network call is a fake; no paid request is made.
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const replacements = { auth: 'auth.mjs', openaiGuard: 'guard.mjs', imageJobQueue: 'queue.mjs', providerMedia: 'providerMedia.mjs', rasterCodec: 'rasterCodec.mjs' };
const outdir = path.join(root, '.build/test-bundles'); fs.mkdirSync(outdir, { recursive: true });
const outfile = path.join(outdir, `wiro-video-${process.pid}.mjs`);
await build({ stdin: { resolveDir: root, loader: 'js', contents: `
export { default as seedanceVideo } from './api/seedance-video.ts';
export { wiroVideoRequest, wiroVideoRunBody, wiroVideoPrompt } from './api/_lib/wiroVideo.ts';
export { setWorkspace, LOCAL_AUTH } from './desktop/server/context.mjs';` },
  outfile, platform: 'node', target: 'node22', format: 'esm', bundle: true, packages: 'bundle', external: ['sharp'], logLevel: 'silent',
  banner: { js: "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);" },
  plugins: [{ name: 'local-workspace-boundary', setup(b) { b.onResolve({ filter: /(auth|openaiGuard|imageJobQueue|providerMedia|rasterCodec)\.(js|ts)$/ }, args => {
    const resolved = path.resolve(args.resolveDir, args.path); if (path.dirname(resolved) !== path.join(root, 'api/_lib')) return;
    return { path: path.join(root, 'desktop/server', replacements[path.basename(args.path).replace(/\.(js|ts)$/, '')]) };
  }); } }] });
const api = await import(pathToFileURL(outfile).href);
test.after(() => fs.rmSync(outfile, { force: true }));

const KEY = 'synthetic-wiro-key', SECRET = 'synthetic-wiro-secret-value';
const MP4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');
const PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const request = (extra = {}) => ({ provider: 'wiro', videoModel: 'seedance-2.0', mode: 'text_to_video', prompt: 'A slow push-in on a lighthouse at dusk', duration: 5, quality: '720p', aspectRatio: '16:9', generateAudio: false, ...extra });
const detail = (status, pexit, extra = {}) => ({ result: true, errors: [], tasklist: [{ id: '9001', status, pexit, totalcost: '0.420000', elapsedseconds: '61.0',
  outputs: status === 'task_postprocess_end' && pexit === '0' ? [{ contenttype: 'video/mp4', url: 'https://cdn1.wiro.ai/v/9001.mp4', size: String(MP4.length) }] : [], ...extra }] });

async function harness(fn) {
  const old = { k: process.env.WIRO_API_KEY, s: process.env.WIRO_API_SECRET, u: process.env.SUPABASE_URL, f: globalThis.fetch };
  process.env.WIRO_API_KEY = KEY; process.env.WIRO_API_SECRET = SECRET; process.env.SUPABASE_URL = 'http://127.0.0.1:9';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-wiro-video-'));
  let store = new LocalWorkspace(path.join(dir, 'data')); api.setWorkspace(store);
  const calls = []; let script = () => { throw new Error('Unexpected network request blocked by test'); };
  globalThis.fetch = async (url, options = {}) => {
    const target = new URL(String(url));
    const body = options.body instanceof FormData ? Object.fromEntries([...options.body.keys()].map(key => [key, options.body.getAll(key).map(v => typeof v === 'string' ? v : `file:${v.type}:${v.size}`)]))
      : options.body ? JSON.parse(options.body) : undefined;
    calls.push({ host: target.hostname, path: target.pathname, headers: { ...options.headers }, redirect: options.redirect, body });
    return script(target, body);
  };
  const call = async (method, input) => {
    let status = 0, result; const res = { status(v) { status = v; return this; }, json(v) { result = v; return this; }, setHeader() {}, end() { return this; } };
    const req = method === 'GET' ? { method, query: { taskId: input }, headers: {} } : { method, body: input, query: {}, headers: {} };
    req[api.LOCAL_AUTH] = true;
    await api.seedanceVideo(req, res); return { status, result };
  };
  const pending = id => store.put('generations', id, { id, user_id: store.user.id, type: 'video', status: 'pending', task_id: '', url: '', metadata: { videoModel: 'seedance-2.0' }, created_at: Date.now() });
  try {
    await fn({ get store() { return store; }, reopen() { store.close(); store = new LocalWorkspace(path.join(dir, 'data')); api.setWorkspace(store); return store; },
      calls, setScript: value => { script = value; }, call, pending });
  } finally {
    globalThis.fetch = old.f; store.close(); fs.rmSync(dir, { recursive: true, force: true });
    for (const [name, value] of [['WIRO_API_KEY', old.k], ['WIRO_API_SECRET', old.s], ['SUPABASE_URL', old.u]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
}

test('Wiro video validation rejects what Wiro Seedance cannot do and accepts the rest', () => {
  for (const body of [request(), request({ mode: 'image_to_video', imageUrls: ['a', 'b'] }), request({ mode: 'reference_to_video', imageUrls: ['a'], audioUrls: ['x'] }),
    request({ videoModel: 'seedance-2.5', duration: 30, quality: '1080p', aspectRatio: 'adaptive' })]) assert.equal(seedanceProviderError('wiro', body), undefined);
  assert.match(seedanceProviderError('wiro', request({ mode: 'reference_to_video', videoUrls: ['v'] })), /video references, Edit or Extend/);
  assert.match(seedanceProviderError('wiro', request({ videoModel: 'seedance-2.5', mode: 'video_edit', videoUrls: ['v'] })), /Edit or Extend/);
  assert.match(seedanceProviderError('wiro', request({ videoModel: 'seedance-2.5', duration: -1 })), /fixed duration \(4–30 seconds\)/);
  assert.match(seedanceProviderError('wiro', request({ videoModel: 'seedance-2.5', mode: 'reference_to_video', imageUrls: ['a'], audioUrls: ['x'] })), /does not accept reference audio/);
  assert.match(seedanceProviderError('wiro', request({ mode: 'reference_to_video', audioUrls: ['x'], videoUrls: [] , imageUrls: [] })), /References mode needs an image or video|needs at least one reference image/);
  assert.match(seedanceProviderError('wiro', request({ referenceEditMode: true, mode: 'reference_to_video', imageUrls: ['a'] })), /Edit or Extend/);
});

test('requests map to Wiro schema fields; @ image tokens become [Image n]', () => {
  const i2v = api.wiroVideoRequest(request({ mode: 'image_to_video', imageUrls: [PNG_URL, 'https://cdn.example/last.png'], prompt: 'Only the waves move. @IMAGE_1', generateAudio: true }));
  assert.equal(i2v.slug, 'bytedance/seedance-2-0');
  assert.deepEqual(i2v.fields, { prompt: 'Only the waves move. [Image 1]', resolution: '720p', ratio: '16:9', duration: '5', generateAudio: 'true' });
  assert.deepEqual(i2v.files.map(f => f.field), ['inputImage', 'inputImageLast']);
  const r2v = api.wiroVideoRequest(request({ videoModel: 'seedance-2.5', mode: 'reference_to_video', imageUrls: [PNG_URL, PNG_URL] }));
  assert.equal(r2v.slug, 'bytedance/seedance-2-5');
  assert.deepEqual(r2v.files.map(f => f.field), ['inputImageReference', 'inputImageReference']);
  const form = api.wiroVideoRunBody(i2v);
  assert.ok(form instanceof FormData);
  assert.equal(form.getAll('inputImage')[0].type, 'image/png');
  assert.equal(form.get('inputImageLast'), 'https://cdn.example/last.png');
  assert.deepEqual(api.wiroVideoRunBody(api.wiroVideoRequest(request())), api.wiroVideoRequest(request()).fields);
  assert.throws(() => api.wiroVideoRunBody({ ...i2v, files: [{ field: 'inputImage', value: 'http://127.0.0.1/x.png' }] }), /could not be prepared/);
});

test('local media goes to Wiro as data URLs; reference videos are refused before any paid call', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-wiro-upload-'));
  const store = new LocalWorkspace(dir);
  try {
    await store.upload('u/frame.png', Buffer.from(PNG_URL.split(',')[1], 'base64'));
    await store.upload('u/clip.mp4', MP4);
    const fetchImpl = async () => { throw new Error('no network expected'); };
    const prepare = createMediaUploader(store, { fetchImpl });
    const prepared = await prepare('wiro', { prompt: 'p', imageUrls: [store.mediaUrl('u/frame.png')] });
    assert.match(prepared.imageUrls[0], /^data:image\/png;base64,/);
    await assert.rejects(prepare('wiro', { videoUrls: [store.mediaUrl('u/clip.mp4')] }), /Wiro video references must be/);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submit: one signed Run, task saved on the generation before replying, secret never sent', async () => harness(async h => {
  h.pending('vid-1');
  h.setScript(url => { if (url.pathname === '/v1/Run/bytedance/seedance-2-0') return Response.json({ result: true, errors: [], taskid: '9001' }); throw new Error('unexpected'); });
  const { status, result } = await h.call('POST', request({ generationId: 'vid-1', mode: 'image_to_video', imageUrls: [PNG_URL], prompt: 'Only the hair moves; locked camera.' }));
  assert.equal(status, 200);
  assert.deepEqual({ ...result }, { taskId: 'bs_wiro_seedance-2.0_9001', provider: 'wiro', endpoint: 'bytedance/seedance-2-0', wiroTaskId: '9001', taskSaved: true });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].body.inputImage, ['file:image/png:70']);
  assert.equal(h.calls[0].body.duration[0], '5');
  assert.equal(h.calls[0].headers['x-api-key'], KEY); assert.ok(h.calls[0].headers['x-signature']);
  assert.ok(!JSON.stringify(h.calls).includes(SECRET));
  const row = h.store.get('generations', 'vid-1');
  assert.equal(row.task_id, 'bs_wiro_seedance-2.0_9001'); assert.equal(row.status, 'processing');
  assert.deepEqual([row.metadata.generationProvider, row.metadata.providerTaskId, row.metadata.providerModel, row.metadata.videoModel], ['wiro', '9001', 'bytedance/seedance-2-0', 'seedance-2.0']);
  assert.ok(h.store.get('provider_tasks', 'wiro:bs_wiro_seedance-2.0_9001'));
}));

test('submit: at most two Wiro videos render at once; a rejected Run says no video was started', async () => harness(async h => {
  for (const id of ['a', 'b']) h.store.put('generations', id, { id, user_id: h.store.user.id, type: 'video', status: 'processing', task_id: `bs_wiro_seedance-2.0_${id}`, metadata: {}, created_at: Date.now() });
  h.setScript(() => { throw new Error('Run must not be called'); });
  // Untracked submissions are refused before the paid call.
  let response = await h.call('POST', request({ generationId: 'not-saved' }));
  assert.equal(response.status, 400); assert.match(response.result.error, /not saved yet.*No request was sent/);
  assert.equal((await h.call('POST', request())).status, 400);
  h.pending('vid-cap');
  response = await h.call('POST', request({ generationId: 'vid-cap' }));
  assert.equal(response.status, 429); assert.match(response.result.error, /no request was sent/); assert.equal(h.calls.length, 0);
  h.store.put('generations', 'b', { ...h.store.get('generations', 'b'), status: 'completed' });
  h.setScript(() => Response.json({ result: false, errors: [{ message: 'insufficient balance' }] }, { status: 400 }));
  response = await h.call('POST', request({ generationId: 'vid-cap' }));
  assert.equal(response.status, 400); assert.match(response.result.error, /insufficient balance.*No Wiro video was started/);
  response = await h.call('POST', request({ generationId: 'vid-cap', videoModel: 'seedance-2.5', duration: -1 }));
  assert.equal(response.status, 400); assert.match(response.result.error, /fixed duration/);
  assert.equal(h.calls.length, 1, 'validation errors never reach Wiro');
}));

test('status: running, then success copies the video locally with the actual cost; recovery after restart never calls Run', async () => harness(async h => {
  h.pending('vid-2');
  let finished = false, downloads = 0;
  h.setScript(url => {
    if (url.pathname.startsWith('/v1/Run/')) return Response.json({ result: true, errors: [], taskid: '9001' });
    if (url.pathname === '/v1/Task/Detail') return Response.json(finished ? detail('task_postprocess_end', '0') : detail('task_start', ''));
    if (url.hostname === 'cdn1.wiro.ai') { downloads++; return new Response(MP4, { headers: { 'content-type': 'video/mp4' } }); }
    throw new Error('unexpected');
  });
  const { result: submitted } = await h.call('POST', request({ generationId: 'vid-2' }));
  let response = await h.call('GET', submitted.taskId);
  assert.deepEqual(response.result, { status: 'RUNNING', progress: 0.05 });
  // Simulate a crash/restart: only the saved task ID survives.
  h.reopen(); finished = true;
  assert.equal(h.store.get('generations', 'vid-2').task_id, submitted.taskId);
  response = await h.call('GET', submitted.taskId);
  assert.equal(response.result.status, 'SUCCEEDED'); assert.equal(response.result.actualCostUsd, 0.42);
  assert.match(response.result.output[0], /^http:\/\/127\.0\.0\.1\/storage\/v1\/object\/authenticated\/media\/.+\/wiro-video\/9001\.mp4$/);
  response = await h.call('GET', submitted.taskId);
  assert.equal(response.result.status, 'SUCCEEDED'); assert.equal(downloads, 1, 'the finished file is copied once');
  assert.equal(h.calls.filter(c => c.path.startsWith('/v1/Run/')).length, 1, 'the paid Run happened exactly once');
  assert.ok(h.calls.filter(c => c.host === 'cdn1.wiro.ai').every(c => c.redirect === 'error'));
}));

test('status: a failed Wiro task is terminal and says it was not billed; unknown or foreign task IDs are refused', async () => harness(async h => {
  h.pending('vid-3');
  h.setScript(url => url.pathname.startsWith('/v1/Run/') ? Response.json({ result: true, taskid: '9001' })
    : Response.json(detail('task_postprocess_end', '1', { debugerror: 'Content policy rejected the first frame.' })));
  const { result: submitted } = await h.call('POST', request({ generationId: 'vid-3' }));
  const response = await h.call('GET', submitted.taskId);
  assert.equal(response.result.status, 'FAILED'); assert.match(response.result.error, /Content policy rejected.*does not bill failed tasks/);
  assert.equal((await h.call('GET', 'bs_wiro_seedance-2.0_unknown')).status, 404);
  assert.equal((await h.call('GET', 'bs_wiro_minimax-h3_9001')).status, 400);
}));
