/** Fork: YouTube data through Apify (actor streamers/youtube-scraper) when
 * APIFY_TOKEN is set. Serves the same four YouTube Data API v3 response shapes
 * the app reads (channels, playlistItems, videos, search), so the client is
 * unchanged. The token goes only in the Authorization header. Each actor run is
 * paid per video returned; one channel run is cached and serves the follow-up
 * playlist and video lookups for free. See docs/fork/STUDIO_UPGRADES.md. */
export const APIFY_ACTOR = 'streamers~youtube-scraper';
const RUN_URL = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items`;
/** Regular videos fetched per channel (newest first). Bounds the cost of one channel lookup. */
export const APIFY_CHANNEL_VIDEOS = 50;
const PRICE_CAP_PER_ITEM_USD = 0.005;
const CACHE_TTL_MS = 30 * 60_000;
const MAX_CACHED_CHANNELS = 40;
type FetchLike = typeof fetch;

export class ApifyError extends Error { constructor(message: string, readonly status = 502) { super(message); } }

type ApifyVideo = { id?: string; title?: string; text?: string; hashtags?: string[]; channelName?: string; channelId?: string; channelAvatarUrl?: string;
  date?: string; duration?: string; viewCount?: number; thumbnailUrl?: string; type?: string };
type Cached<T> = { value: T; at: number };
const channels = new Map<string, Cached<{ id: string; title: string; avatar: string; videoIds: string[] }>>();
const channelInputs = new Map<string, Cached<string | null>>();
const videos = new Map<string, Cached<ApifyVideo>>();
const fresh = <T>(entry: Cached<T> | undefined) => entry && Date.now() - entry.at < CACHE_TTL_MS ? entry.value : undefined;
export const clearApifyCache = () => { channels.clear(); channelInputs.clear(); videos.clear(); };

/** "1:02:03" / "00:03:27" / "45" → ISO 8601 "PT1H2M3S", the format the client parses. */
export const toIsoDuration = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d+(?::\d{1,2}){0,2}$/.test(value.trim())) return 'PT0S';
  const parts = value.trim().split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`;
};

/** One dataset item in the YouTube v3 "videos" item shape (only the fields the app reads). */
export const toYouTubeVideo = (item: ApifyVideo) => ({
  id: item.id,
  snippet: { title: item.title || '', description: item.text || '', tags: (item.hashtags || []).map(tag => String(tag).replace(/^#/, '')).filter(Boolean),
    channelTitle: item.channelName || '', channelId: item.channelId || '', publishedAt: item.date || '',
    thumbnails: item.thumbnailUrl ? { high: { url: item.thumbnailUrl } } : {} },
  statistics: { viewCount: String(Number.isFinite(item.viewCount) ? Math.max(0, Math.floor(item.viewCount as number)) : 0) },
  contentDetails: { duration: toIsoDuration(item.duration) },
});

async function runActor(token: string, input: Record<string, unknown>, maxItems: number, fetchImpl: FetchLike = fetch): Promise<ApifyVideo[]> {
  const url = new URL(RUN_URL);
  url.searchParams.set('timeout', '150'); url.searchParams.set('maxItems', String(maxItems));
  url.searchParams.set('maxTotalChargeUsd', (maxItems * PRICE_CAP_PER_ITEM_USD + 0.01).toFixed(2));
  url.searchParams.set('clean', 'true'); url.searchParams.set('format', 'json');
  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(170_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  } catch { throw new ApifyError('Apify did not answer in time. Try again; nothing was retried automatically.', 504); }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof (data as any)?.error?.message === 'string' ? (data as any).error.message.replace(/[\u0000-\u001f]+/g, ' ').slice(0, 200) : '';
    if (response.status === 401 || response.status === 403) throw new ApifyError('Apify rejected the token. Check "YouTube · Apify" in Provider keys.', 401);
    if (response.status === 402) throw new ApifyError('Apify reports insufficient credit for this lookup.', 402);
    throw new ApifyError(`Apify could not fetch YouTube data (${response.status})${message ? `: ${message}` : ''}.`, response.status >= 500 ? 502 : 400);
  }
  if (!Array.isArray(data)) throw new ApifyError('Apify returned an unexpected YouTube result.');
  return (data as ApifyVideo[]).filter(item => item && typeof item.id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(item.id));
}

const remember = (items: ApifyVideo[]) => { const at = Date.now(); for (const item of items) videos.set(item.id!, { value: item, at }); };
const channelUrl = (params: Record<string, string>) => {
  if (params.id && /^UC[a-zA-Z0-9_-]{10,40}$/.test(params.id)) return { key: `id:${params.id}`, url: `https://www.youtube.com/channel/${params.id}/videos` };
  const handle = (params.forHandle || '').replace(/^@/, '');
  if (handle && /^[a-zA-Z0-9_.-]{1,100}$/.test(handle)) return { key: `handle:${handle.toLowerCase()}`, url: `https://www.youtube.com/@${handle}/videos` };
  const user = params.forUsername || '';
  if (user && /^[a-zA-Z0-9_.-]{1,100}$/.test(user)) return { key: `user:${user.toLowerCase()}`, url: `https://www.youtube.com/user/${user}/videos` };
  return null;
};

/** One paid run per channel within the cache window. */
async function loadChannel(token: string, url: string, fetchImpl?: FetchLike) {
  const items = await runActor(token, { startUrls: [{ url }], maxResults: APIFY_CHANNEL_VIDEOS, maxResultsShorts: 0, maxResultStreams: 0, sortVideosBy: 'NEWEST' }, APIFY_CHANNEL_VIDEOS, fetchImpl);
  const first = items.find(item => typeof item.channelId === 'string' && /^UC[a-zA-Z0-9_-]{10,40}$/.test(item.channelId));
  if (!first) return null;
  remember(items);
  const channel = { id: first.channelId!, title: first.channelName || '', avatar: first.channelAvatarUrl || '', videoIds: items.filter(item => item.channelId === first.channelId).map(item => item.id!) };
  if (channels.size >= MAX_CACHED_CHANNELS) channels.delete(channels.keys().next().value!);
  channels.set(channel.id, { value: channel, at: Date.now() });
  return channel;
}

export async function apifyYouTube(endpoint: string, params: Record<string, string>, token: string, fetchImpl?: FetchLike): Promise<Record<string, unknown>> {
  if (endpoint === 'channels') {
    const target = channelUrl(params);
    if (!target) throw new ApifyError('Unsupported channel lookup.', 400);
    let id = fresh(channelInputs.get(target.key));
    let channel = id ? fresh(channels.get(id)) : undefined;
    if (!channel) {
      channel = await loadChannel(token, target.url, fetchImpl) ?? undefined;
      channelInputs.set(target.key, { value: channel?.id ?? null, at: Date.now() });
    }
    if (!channel) return { items: [] };
    return { items: [{ id: channel.id, snippet: { title: channel.title, thumbnails: { default: { url: channel.avatar } } },
      contentDetails: { relatedPlaylists: { uploads: `UU${channel.id.slice(2)}` } } }] };
  }
  if (endpoint === 'playlistItems') {
    const playlist = params.playlistId || '';
    if (!/^UU[a-zA-Z0-9_-]{10,40}$/.test(playlist)) throw new ApifyError('Only channel upload lists are supported with Apify.', 400);
    const id = `UC${playlist.slice(2)}`;
    const channel = fresh(channels.get(id)) ?? await loadChannel(token, `https://www.youtube.com/channel/${id}/videos`, fetchImpl);
    const ids = channel?.videoIds ?? [];
    const offset = /^apify:\d{1,4}$/.test(params.pageToken || '') ? Number(params.pageToken.slice(6)) : 0;
    const size = Math.max(1, Math.min(50, Number(params.maxResults) || 50));
    const page = ids.slice(offset, offset + size);
    return { items: page.map(videoId => ({ contentDetails: { videoId } })), ...(offset + size < ids.length ? { nextPageToken: `apify:${offset + size}` } : {}) };
  }
  if (endpoint === 'videos') {
    const ids = (params.id || '').split(',').map(value => value.trim()).filter(value => /^[a-zA-Z0-9_-]{11}$/.test(value)).slice(0, 50);
    const missing = ids.filter(id => !fresh(videos.get(id)));
    if (missing.length) remember(await runActor(token, { startUrls: missing.map(id => ({ url: `https://www.youtube.com/watch?v=${id}` })), maxResults: missing.length, maxResultsShorts: 0, maxResultStreams: 0 }, missing.length, fetchImpl));
    return { items: ids.map(id => fresh(videos.get(id))).filter((item): item is ApifyVideo => !!item).map(toYouTubeVideo) };
  }
  if (endpoint === 'search') {
    const q = (params.q || '').trim().slice(0, 100);
    if (!q || params.type !== 'channel') throw new ApifyError('Only channel search is supported with Apify.', 400);
    const items = await runActor(token, { searchQueries: [q], maxResults: 1, maxResultsShorts: 0, maxResultStreams: 0 }, 1, fetchImpl);
    return { items: items.filter(item => item.channelId).slice(0, 1).map(item => ({ snippet: { channelId: item.channelId, title: item.channelName || '' } })) };
  }
  throw new ApifyError(`Unsupported endpoint: ${endpoint}`, 400);
}
