import { createHmac } from 'node:crypto';
import { isWiroModelId, wiroSlugForModel, type WiroControls, type WiroModelEntry } from '../../src/lib/wiro/catalog.js';

/** Wiro Signature authentication. The secret only feeds the HMAC; it is never
 * sent, logged or returned. All destinations are fixed and server-owned. */
export const WIRO_API = 'https://api.wiro.ai/v1';
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
/** Each attempt polls Task/Detail for up to windowMs; the durable queue resumes later attempts. */
export const wiroPolling = { windowMs: 240_000, intervalMs: 3_000 };
type FetchLike = typeof fetch;

export class WiroError extends Error {
  /** rejected: Wiro (or local validation) refused the request, so nothing was started. */
  constructor(message: string, readonly status?: number, readonly rejected = false) { super(message); }
}
/** The task was accepted but is still running when this attempt's time ran out. */
export class WiroTaskPending extends Error {
  constructor(readonly taskId: string) { super(`Wiro task ${taskId} is still running.`); }
}

export const wiroCredentials = () => {
  const key = process.env.WIRO_API_KEY?.trim(), secret = process.env.WIRO_API_SECRET?.trim();
  if (!key || !secret) throw new WiroError('Open Provider keys and add your Wiro API key and secret.');
  return { key, secret };
};
export const wiroSignature = (key: string, secret: string, nonce: string) => createHmac('sha256', key).update(secret + nonce).digest('hex');
export const wiroHeaders = (key: string, secret: string, nonce = String(Math.floor(Date.now() / 1000))) =>
  ({ 'x-api-key': key, 'x-nonce': nonce, 'x-signature': wiroSignature(key, secret, nonce) });

const safeText = (value: unknown, limit = 200) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, limit) : '';
const errorText = (data: any) => safeText(Array.isArray(data?.errors) ? data.errors.map((error: any) => typeof error === 'string' ? error : error?.message).filter(Boolean).join('; ') : '');

export async function wiroPost(path: string, body: Record<string, unknown> | FormData, options: { signal?: AbortSignal; fetchImpl?: FetchLike; credentials?: { key: string; secret: string } } = {}) {
  if (!/^\/(Run\/[a-z0-9._-]+\/[a-z0-9._-]+|Task\/Detail|Tool\/List|Tool\/Detail)$/.test(path)) throw new WiroError('Unsupported Wiro endpoint.');
  const { key, secret } = options.credentials ?? wiroCredentials();
  const form = body instanceof FormData;
  const response = await (options.fetchImpl ?? fetch)(`${WIRO_API}${path}`, {
    method: 'POST', redirect: 'error', signal: options.signal ?? AbortSignal.timeout(60_000),
    headers: { ...wiroHeaders(key, secret), ...(form ? {} : { 'Content-Type': 'application/json' }) },
    body: form ? body : JSON.stringify(body),
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || data?.result !== true) {
    const detail = errorText(data);
    // Only a 4xx or a parsed `result: false` is a definite refusal; a 5xx or unreadable body may hide an accepted task.
    const rejected = response.status < 500 && (response.status >= 400 || data?.result === false);
    throw new WiroError(`Wiro rejected the request (${response.status})${detail ? `: ${detail}` : ''}.`, response.status, rejected);
  }
  return data;
}

export type WiroTaskState = { state: 'running' | 'succeeded' | 'failed' | 'cancelled'; status: string; outputs: { url: string; contentType: string; size: number | null }[];
  costUsd: number | null; elapsedSeconds: number | null; error?: string };
/** Task/Detail numeric fields are strings; success is status task_postprocess_end and pexit "0". */
export function parseWiroTask(detail: any): WiroTaskState {
  const task = Array.isArray(detail?.tasklist) ? detail.tasklist[0] : null;
  if (!task || typeof task !== 'object') throw new WiroError('Wiro returned no task details.');
  const status = safeText(task.status, 60), pexit = task.pexit == null ? '' : String(task.pexit);
  const number = (value: unknown) => { const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN; return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; };
  const outputs = (Array.isArray(task.outputs) ? task.outputs : []).filter((output: any) => typeof output?.url === 'string')
    .map((output: any) => ({ url: output.url as string, contentType: safeText(output.contenttype, 60), size: number(output.size) }));
  const base = { status, outputs, costUsd: number(task.totalcost), elapsedSeconds: number(task.elapsedseconds) };
  if (status === 'task_cancel') return { ...base, state: 'cancelled', error: 'The Wiro task was cancelled.' };
  if (status !== 'task_postprocess_end') return { ...base, state: 'running' };
  if (pexit === '0') return { ...base, state: 'succeeded' };
  return { ...base, state: 'failed', error: safeText(task.debugerror) || `Wiro reported exit code ${safeText(pexit, 12) || 'unknown'}.` };
}

/** Only HTTPS files on Wiro's own CDN are fetched; redirects are refused. */
export const isWiroOutputUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && (url.hostname === 'wiro.ai' || url.hostname.endsWith('.wiro.ai'));
  } catch { return false; }
};
export async function downloadWiroOutput(value: string, options: { signal?: AbortSignal; fetchImpl?: FetchLike } = {}) {
  if (!isWiroOutputUrl(value)) throw new WiroError('Wiro returned an unsupported image location.');
  const file = await (options.fetchImpl ?? fetch)(value, { redirect: 'error', signal: options.signal ?? AbortSignal.timeout(120_000) });
  const type = file.headers.get('content-type') || '';
  if (!file.ok || Number(file.headers.get('content-length')) > MAX_OUTPUT_BYTES) throw new WiroError('Generated image download failed.');
  if (type && !/^image\/(png|jpeg|webp)\b/.test(type) && !/^(application\/octet-stream|binary\/octet-stream)\b/.test(type)) throw new WiroError('Wiro returned a file that is not a supported image.');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_OUTPUT_BYTES) throw new WiroError('Generated image exceeds the output limit.');
  return { bytes, contentType: /^image\/(png|jpeg|webp)/.exec(type)?.[0] };
}

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/;
/** Build the Run body. Local references arrive as data URLs and are sent as
 * multipart files (Wiro cannot read loopback URLs); HTTPS URLs pass through. */
export function wiroRunBody(fields: Record<string, string>, images: string[] = [], imageField?: { id: string; type: string }) {
  if (!images.length) return fields;
  if (!imageField) throw new WiroError('This Wiro model does not accept reference images.');
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  images.forEach((image, index) => {
    const data = DATA_URL.exec(image);
    if (data) form.append(imageField.id, new Blob([Buffer.from(data[2], 'base64')], { type: data[1] }), `reference-${index + 1}.${data[1].split('/')[1].replace('jpeg', 'jpg')}`);
    else if (/^https:\/\//.test(image)) form.append(imageField.type === 'combinefileinput' ? imageField.id : `${imageField.id}Url`, image);
    else throw new WiroError('This reference could not be prepared for Wiro.');
  });
  return form;
}

export type WiroImageRequest = {
  slug: string; fields: Record<string, string>; images?: string[]; imageField?: { id: string; type: string };
  /** Called once with the task ID before polling, so the job can be recovered. */
  onTask?: (taskId: string) => Promise<void> | void;
  /** Recover an existing task: never calls Run. */
  resumeTaskId?: string;
  /** Stop polling this attempt at this time (ms); a later attempt resumes. */
  pollUntil?: number; pollIntervalMs?: number; fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void>;
};

/** One paid Run (or none when resuming), then Task/Detail polling and a
 * CDN download. Returns the same JSON shape the image pipeline consumes. */
export async function requestWiroImage(request: WiroImageRequest): Promise<Response> {
  const { fetchImpl } = request, credentials = wiroCredentials();
  const sleep = request.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  const [owner, project] = request.slug.split('/');
  let taskId = request.resumeTaskId;
  if (taskId != null && !/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) throw new WiroError('Invalid saved Wiro task.');
  if (!taskId) {
    const run = await wiroPost(`/Run/${owner}/${project}`, wiroRunBody(request.fields, request.images, request.imageField), { fetchImpl, credentials, signal: AbortSignal.timeout(120_000) });
    taskId = String(run.taskid ?? '');
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) throw new WiroError('Wiro accepted the request but returned no task ID. Check Wiro usage before generating again.');
    try { await request.onTask?.(taskId); } catch { /* The task ID is also kept on the response; polling continues. */ }
  }
  const until = request.pollUntil ?? Date.now() + wiroPolling.windowMs;
  let task: WiroTaskState | undefined;
  for (;;) {
    try { task = parseWiroTask(await wiroPost('/Task/Detail', { taskid: taskId }, { fetchImpl, credentials, signal: AbortSignal.timeout(30_000) })); }
    catch (error) { if (Date.now() >= until) throw error; task = undefined; }
    if (task && task.state !== 'running') break;
    if (Date.now() >= until) throw new WiroTaskPending(taskId);
    await sleep(request.pollIntervalMs ?? wiroPolling.intervalMs);
  }
  const headers = { 'x-request-id': taskId };
  if (task.state !== 'succeeded') {
    return Response.json({ error: { message: task.error, code: task.state === 'cancelled' ? 'wiro_task_cancelled' : 'wiro_task_failed' }, taskId }, { status: 422, headers });
  }
  const output = task.outputs.find(item => !item.contentType || item.contentType.startsWith('image/'));
  if (!output) throw new WiroError(`Wiro task ${taskId} finished without an image. Check Wiro usage before generating again.`);
  let file: Awaited<ReturnType<typeof downloadWiroOutput>>;
  try { file = await downloadWiroOutput(output.url, { fetchImpl }); }
  catch (error) { throw new WiroError(`Wiro task ${taskId} finished, but its image could not be downloaded (${error instanceof Error ? error.message : 'unknown error'}). Check Wiro usage before generating again.`); }
  const mediaType = file.contentType || (/^image\/(png|jpeg|webp)$/.test(output.contentType) ? output.contentType : 'image/png');
  return Response.json({ data: [{ b64_json: file.bytes.toString('base64'), media_type: mediaType }], output_format: mediaType.split('/')[1],
    usage: { cost: task.costUsd }, wiro: { taskId, elapsedSeconds: task.elapsedSeconds } }, { headers });
}

/** Saved catalog models live in the local workspace settings; the controls
 * were built server-side from Tool/Detail, never supplied by the WebView. */
export async function loadWiroControls(db: any, model: string): Promise<WiroControls> {
  if (!isWiroModelId(model)) throw new WiroError('Unsupported Wiro model.');
  const { data, error } = await db.rpc('get_wiro_models');
  if (error) throw new WiroError('Saved Wiro models are unavailable.');
  const slug = wiroSlugForModel(model);
  const entry = (Array.isArray(data?.models) ? data.models as WiroModelEntry[] : []).find(item => item?.slug === slug);
  if (!entry) throw new WiroError('Add this model again in Wiro models before generating.');
  if (!entry.controls) throw new WiroError(entry.unsupportedReason || 'This Wiro model is not supported yet.');
  return entry.controls;
}
