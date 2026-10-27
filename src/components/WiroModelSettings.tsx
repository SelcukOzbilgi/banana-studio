import React, { useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';
import { isWiroModelId, wiroPriceFor, type WiroModelEntry } from '../lib/wiro/catalog';
import { getImageModelLabel, IMAGE_MODEL_OPTIONS, type GenerationConfig } from '../types';
import { getOpenAIImageOptions } from '../lib/images/openaiImage';
import { Dropdown } from './ControlDropdown';

/** Saved Wiro model as returned by the desktop server (no credentials). */
export type WiroModelView = WiroModelEntry & { appModel: string; builtin: boolean; priceSummary: string };
type CatalogResult = Omit<WiroModelEntry, 'controls'> & { added: boolean; priceSummary: string };
const EVENT = 'banana-wiro-models-changed';

async function wiroModels(body?: Record<string, unknown>) {
  const response = await fetch('/api/wiro-models', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Wiro models are unavailable.');
  return data;
}

/** The picker's Wiro selection; null outside the desktop app or when unavailable. */
export function useWiroModels() {
  const [state, setState] = useState<{ configured: boolean; models: WiroModelView[] } | null>(null);
  useEffect(() => {
    if (!isLocalWorkspace()) return;
    let active = true;
    const load = () => { wiroModels().then(value => { if (active) setState(value); }).catch(() => { /* Keep the built-in picker. */ }); };
    load(); window.addEventListener(EVENT, load);
    return () => { active = false; window.removeEventListener(EVENT, load); };
  }, []);
  return state;
}

/** Picker options: the saved Wiro selection (defaults: the three built-in models). */
export function wiroImageModelOptions(models: WiroModelView[] | undefined, current: string) {
  if (!models?.length) return IMAGE_MODEL_OPTIONS;
  const options = models.map(model => ({ value: model.appModel, label: model.builtin ? IMAGE_MODEL_OPTIONS.find(option => option.value === model.appModel)?.label || model.title : model.title }));
  return options.some(option => option.value === current) ? options : [...options, { value: current, label: getImageModelLabel(current) }];
}

/** Ratio, resolution and quality for a Wiro catalog model, from its saved schema. */
export function WiroImageControls({ config, model, onChange }: { config: GenerationConfig; model?: WiroModelView; onChange: (update: (current: GenerationConfig) => GenerationConfig) => void }) {
  const controls = model?.controls;
  if (!controls) return <span className="text-xs text-amber-300">{model ? model.unsupportedReason || 'Unsupported Wiro model' : 'Loading Wiro model…'}</span>;
  const set = (key: 'ratio' | 'resolution' | 'quality', value: string) => onChange(current => ({ ...current, wiroOptions: { ...current.wiroOptions, [key]: value } }));
  const labels = { ratio: 'Aspect Ratio', resolution: 'Resolution', quality: 'Quality' } as const;
  return <>{(['ratio', 'resolution', 'quality'] as const).map(key => {
    const control = controls[key];
    if (!control) return null;
    return <Dropdown key={key} label={labels[key]} value={config.wiroOptions?.[key] ?? control.default ?? control.options[0]}
      options={control.options.map(value => ({ value, label: value || 'Model default' }))} onSelect={value => set(key, value)} compact />;
  })}</>;
}

/** Price shown before submitting when Wiro serves the request and Tool/Detail has a fixed price. */
export function wiroCostLabel(config: GenerationConfig, model: WiroModelView | undefined, count: number) {
  if (!model?.prices?.length) return { label: 'Wiro · billed at finish', description: 'Wiro reports the actual cost when the task finishes. Refresh Wiro models in AI settings to load prices.' };
  let inputs: Record<string, string>;
  if (isWiroModelId(config.imageModel)) {
    const controls = model.controls;
    inputs = Object.fromEntries((['ratio', 'resolution', 'quality'] as const).flatMap(key => controls?.[key] ? [[controls[key]!.id, config.wiroOptions?.[key] ?? controls[key]!.default ?? '']] : []));
  } else if (model.slug === 'openai/gpt-image-2-5-sunburst') {
    const quality = getOpenAIImageOptions(config.openaiImageOptions).quality;
    inputs = { quality: quality === 'auto' ? 'low' : quality, resolution: config.resolution, ratio: config.aspectRatio };
  } else inputs = { resolution: config.resolution };
  const price = wiroPriceFor(model.prices, inputs);
  if (price == null) return { label: 'Wiro · billed at finish', description: 'This size or exact canvas has no fixed Wiro price. The actual cost is recorded when the task finishes.' };
  const total = price * count;
  return { label: `~$${total < 0.1 ? total.toFixed(3) : total.toFixed(2)} · Wiro`, description: `Wiro list price for ${count} image${count === 1 ? '' : 's'} at these settings. The actual cost is recorded when each task finishes.` };
}

/** AI settings: choose which Wiro image models appear in the picker. */
export function WiroModelSettings() {
  const [state, setState] = useState<{ configured: boolean; models: WiroModelView[] } | null>(null);
  const [query, setQuery] = useState(''), [results, setResults] = useState<CatalogResult[] | null>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const run = async (label: string, body: Record<string, unknown>, after?: (data: any) => void) => {
    setBusy(label); setError('');
    try { const data = await wiroModels(body); if (data.models) { setState(data); window.dispatchEvent(new Event(EVENT)); } after?.(data); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(''); }
  };
  useEffect(() => {
    if (!isLocalWorkspace()) return;
    wiroModels().then(value => {
      setState(value);
      // Load list prices once for the default selection.
      if (value.configured && value.models.some((model: WiroModelView) => !model.checkedAt)) void run('refresh', { action: 'refresh' });
    }).catch(failure => setError((failure as Error).message));
  }, []);
  if (!isLocalWorkspace()) return null;
  const search = () => run('search', { action: 'search', query }, data => setResults(data.results || []));
  return <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="wiro-models-title">
    <div className="flex items-center justify-between gap-3">
      <h3 id="wiro-models-title" className="font-semibold">Wiro image models</h3>
      <button type="button" disabled={!!busy || !state?.configured} onClick={() => void run('refresh', { action: 'refresh' })} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-40">
        <RefreshCw size={12} className={busy === 'refresh' ? 'animate-spin' : ''} />Refresh</button>
    </div>
    <p className="text-xs leading-relaxed text-gray-400">These models appear in the image model picker. Prompt, references, aspect ratio, resolution and quality are mapped from each model's inputs; other model options keep Wiro's defaults. Prices come from Wiro; the actual cost of each image is recorded when its task finishes.</p>
    {state && !state.configured && <p role="status" className="text-xs text-amber-300">Wiro key or secret missing. Open Provider keys and add both to search the catalog.</p>}
    <ul className="space-y-2">{(state?.models || []).map(model => <li key={model.slug} className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="min-w-0"><p className="text-sm text-gray-200">{model.title}</p>
        <p className="break-all text-[11px] text-gray-500">{model.slug} · {model.priceSummary}</p>
        {model.statusNote && <p className={`text-[11px] ${model.status === 'missing' ? 'text-red-300' : 'text-amber-300'}`}>{model.statusNote}</p>}
        {!model.builtin && !model.controls && <p className="text-[11px] text-amber-300">{model.unsupportedReason || 'Not supported yet.'}</p>}</div>
      <button type="button" aria-label={`Remove ${model.title}`} disabled={!!busy || (state?.models.length || 0) <= 1} onClick={() => void run('remove', { action: 'remove', slug: model.slug })} className="rounded p-1 text-gray-500 hover:bg-white/5 hover:text-red-300 disabled:opacity-30"><Trash2 size={14} /></button>
    </li>)}</ul>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void search(); }}>
      <input value={query} onChange={event => setQuery(event.target.value)} maxLength={80} placeholder="Search Wiro image models" aria-label="Search Wiro image models" disabled={!state?.configured}
        className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 focus:border-violet-400 disabled:opacity-40" />
      <button type="submit" disabled={!!busy || !state?.configured} className="flex items-center gap-1.5 rounded-lg border border-violet-400/20 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-300 disabled:opacity-40">
        {busy === 'search' ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}Search</button>
    </form>
    {results && <ul className="max-h-72 space-y-1.5 overflow-y-auto">{results.length ? results.map(result => <li key={result.slug} className="flex items-start justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
      <div className="min-w-0"><p className="text-xs text-gray-200">{result.title}</p><p className="break-all text-[11px] text-gray-500">{result.slug} · {result.priceSummary}</p></div>
      <button type="button" aria-label={`Add ${result.title}`} disabled={!!busy || result.added} onClick={() => void run('add', { action: 'add', slug: result.slug }, () => setResults(items => items?.map(item => item.slug === result.slug ? { ...item, added: true } : item) || null))}
        className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] text-violet-300 hover:bg-white/5 disabled:text-gray-500">{result.added ? 'Added' : <><Plus size={12} />Add</>}</button>
    </li>) : <li className="text-xs text-gray-500">No image models found.</li>}</ul>}
    {error && <p role="status" className="text-xs text-amber-300">{error}</p>}
  </section>;
}
