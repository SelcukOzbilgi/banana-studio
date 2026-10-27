/** Wiro image model catalog: pure helpers shared by the UI, the API pipeline
 * and the desktop server. No credentials or network access here. */

/** App image models that Wiro serves directly (verified with Tool/Detail on 2026-10-27). */
export const WIRO_BUILTIN_MODELS: Record<string, string> = {
  'gemini-3-pro-image-preview': 'google/nano-banana-pro',
  'gemini-nano-banana-2.1': 'google/nano-banana-2-1',
  'gpt-image-2.5-sunburst': 'openai/gpt-image-2-5-sunburst',
};
/** Exact canvas sizes and protected edits use the width/height variant (480–3840 px). */
export const WIRO_SUNBURST_CUSTOM = 'openai/gpt-image-2-5-sunburst-custom';
export const WIRO_CUSTOM_EDGE = { min: 480, max: 3840 } as const;
export const WIRO_CATALOG_CATEGORIES = ['text-to-image', 'image-to-image', 'image-editing'] as const;

const SLUG = /^[a-z0-9][a-z0-9._-]{0,79}\/[a-z0-9][a-z0-9._-]{0,119}$/;
export const isWiroSlug = (value: unknown): value is string => typeof value === 'string' && SLUG.test(value);
/** Catalog models (outside the three built-ins) use `wiro:<owner>/<model>` IDs. */
export const WIRO_MODEL_PREFIX = 'wiro:';
export const isWiroModelId = (value: unknown): value is `wiro:${string}` => typeof value === 'string' && value.startsWith(WIRO_MODEL_PREFIX) && isWiroSlug(value.slice(WIRO_MODEL_PREFIX.length));
export const wiroSlugForModel = (model: string): string | null => WIRO_BUILTIN_MODELS[model] ?? (isWiroModelId(model) ? model.slice(WIRO_MODEL_PREFIX.length) : null);
export const appModelForWiroSlug = (slug: string): string => Object.entries(WIRO_BUILTIN_MODELS).find(([, value]) => value === slug)?.[0] ?? `${WIRO_MODEL_PREFIX}${slug}`;

export type WiroSelectControl = { id: string; options: string[]; default?: string };
export type WiroControls = {
  prompt: string;
  images?: { id: string; max: number; type: string };
  ratio?: WiroSelectControl;
  resolution?: WiroSelectControl;
  quality?: WiroSelectControl;
  count?: { id: string; min: number; max: number };
  /** Required parameters outside the common controls, sent with their schema default. */
  fixed: Record<string, string>;
};
export type WiroPriceRow = { inputs: Record<string, string>; price: number; method: string; note?: string };
export type WiroModelEntry = {
  slug: string; title: string; description?: string; image?: string; categories: string[];
  controls: WiroControls | null; unsupportedReason?: string;
  prices: WiroPriceRow[]; checkedAt: number; status?: 'ok' | 'missing' | 'changed'; statusNote?: string;
};

const text = (value: unknown, limit = 300) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
const optionValues = (item: any): string[] => (Array.isArray(item?.options) ? item.options : [])
  .map((option: any) => typeof option === 'object' && option ? option.value : option)
  .filter((value: unknown) => typeof value === 'string' || typeof value === 'number').map(String).filter((value: string) => value.length <= 40).slice(0, 60);
const select = (item: any): WiroSelectControl | undefined => {
  const options = optionValues(item).filter(Boolean);
  if (!options.length) return undefined;
  const fallback = text(item.defaultvalue, 40);
  return { id: item.id, options, ...(options.includes(fallback) ? { default: fallback } : {}) };
};
const FILE_TYPES = new Set(['combinefileinput', 'multifileinput', 'fileinput']);

/** Map a Tool/Detail `parameters` array to the app's common controls. Prompt,
 * reference images, aspect ratio, resolution, quality and image count are
 * mapped; other optional extras are left at Wiro's defaults. */
export function mapWiroSchema(parameters: unknown): { controls: WiroControls | null; reason?: string } {
  const items: any[] = (Array.isArray(parameters) ? parameters : []).flatMap((group: any) => Array.isArray(group?.items) ? group.items : [])
    .filter(item => item && typeof item.id === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(item.id));
  const used = new Set<string>();
  const take = (predicate: (item: any) => boolean) => { const item = items.find(entry => !used.has(entry.id) && predicate(entry)); if (item) used.add(item.id); return item; };
  const prompt = take(item => item.id === 'prompt' && ['textarea', 'text'].includes(item.type));
  if (!prompt) return { controls: null, reason: 'This model has no text prompt input.' };
  const images = take(item => FILE_TYPES.has(item.type) && !/mask/i.test(item.id) && /image/i.test(item.id));
  const ratio = take(item => item.type === 'select' && /^(aspect_?ratio|ratio)$/i.test(item.id));
  const resolution = take(item => item.type === 'select' && /^(resolution|image_?size|output_?resolution)$/i.test(item.id));
  const quality = take(item => item.type === 'select' && /^quality$/i.test(item.id));
  const count = take(item => item.type === 'number' && /^(samples|num_?images|number_?of_?images|count)$/i.test(item.id));
  const fixed: Record<string, string> = {};
  for (const item of items) {
    if (used.has(item.id) || !item.required) continue;
    const value = text(item.defaultvalue, 200);
    if (!['select', 'number', 'range', 'checkbox'].includes(item.type) || value === '') {
      return { controls: null, reason: `The required input "${text(item.label || item.id, 60)}" is not supported yet.` };
    }
    fixed[item.id] = value;
  }
  const max = Number(images?.maxinputlenght ?? images?.maxinputlength ?? (images?.type === 'fileinput' ? 1 : 1));
  const countMin = Math.max(1, Number(count?.minvalue) || 1), countMax = Math.max(countMin, Number(count?.maxvalue) || countMin);
  return { controls: {
    prompt: prompt.id,
    ...(images ? { images: { id: images.id, type: images.type, max: Number.isInteger(max) && max > 0 ? Math.min(max, 16) : 1 } } : {}),
    ...(ratio && select(ratio) ? { ratio: select(ratio) } : {}),
    ...(resolution && select(resolution) ? { resolution: select(resolution) } : {}),
    ...(quality && select(quality) ? { quality: select(quality) } : {}),
    ...(count ? { count: { id: count.id, min: countMin, max: countMax } } : {}),
    fixed,
  } };
}

/** Tool/Detail returns an array; Tool/List and Task/Detail return a JSON string. */
export function parseWiroPrices(value: unknown): WiroPriceRow[] {
  let rows: unknown = value;
  if (typeof value === 'string') { try { rows = JSON.parse(value); } catch { return []; } }
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 200).flatMap((row: any) => {
    const price = Number(row?.price);
    if (!row || typeof row !== 'object' || !Number.isFinite(price) || price < 0) return [];
    const inputs = Object.fromEntries(Object.entries(row.inputs && typeof row.inputs === 'object' ? row.inputs : {})
      .filter(([key, input]) => /^[A-Za-z0-9_]{1,64}$/.test(key) && ['string', 'number'].includes(typeof input)).map(([key, input]) => [key, String(input)]));
    return [{ inputs, price, method: text(row.priceMethod, 40) || 'cpr', ...(row.note ? { note: text(row.note, 400) } : {}) }];
  });
}
const isDeferredPrice = (row: WiroPriceRow) => row.method === 'cp-readoutput' || row.price === 0;
/** Price for one request, or null when Wiro computes it after the task finishes. */
export function wiroPriceFor(prices: WiroPriceRow[], inputs: Record<string, string>): number | null {
  const normalized = Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, String(value).toLowerCase()]));
  const row = prices.find(entry => Object.entries(entry.inputs).every(([key, value]) => normalized[key] === value.toLowerCase()));
  return row && !isDeferredPrice(row) ? row.price : null;
}
export function wiroPriceSummary(prices: WiroPriceRow[]): string {
  const fixed = prices.filter(row => !isDeferredPrice(row)).map(row => row.price);
  if (!fixed.length) return prices.length ? 'Price computed when the task finishes' : 'Price unavailable';
  const low = Math.min(...fixed), high = Math.max(...fixed), format = (usd: number) => `$${usd < 0.1 ? usd.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : usd.toFixed(2)}`;
  return low === high ? `${format(low)} per image` : `${format(low)}–${format(high)} per image`;
}

/** Build a sanitized catalog entry from a Tool/Detail `tool[0]` object. */
export function wiroEntryFromTool(tool: any, now = Date.now()): WiroModelEntry | null {
  const owner = text(tool?.cleanslugowner, 80), project = text(tool?.cleanslugproject, 120), slug = `${owner}/${project}`;
  if (!isWiroSlug(slug)) return null;
  const categories = (Array.isArray(tool.categories) ? tool.categories : []).filter((value: unknown) => typeof value === 'string').map((value: string) => text(value, 40)).slice(0, 30);
  const mapped = Array.isArray(tool.parameters) ? mapWiroSchema(tool.parameters) : { controls: null, reason: 'Model inputs were not returned.' };
  const image = text(tool.image, 500);
  return { slug, title: text(tool.title, 120) || slug, description: text(tool.description, 400) || undefined,
    image: /^https:\/\/([a-z0-9-]+\.)*wiro\.ai\//i.test(image) ? image : undefined, categories,
    controls: mapped.controls, ...(mapped.reason ? { unsupportedReason: mapped.reason } : {}), prices: parseWiroPrices(tool.dynamicprice), checkedAt: now };
}
export const isWiroImageModel = (categories: string[]) => categories.some(value => (WIRO_CATALOG_CATEGORIES as readonly string[]).includes(value));

/** Compare a stored entry with a fresh Tool/Detail result for the refresh action. */
export function refreshWiroEntry(previous: WiroModelEntry, fresh: WiroModelEntry | null, now = Date.now()): WiroModelEntry {
  if (!fresh) return { ...previous, status: 'missing', statusNote: 'Wiro no longer lists this model.', checkedAt: now };
  const priceChanged = JSON.stringify(previous.prices) !== JSON.stringify(fresh.prices);
  const inputsChanged = JSON.stringify(previous.controls) !== JSON.stringify(fresh.controls);
  const notes = [priceChanged ? 'Price changed.' : '', inputsChanged ? 'Inputs changed.' : ''].filter(Boolean);
  return { ...fresh, status: notes.length ? 'changed' : 'ok', ...(notes.length ? { statusNote: notes.join(' ') } : {}) };
}

export type WiroImageOptions = { ratio?: string; resolution?: string; quality?: string };
/** Validate UI choices against the stored controls. Returns an error message or null. */
export function validateWiroOptions(controls: WiroControls, options: unknown): string | null {
  if (options != null && (typeof options !== 'object' || Array.isArray(options))) return 'Invalid Wiro options.';
  const value = (options || {}) as Record<string, unknown>;
  for (const key of ['ratio', 'resolution', 'quality'] as const) {
    const control = controls[key];
    if (value[key] == null) continue;
    if (!control || typeof value[key] !== 'string' || !control.options.includes(value[key] as string)) return `Unsupported ${key} for this Wiro model.`;
  }
  return null;
}
/** Fields for a catalog model's Run request (without reference files). */
export function wiroCatalogFields(controls: WiroControls, prompt: string, options: WiroImageOptions = {}): Record<string, string> {
  const fields: Record<string, string> = { ...controls.fixed, [controls.prompt]: prompt };
  for (const key of ['ratio', 'resolution', 'quality'] as const) {
    const control = controls[key], chosen = options[key] ?? control?.default;
    if (control && chosen != null && chosen !== '') fields[control.id] = chosen;
  }
  if (controls.count) fields[controls.count.id] = String(controls.count.min);
  return fields;
}
