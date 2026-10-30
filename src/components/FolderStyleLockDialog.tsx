import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Lock, X } from 'lucide-react';
import type { Folder } from '../types';
import { parseNeverList, STYLE_LOCK_LIMITS } from '../lib/styleLock/styleLock';
import { getSavedFolderStyleLock, saveFolderStyleLock } from '../services/styleLockService';

/** Fork: per-folder house style. Applied to Enhance, Brainstorm and image
 * generation while this folder is the target folder. */
export const FolderStyleLockDialog: React.FC<{ folder: Folder; onClose: () => void }> = ({ folder, onClose }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const saved = getSavedFolderStyleLock(folder.id);
  const [enabled, setEnabled] = useState(saved?.enabled ?? false);
  const [paragraph, setParagraph] = useState(saved?.paragraph ?? '');
  const [never, setNever] = useState((saved?.never ?? []).join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const neverItems = parseNeverList(never);
  const save = async () => {
    setBusy(true); setError('');
    try { await saveFolderStyleLock(folder.id, { enabled, paragraph: paragraph.trim(), never: neverItems }); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The style lock could not be saved.'); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    aria-labelledby="folder-style-title" className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-white/10 bg-[#161b22] p-6 text-gray-200 shadow-2xl backdrop:bg-black/75">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0"><h2 id="folder-style-title" className="flex items-center gap-2 text-lg font-semibold"><Lock className="h-5 w-5 text-amber-400" /> Folder settings</h2>
        <p className="mt-1 break-words text-sm text-gray-400">{folder.name}</p></div>
      <button aria-label="Close folder settings" onClick={onClose} disabled={busy} className="rounded-lg p-2 hover:bg-white/5 disabled:opacity-40"><X className="h-5 w-5" /></button>
    </div>
    <label className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5">
      <span><span className="block text-sm font-medium">Style lock</span>
        <span className="block text-xs text-gray-400">Adds this style to Enhance, Brainstorm and image prompts while this folder is the target.</span></span>
      <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} className="h-4 w-4 accent-amber-500" />
    </label>
    <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-gray-400" htmlFor="style-lock-paragraph">Style paragraph</label>
    <textarea id="style-lock-paragraph" value={paragraph} maxLength={STYLE_LOCK_LIMITS.paragraph} onChange={event => setParagraph(event.target.value)} rows={5}
      placeholder="e.g. Warm film photography, soft window light, muted earth palette (#8A5A44, #E9DCC9), matte finish, generous negative space."
      className="mt-1.5 w-full resize-y rounded-xl border border-white/[0.08] bg-black/30 p-3 text-sm text-gray-200 placeholder:text-gray-600 focus:border-amber-500/60 focus:outline-none" />
    <p className="mt-1 text-right text-[10px] text-gray-500">{paragraph.length}/{STYLE_LOCK_LIMITS.paragraph}</p>
    <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-gray-400" htmlFor="style-lock-never">Never (one per line)</label>
    <textarea id="style-lock-never" value={never} onChange={event => setNever(event.target.value)} rows={4}
      placeholder={'neon colours\nstock-photo smiles\nwatermarks'}
      className="mt-1.5 w-full resize-y rounded-xl border border-white/[0.08] bg-black/30 p-3 text-sm text-gray-200 placeholder:text-gray-600 focus:border-amber-500/60 focus:outline-none" />
    <p className="mt-1 text-[10px] text-gray-500">{neverItems.length}/{STYLE_LOCK_LIMITS.neverItems} items. Local edits are never restyled.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <button onClick={onClose} disabled={busy} className="h-9 rounded-lg border border-white/[0.08] px-4 text-sm text-gray-300 hover:text-white disabled:opacity-40">Cancel</button>
      <button onClick={save} disabled={busy} className="flex h-9 items-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
    </div>
  </dialog>;
};
