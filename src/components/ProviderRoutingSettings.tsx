import React, { useEffect, useState } from 'react';
import { LOCAL_ONLY_PROVIDERS, MODEL_ROUTES, PROVIDER_LABELS, resolveProvider, type AIProvider, type ProviderAvailability, type ProviderChoice } from '../lib/providers';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';
import { getProviderAvailability, getProviderPreferences, saveProviderPreference } from '../services/providerRouting';
import { Dropdown } from './ControlDropdown';

const EVENT = 'banana-provider-routes-changed';
const MODELS: Record<string,string> = {
  'gpt-image-2.5-sunburst':'GPT Image 2.5', 'gemini-3-pro-image-preview':'Nano Banana Pro', 'gemini-nano-banana-2.1':'Nano Banana 2.1',
  'anthropic/claude-opus-5.5':'Claude Opus 5.5', 'gpt-6.1-sol':'GPT-6.1 Sol', 'gemini-3.8-flash':'Gemini 3.8 Flash · text / video analysis',
  'seedance-2.0':'Seedance 2.0', 'seedance-2.5':'Seedance 2.5', 'minimax-h3':'MiniMax H3 Max',
};
export function useProviderRoute(model: string) {
  const [state,setState] = useState<{ model:string; provider?:AIProvider; choice:ProviderChoice; available:ProviderAvailability; error?:string }>({ model:'',choice:'auto',available:{} });
  useEffect(() => {
    let active = true, revision = 0;
    const refresh = async () => {
      const version = ++revision;
      try {
        const [available, preferences] = await Promise.all([getProviderAvailability(),getProviderPreferences()]);
        if (!active || version !== revision) return;
        const choice = preferences[model] || 'auto';
        try { setState({ model,choice,available,provider:resolveProvider(model,choice,available) }); }
        catch (error) { setState({ model,choice,available, ...(choice !== 'auto' && MODEL_ROUTES[model]?.includes(choice) ? {provider:choice} : {}), error:(error as Error).message }); }
      } catch (error) { if (active && version === revision) setState({ model,choice:'auto',available:{},error:(error as Error).message }); }
    };
    void refresh(); window.addEventListener(EVENT,refresh); window.addEventListener('focus',refresh);
    return () => { active = false; window.removeEventListener(EVENT,refresh); window.removeEventListener('focus',refresh); };
  },[model]);
  return state.model === model ? state : { model,choice:'auto' as const,available:{} };
}
export function ProviderRouteControl({ model, compact = false, showError = true }: { model:string; compact?:boolean; showError?:boolean }) {
  const route = useProviderRoute(model);
  const [saving,setSaving] = useState(false), [error,setError] = useState('');
  const save = async (value: ProviderChoice) => {
    setSaving(true); setError('');
    try { await saveProviderPreference(model,value); window.dispatchEvent(new Event(EVENT)); }
    catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  };
  const options = [{value:'auto',label:`Auto${route.provider && route.choice === 'auto' ? ` · ${PROVIDER_LABELS[route.provider]}` : ''}`},
    ...(MODEL_ROUTES[model] || []).filter(provider => isLocalWorkspace() || !LOCAL_ONLY_PROVIDERS.includes(provider))
      .map(provider => ({value:provider,label:`${PROVIDER_LABELS[provider]}${route.available[provider] ? '' : provider === 'claude-cli' ? ' · CLI bulunamadı' : ' · key needed'}`}))];
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
    {compact ? <><span className="text-gray-500">Provider</span><Dropdown label="Provider" value={route.choice} options={options} onSelect={value => void save(value)} disabled={saving} compact /></> : <label className="flex items-center gap-2 text-gray-400">Provider
      <select aria-label={`${MODELS[model] || model} provider`} value={route.choice} disabled={saving}
        className="max-w-full rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-gray-200 focus:border-violet-400"
        onChange={event => void save(event.target.value as ProviderChoice)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>}
    {(error || showError && route.error) && <span role="status" className="text-amber-300">{error || route.error}</span>}
  </div>;
}
export function ProviderRoutingSettings() {
  return <section className="space-y-4 border-t border-white/10 pt-5" aria-labelledby="provider-routing-title">
    <div><h3 id="provider-routing-title" className="font-semibold">Provider routing</h3>
      <p className="mt-2 text-xs leading-relaxed text-gray-400">Add only the keys you need. Auto uses the first configured provider shown for each model. A running request keeps its provider and is never resubmitted to a different service. These route preferences are saved on this device.</p></div>
    {Object.keys(MODELS).map(model => <div key={model}><p className="mb-1.5 text-sm text-gray-200">{MODELS[model]}</p><ProviderRouteControl model={model} showError={false} /></div>)}
    {isLocalWorkspace() && <ClaudeCliSettings />}
    <p className="text-xs leading-relaxed text-gray-500">fal.ai covers image/video models; Enhance and Brainstorm require OpenRouter, OpenAI or Gemini{isLocalWorkspace() ? ', or Claude Opus 5.5 through your own Claude subscription (local Claude Code CLI)' : ''}. YouTube lookup uses a separate YouTube Data API key. H3 Max requires fal.ai. Seedance 2.5 Relaxed is an EvoLink option; other routes use standard Seedance 2.5.</p>
  </section>;
}

type ClaudeCliState = { available: boolean; path?: string; version?: string; source?: string; configuredPath?: string; error?: string };
/** Mac app only. Shows whether the local Claude Code CLI was found and lets the
 * user point to it explicitly. The app never reads Claude credentials. */
function ClaudeCliSettings() {
  const [state,setState] = useState<ClaudeCliState>(), [value,setValue] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const request = async (init?: RequestInit) => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/claude-cli-status', { cache: 'no-store', ...init });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Claude CLI durumu okunamadı.');
      setState(data); setValue(data.configuredPath || (data.source === 'configured' ? data.path : '') || '');
      window.dispatchEvent(new Event(EVENT));
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  useEffect(() => { void request(); }, []);
  const save = (path: string | null) => request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
  return <div className="space-y-2 rounded-lg border border-white/10 p-3 text-xs">
    <p className="text-sm text-gray-200">Claude (abonelik) · Claude Code CLI</p>
    <p role="status" className={state?.available ? 'text-emerald-300' : 'text-amber-300'}>
      {!state ? 'Kontrol ediliyor…' : state.available ? `Bulundu: ${state.path} (v${state.version})` : state.error}
    </p>
    <p className="leading-relaxed text-gray-500">Opus 5.5 metin işleri kendi Claude aboneliğinle, yerelde giriş yapılmış CLI üzerinden çalışır; API anahtarı ve API ücreti yok, abonelik kullanım limitleri geçerli. Kişisel kullanım içindir.</p>
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label="Claude CLI path" value={value} onChange={event => setValue(event.target.value)} placeholder="Otomatik (~/.local/bin/claude, /opt/homebrew/bin/claude …)"
        className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-gray-200 focus:border-violet-400" />
      <button type="button" disabled={busy} onClick={() => void save(value.trim() || null)} className="rounded-lg border border-gray-700 px-2 py-1.5 text-gray-200 hover:border-violet-400 disabled:opacity-50">Kaydet</button>
      {value && <button type="button" disabled={busy} onClick={() => void save(null)} className="rounded-lg px-2 py-1.5 text-gray-400 hover:text-white disabled:opacity-50">Otomatik</button>}
    </div>
    {error && <p role="alert" className="text-amber-300">{error}</p>}
  </div>;
}
