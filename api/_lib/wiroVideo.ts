/** Fork: Wiro as a Seedance video provider. One paid Run per submission, then
 * free Task/Detail checks. Local media reaches this module as data URLs and is
 * sent as multipart files; Wiro cannot read loopback URLs. Field names come
 * from Wiro's model schemas (bytedance/seedance-2-0, bytedance/seedance-2-5),
 * read with the free schema tool on 2026-10-30. */
import { isWiroOutputUrl, parseWiroTask, wiroPost, WiroError } from './wiro.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SeedanceRequest } from '../../src/lib/video/seedanceProviders.js';
import { createUserScopedClient } from './auth.js';
import { prepareTaskRegistry, registerProviderTask, requireProviderTask } from './providerTasks.js';
import { signedMediaUrl } from './imageStorage.js';

type FetchLike = typeof fetch;
export const WIRO_VIDEO_SLUGS: Record<string, string> = { 'seedance-2.0': 'bytedance/seedance-2-0', 'seedance-2.5': 'bytedance/seedance-2-5' };
export const WIRO_VIDEO_MAX_ACTIVE = 2;
const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
const DATA_URL = /^data:((?:image\/(?:png|jpeg|webp))|(?:audio\/(?:mpeg|wav|x-wav|mp3)));base64,([a-zA-Z0-9+/=]+)$/;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };

/** Wiro's Seedance prompts refer to images as "[Image 1]". */
export const wiroVideoPrompt = (prompt = '') => prompt.replace(/@(?:REF[_ ]?)?IMAGE[_ ]?(\d+)/gi, '[Image $1]').replace(/@AUDIO[_ ]?(\d+)/gi, '[Audio $1]');

export type WiroVideoRequest = { slug: string; fields: Record<string, string>; files: { field: string; value: string }[] };
/** Maps an already validated request (see seedanceProviderError) to Wiro inputs. */
export function wiroVideoRequest(body: SeedanceRequest): WiroVideoRequest {
  const slug = WIRO_VIDEO_SLUGS[body.videoModel];
  if (!slug) throw new WiroError('Unsupported Wiro video model.');
  const fields: Record<string, string> = { prompt: wiroVideoPrompt(body.prompt), resolution: body.quality, ratio: body.aspectRatio,
    duration: String(body.duration), generateAudio: body.generateAudio === false ? 'false' : 'true' };
  const files: WiroVideoRequest['files'] = [];
  const images = body.imageUrls || [];
  if (body.mode === 'image_to_video') {
    files.push({ field: 'inputImage', value: images[0] });
    if (images[1]) files.push({ field: 'inputImageLast', value: images[1] });
  } else if (body.mode === 'reference_to_video') {
    for (const image of images) files.push({ field: 'inputImageReference', value: image });
    for (const audio of body.audioUrls || []) files.push({ field: 'inputAudio', value: audio });
  }
  return { slug, fields, files };
}

/** JSON without media; otherwise multipart with one entry per file (same field repeated). */
export function wiroVideoRunBody(request: WiroVideoRequest): Record<string, string> | FormData {
  if (!request.files.length) return request.fields;
  const form = new FormData();
  for (const [key, value] of Object.entries(request.fields)) form.append(key, value);
  request.files.forEach(({ field, value }, index) => {
    const data = DATA_URL.exec(value);
    if (data) form.append(field, new Blob([Buffer.from(data[2], 'base64')], { type: data[1] }), `${field}-${index + 1}.${EXT[data[1]]}`);
    else if (/^https:\/\//.test(value)) form.append(field, value);
    else throw new WiroError('This reference could not be prepared for Wiro.');
  });
  return form;
}

/** The paid call. Returns Wiro's raw task ID. */
export async function submitWiroVideo(body: SeedanceRequest, options: { fetchImpl?: FetchLike } = {}): Promise<{ taskId: string; slug: string }> {
  const request = wiroVideoRequest(body);
  const [owner, project] = request.slug.split('/');
  const run = await wiroPost(`/Run/${owner}/${project}`, wiroVideoRunBody(request), { fetchImpl: options.fetchImpl, signal: AbortSignal.timeout(120_000) });
  const taskId = String(run.taskid ?? '');
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) throw new WiroError('Wiro accepted the video request but returned no task ID. Check Wiro usage before generating again.');
  return { taskId, slug: request.slug };
}

export type WiroVideoStatus = { status: 'RUNNING'; progress: number } | { status: 'FAILED'; error: string }
  | { status: 'SUCCEEDED'; url: string; actualCostUsd?: number };
/** One free Task/Detail check. Failed and cancelled Wiro tasks are not billed. */
export async function wiroVideoStatus(taskId: string, options: { fetchImpl?: FetchLike } = {}): Promise<WiroVideoStatus> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) throw new WiroError('Invalid saved Wiro task.');
  const task = parseWiroTask(await wiroPost('/Task/Detail', { taskid: taskId }, { fetchImpl: options.fetchImpl, signal: AbortSignal.timeout(30_000) }));
  if (task.state === 'running') return { status: 'RUNNING', progress: /queue|start/i.test(task.status) ? 0.05 : 0.5 };
  if (task.state !== 'succeeded') return { status: 'FAILED', error: `Wiro could not generate this video (task ${taskId}): ${task.error || 'unknown error'} Wiro does not bill failed tasks.` };
  const output = task.outputs.find(item => item.contentType.startsWith('video/') || /\.(?:mp4|mov)(?:\?|$)/i.test(item.url));
  if (!output || !isWiroOutputUrl(output.url)) return { status: 'FAILED', error: `Wiro task ${taskId} finished without a usable video. Check Wiro usage before generating again.` };
  return { status: 'SUCCEEDED', url: output.url, ...(task.costUsd != null ? { actualCostUsd: task.costUsd } : {}) };
}

/** Wiro CDN only, HTTPS, no redirects, bounded size. */
export async function downloadWiroVideo(url: string, options: { fetchImpl?: FetchLike } = {}): Promise<{ bytes: Buffer; contentType: string }> {
  if (!isWiroOutputUrl(url)) throw new WiroError('Wiro returned an unsupported video location.');
  const file = await (options.fetchImpl ?? fetch)(url, { redirect: 'error', signal: AbortSignal.timeout(180_000) });
  const type = (file.headers.get('content-type') || '').split(';')[0].trim();
  if (!file.ok || Number(file.headers.get('content-length')) > MAX_VIDEO_BYTES) throw new WiroError('The Wiro video could not be downloaded.');
  if (type && !/^video\/(?:mp4|quicktime)$/.test(type) && !/^(?:application|binary)\/octet-stream$/.test(type)) throw new WiroError('Wiro returned a file that is not a supported video.');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) throw new WiroError('The Wiro video exceeds the download limit.');
  return { bytes, contentType: type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4' };
}

const recent = (value: unknown, windowMs: number) => {
  const at = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) && Date.now() - at < windowMs;
};
/** Wiro video jobs still rendering for this user (rows older than 2 h are ignored so a stuck row cannot block forever). */
export async function activeWiroVideoCount(db: any, userId: string): Promise<number> {
  const { data, error } = await db.from('generations').select('id,status,created_at').eq('user_id', userId).like('task_id', 'bs_wiro_%').in('status', ['pending', 'processing']);
  if (error) throw new WiroError('Active Wiro video jobs could not be checked.');
  return (Array.isArray(data) ? data : []).filter((row: any) => recent(row.created_at, 2 * 3600_000)).length;
}

/** Persist the task on the generation right after the paid Run, before the
 * browser sees the response, so a restart recovers instead of resubmitting. */
export async function saveWiroVideoTask(db: any, userId: string, generationId: unknown, taskId: string, rawTaskId: string, slug: string): Promise<boolean> {
  if (typeof generationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(generationId)) return false;
  const { data: row, error } = await db.from('generations').select('metadata').eq('id', generationId).eq('user_id', userId).maybeSingle();
  if (error || !row) return false;
  const saved = await db.from('generations').update({ task_id: taskId, status: 'processing',
    metadata: { ...(row.metadata || {}), generationProvider: 'wiro', providerModel: slug, providerTaskId: rawTaskId } }).eq('id', generationId).eq('user_id', userId);
  return !saved.error;
}

const validMedia = (value: unknown, images: boolean) => Array.isArray(value) && value.every(item => typeof item === 'string'
  && (/^https:\/\//.test(item) || (images ? /^data:image\/(?:png|jpeg|webp);base64,/ : /^data:audio\/(?:mpeg|wav|x-wav|mp3);base64,/).test(item)));

/** POST /api/seedance-video for provider "wiro" (already validated by seedanceProviderError). */
export async function handleWiroSeedancePost(req: VercelRequest, res: VercelResponse, body: SeedanceRequest & { generationId?: unknown }, userId: string, options: { fetchImpl?: FetchLike } = {}) {
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 20000) return res.status(400).json({ error: 'Enter a prompt up to 20,000 characters.' });
  if ((body.imageUrls != null && !validMedia(body.imageUrls, true)) || (body.audioUrls != null && !validMedia(body.audioUrls, false)) || body.videoUrls?.length) return res.status(400).json({ error: 'Invalid reference media.' });
  const registry = await prepareTaskRegistry(res); if (!registry) return;
  const db = createUserScopedClient(req);
  // Every paid Wiro run must be tracked on an owned, saved generation: recovery and the concurrency cap depend on it.
  const generationId = typeof body.generationId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(body.generationId) ? body.generationId : '';
  try {
    const { data: owned, error } = generationId ? await db.from('generations').select('id,task_id').eq('id', generationId).eq('user_id', userId).maybeSingle() : { data: null, error: null };
    if (error) throw error;
    if (!owned) return res.status(400).json({ error: 'This video job is not saved yet, so Wiro could not be tracked. No request was sent.' });
    // One paid Run per generation: a saved task is recovered, never submitted again.
    if (typeof owned.task_id === 'string' && owned.task_id) return res.status(409).json({ error: `This video already has a provider task (${owned.task_id}). It was not submitted again.` });
    if (await activeWiroVideoCount(db, userId) >= WIRO_VIDEO_MAX_ACTIVE) return res.status(429).json({ error: `${WIRO_VIDEO_MAX_ACTIVE} Wiro videos are already rendering. Wait for one to finish; no request was sent.` });
  } catch { return res.status(503).json({ error: 'Active Wiro video jobs could not be checked. No request was sent.' }); }
  let submitted: { taskId: string; slug: string };
  try { submitted = await submitWiroVideo(body, options); }
  catch (error) {
    // A rejected Run has no task; a lost connection may have created one.
    if (error instanceof WiroError) return res.status(error.status && error.status < 500 ? 400 : 502).json({ error: `${error.message} No Wiro video was started.` });
    return res.status(502).json({ error: 'The Wiro video request could not be confirmed. Check Wiro usage before submitting again; it was not retried.' });
  }
  const taskId = `bs_wiro_${body.videoModel}_${submitted.taskId}`;
  try { await registerProviderTask(registry, 'wiro', taskId, userId); }
  catch (error) { return res.status(502).json({ error: (error as Error).message }); }
  const taskSaved = await saveWiroVideoTask(db, userId, generationId, taskId, submitted.taskId, submitted.slug).catch(() => false);
  return res.status(200).json({ taskId, provider: 'wiro', endpoint: submitted.slug, wiroTaskId: submitted.taskId, taskSaved });
}

/** GET status. The finished file is copied to workspace storage (Wiro CDN CORS is not relied on). */
export async function handleWiroSeedanceGet(req: VercelRequest, res: VercelResponse, taskId: string, rawTaskId: string, userId: string, options: { fetchImpl?: FetchLike } = {}) {
  if (!await requireProviderTask(req, res, 'wiro', taskId)) return;
  if (!process.env.WIRO_API_KEY?.trim() || !process.env.WIRO_API_SECRET?.trim()) return res.status(503).json({ error: 'Restore your Wiro key and secret to recover this video.', retryable: true });
  let state: WiroVideoStatus;
  try { state = await wiroVideoStatus(rawTaskId, options); }
  catch { return res.status(503).json({ error: 'Wiro video status is temporarily unavailable.', retryable: true }); }
  if (state.status !== 'SUCCEEDED') return res.status(200).json(state);
  const bucket = createUserScopedClient(req).storage.from('media'), path = `${userId}/wiro-video/${rawTaskId}.mp4`;
  const existing = await bucket.createSignedUrl(path, 3600);
  if (!existing.error && existing.data?.signedUrl) return res.status(200).json({ status: 'SUCCEEDED', output: [existing.data.signedUrl], actualCostUsd: state.actualCostUsd });
  try {
    const file = await downloadWiroVideo(state.url, options);
    const saved = await bucket.upload(path, file.bytes, { contentType: file.contentType, upsert: true });
    if (saved.error) throw new Error('save');
    return res.status(200).json({ status: 'SUCCEEDED', output: [await signedMediaUrl(bucket, path)], actualCostUsd: state.actualCostUsd });
  } catch { return res.status(503).json({ error: `Wiro task ${rawTaskId} finished; its video could not be copied yet. The task is kept.`, retryable: true }); }
}
