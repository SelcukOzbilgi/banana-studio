import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Fork: YouTube data through Apify. All network calls are fakes; no paid run is made.
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outdir = path.join(root, '.build/test-bundles'); fs.mkdirSync(outdir, { recursive: true });
const outfile = path.join(outdir, `apify-${process.pid}.mjs`);
await build({ stdin: { resolveDir: root, loader: 'js', contents: `
export { apifyYouTube, toIsoDuration, toYouTubeVideo, clearApifyCache, APIFY_CHANNEL_VIDEOS, APIFY_HOURLY_ITEM_BUDGET } from './api/_lib/apifyYouTube.ts';
export { default as youtube } from './api/youtube.ts';
export { default as youtubeStatus } from './api/youtube-status.ts';
export { LOCAL_AUTH, setWorkspace } from './desktop/server/context.mjs';` },
  outfile, platform: 'node', target: 'node22', format: 'esm', bundle: true, packages: 'bundle', logLevel: 'silent',
  plugins: [{ name: 'local-auth', setup(b) { b.onResolve({ filter: /_lib\/auth\.(js|ts)$/ }, () => ({ path: path.join(root, 'desktop/server/auth.mjs') })); } }] });
const api = await import(pathToFileURL(outfile).href);
test.after(() => fs.rmSync(outfile, { force: true }));
api.setWorkspace({ user: { id: 'local-user' } });

const TOKEN = 'synthetic-apify-token-value';
const CHANNEL = 'UCabcdefghijklmnopqrstuv';
const video = (n, extra = {}) => ({ id: `vid${String(n).padStart(8, '0')}`, title: `Video ${n}`, text: `Description ${n}`, hashtags: ['#ai', 'agents'], channelName: 'Said Who',
  channelId: CHANNEL, channelAvatarUrl: 'https://yt3.example/avatar.jpg', date: '2026-09-01T10:00:00.000Z', duration: '00:12:05', viewCount: 1000 + n,
  thumbnailUrl: `https://i.ytimg.com/vi/vid${n}/maxresdefault.jpg`, type: 'video', ...extra });
const fakeApify = (respond) => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => { const target = new URL(String(url)); const input = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: target, headers: { ...options.headers }, redirect: options.redirect, input }); return respond(target, input); };
  return { calls, fetchImpl };
};

test('actor durations become the ISO 8601 form the client parses', () => {
  assert.equal(api.toIsoDuration('00:03:27'), 'PT3M27S');
  assert.equal(api.toIsoDuration('1:02:03'), 'PT1H2M3S');
  assert.equal(api.toIsoDuration('4:00'), 'PT4M');
  assert.equal(api.toIsoDuration('45'), 'PT45S');
  assert.equal(api.toIsoDuration('00:00:00'), 'PT0S');
  assert.equal(api.toIsoDuration(null), 'PT0S');
  assert.equal(api.toIsoDuration('PT3M'), 'PT0S');
  const mapped = api.toYouTubeVideo(video(1));
  assert.deepEqual(mapped.snippet.tags, ['ai', 'agents']);
  assert.equal(mapped.statistics.viewCount, '1001'); assert.equal(mapped.contentDetails.duration, 'PT12M5S');
  assert.equal(mapped.snippet.thumbnails.high.url, 'https://i.ytimg.com/vi/vid1/maxresdefault.jpg');
});

test('one bounded channel run serves channels, playlistItems and videos; the token stays in the header', async () => {
  api.clearApifyCache();
  const apify = fakeApify((url, input) => Response.json(input.startUrls[0].url.includes('/watch?v=') ? [video(99, { id: 'zzzzzzzzzzz' })] : Array.from({ length: 50 }, (_, i) => video(i))));
  const channel = await api.apifyYouTube('channels', { part: 'snippet,contentDetails', forHandle: '@SaidWho' }, TOKEN, apify.fetchImpl);
  assert.deepEqual(channel.items[0], { id: CHANNEL, snippet: { title: 'Said Who', thumbnails: { default: { url: 'https://yt3.example/avatar.jpg' } } },
    contentDetails: { relatedPlaylists: { uploads: `UU${CHANNEL.slice(2)}` } } });
  const run = apify.calls[0];
  assert.equal(run.url.origin + run.url.pathname, 'https://api.apify.com/v2/acts/streamers~youtube-scraper/run-sync-get-dataset-items');
  assert.equal(run.headers.Authorization, `Bearer ${TOKEN}`); assert.ok(!run.url.href.includes(TOKEN)); assert.equal(run.redirect, 'error');
  assert.equal(run.url.searchParams.get('maxItems'), String(api.APIFY_CHANNEL_VIDEOS));
  assert.ok(Number(run.url.searchParams.get('maxTotalChargeUsd')) <= 0.3);
  assert.deepEqual(run.input, { startUrls: [{ url: 'https://www.youtube.com/@SaidWho/videos' }], maxResults: 50, maxResultsShorts: 0, maxResultStreams: 0, sortVideosBy: 'NEWEST' });
  // Paging and details come from the cache: no further runs.
  const first = await api.apifyYouTube('playlistItems', { part: 'contentDetails', playlistId: `UU${CHANNEL.slice(2)}`, maxResults: '20' }, TOKEN, apify.fetchImpl);
  assert.equal(first.items.length, 20); assert.equal(first.nextPageToken, 'apify:20');
  const last = await api.apifyYouTube('playlistItems', { playlistId: `UU${CHANNEL.slice(2)}`, maxResults: '50', pageToken: 'apify:40' }, TOKEN, apify.fetchImpl);
  assert.equal(last.items.length, 10); assert.equal(last.nextPageToken, undefined);
  const details = await api.apifyYouTube('videos', { part: 'snippet,contentDetails,statistics', id: first.items.slice(0, 3).map(item => item.contentDetails.videoId).join(',') }, TOKEN, apify.fetchImpl);
  assert.deepEqual(details.items.map(item => item.snippet.title), ['Video 0', 'Video 1', 'Video 2']);
  await api.apifyYouTube('channels', { forHandle: '@saidwho' }, TOKEN, apify.fetchImpl);
  assert.equal(apify.calls.length, 1, 'cached channel lookups are free');
  // An unknown video costs one run for just that video.
  const single = await api.apifyYouTube('videos', { id: 'zzzzzzzzzzz' }, TOKEN, apify.fetchImpl);
  assert.equal(single.items[0].id, 'zzzzzzzzzzz'); assert.equal(apify.calls.length, 2);
  assert.deepEqual(apify.calls[1].input.startUrls, [{ url: 'https://www.youtube.com/watch?v=zzzzzzzzzzz' }]);
  assert.equal(apify.calls[1].url.searchParams.get('maxItems'), '1');
});

test('unknown channels return no items, channel search maps the first result, errors are clear', async () => {
  api.clearApifyCache();
  let apify = fakeApify(() => Response.json([]));
  assert.deepEqual(await api.apifyYouTube('channels', { id: 'UCzzzzzzzzzzzzzzzzzzzzzz' }, TOKEN, apify.fetchImpl), { items: [] });
  apify = fakeApify(() => Response.json([video(1)]));
  assert.deepEqual(await api.apifyYouTube('search', { part: 'snippet', q: 'said who', type: 'channel', maxResults: '1' }, TOKEN, apify.fetchImpl), { items: [{ snippet: { channelId: CHANNEL } }] });
  assert.deepEqual(apify.calls[0].input.searchQueries, ['said who']);
  await assert.rejects(api.apifyYouTube('search', { q: 'x', type: 'video' }, TOKEN, apify.fetchImpl), /Only channel search/);
  await assert.rejects(api.apifyYouTube('playlistItems', { playlistId: 'PL123' }, TOKEN, apify.fetchImpl), /upload lists/);
  apify = fakeApify(() => Response.json({ error: { message: 'bad token' } }, { status: 401 }));
  await assert.rejects(api.apifyYouTube('channels', { forHandle: 'x' }, TOKEN, apify.fetchImpl), /rejected the token/);
  apify = fakeApify(() => Response.json({ error: { message: 'no money' } }, { status: 402 }));
  await assert.rejects(api.apifyYouTube('channels', { forHandle: 'y' }, TOKEN, apify.fetchImpl), /insufficient credit/);
});

const call = async (handler, method, body) => {
  let status = 0, result; const res = { status(v) { status = v; return this; }, json(v) { result = v; return this; }, setHeader() {}, end() { return this; } };
  const req = { method, body, headers: {} }; req[api.LOCAL_AUTH] = true; await handler(req, res); return { status, result };
};
const withEnv = async (env, fn) => {
  const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) { if (value == null) delete process.env[key]; else process.env[key] = value; }
  try { return await fn(); } finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
};

test('the proxy uses Apify when the token exists and the Google key path otherwise; status names the source', async () => {
  const oldFetch = globalThis.fetch; const hosts = [];
  globalThis.fetch = async (url, options) => { const target = new URL(String(url)); hosts.push(target.hostname);
    return target.hostname === 'api.apify.com' ? Response.json([video(1)]) : Response.json({ items: [{ id: CHANNEL, snippet: { title: 'Google' } }] }); };
  try {
    api.clearApifyCache();
    await withEnv({ APIFY_TOKEN: TOKEN, YOUTUBE_API_KEY: 'google-key' }, async () => {
      const response = await call(api.youtube, 'POST', { endpoint: 'channels', params: { forHandle: '@a' } });
      assert.equal(response.status, 200); assert.equal(response.result.items[0].snippet.title, 'Said Who');
      assert.deepEqual((await call(api.youtubeStatus, 'GET')).result, { configured: true, source: 'apify' });
    });
    await withEnv({ APIFY_TOKEN: null, YOUTUBE_API_KEY: 'google-key' }, async () => {
      const response = await call(api.youtube, 'POST', { endpoint: 'channels', params: { forHandle: '@a' } });
      assert.equal(response.result.items[0].snippet.title, 'Google');
      assert.deepEqual((await call(api.youtubeStatus, 'GET')).result, { configured: true, source: 'google' });
    });
    await withEnv({ APIFY_TOKEN: null, YOUTUBE_API_KEY: null }, async () => {
      assert.deepEqual((await call(api.youtubeStatus, 'GET')).result, { configured: false, source: null });
    });
    assert.deepEqual(hosts, ['api.apify.com', 'www.googleapis.com']);
  } finally { globalThis.fetch = oldFetch; }
});

test('misses are cached and an hourly item budget stops runaway paid runs', async () => {
  api.clearApifyCache();
  let apify = fakeApify(() => Response.json([]));
  for (let i = 0; i < 3; i++) await api.apifyYouTube('channels', { forHandle: '@nobody' }, TOKEN, apify.fetchImpl);
  for (let i = 0; i < 3; i++) await api.apifyYouTube('playlistItems', { playlistId: 'UUzzzzzzzzzzzzzzzzzzzzzz' }, TOKEN, apify.fetchImpl);
  for (let i = 0; i < 3; i++) assert.deepEqual(await api.apifyYouTube('videos', { id: 'aaaaaaaaaaa' }, TOKEN, apify.fetchImpl), { items: [] });
  for (let i = 0; i < 3; i++) await api.apifyYouTube('search', { q: 'nobody', type: 'channel' }, TOKEN, apify.fetchImpl);
  assert.equal(apify.calls.length, 4, 'one run per distinct miss');
  api.clearApifyCache();
  apify = fakeApify(() => Response.json([]));
  const handles = Array.from({ length: Math.floor(api.APIFY_HOURLY_ITEM_BUDGET / api.APIFY_CHANNEL_VIDEOS) }, (_, i) => `@c${i}`);
  for (const forHandle of handles) await api.apifyYouTube('channels', { forHandle }, TOKEN, apify.fetchImpl);
  await assert.rejects(api.apifyYouTube('channels', { forHandle: '@one-more' }, TOKEN, apify.fetchImpl), /hourly Apify lookup budget.*no request was sent/);
  assert.equal(apify.calls.length, handles.length);
  api.clearApifyCache();
});
