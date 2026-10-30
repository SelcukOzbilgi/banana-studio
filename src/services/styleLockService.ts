/** Fork: per-folder style locks (Mac workspace only). Locks live in the local
 * store; this module caches them, tracks the active target folder and lets
 * text tasks and image submissions read the lock without new props. */
import { useSyncExternalStore } from 'react';
import { supabase } from './authService';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';
import { activeStyleLock, sanitizeStyleLock, type StyleLock } from '../lib/styleLock/styleLock';

type State = { locks: Readonly<Record<string, StyleLock>>; names: Readonly<Record<string, string>>; activeFolderId: string | null };
let state: State = { locks: {}, names: {}, activeFolderId: null };
const listeners = new Set<() => void>();
const update = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };

export const styleLocksSupported = () => isLocalWorkspace();

export async function loadFolderStyleLocks(): Promise<void> {
  if (!styleLocksSupported()) return;
  const { data, error } = await supabase.rpc('get_folder_style_locks');
  if (error) throw new Error('Folder style locks could not be loaded.');
  const locks: Record<string, StyleLock> = {};
  for (const [id, value] of Object.entries((data || {}) as Record<string, unknown>)) {
    const lock = sanitizeStyleLock(value);
    if (lock) locks[id] = lock;
  }
  update({ locks });
}

export async function saveFolderStyleLock(folderId: string, lock: StyleLock): Promise<void> {
  if (!styleLocksSupported()) throw new Error('Style locks are available in the Mac app.');
  const { data, error } = await supabase.rpc('save_folder_style_lock', { p_folder_id: folderId, p_lock: { enabled: lock.enabled, paragraph: lock.paragraph, never: lock.never } });
  if (error) throw new Error('The style lock could not be saved.');
  const saved = sanitizeStyleLock(data);
  const locks = { ...state.locks };
  if (saved) locks[folderId] = saved; else delete locks[folderId];
  update({ locks });
}

export const setStyleLockFolderNames = (folders: readonly { id: string; name: string }[]) =>
  update({ names: Object.fromEntries(folders.map(folder => [folder.id, folder.name])) });
export const setActiveStyleLockFolder = (folderId: string | null) => { if (state.activeFolderId !== folderId) update({ activeFolderId: folderId }); };

/** Saved lock (enabled or not) for the settings dialog. */
export const getSavedFolderStyleLock = (folderId: string): StyleLock | undefined => state.locks[folderId];
/** The lock to apply for a target folder, with its current name; undefined when off or empty. */
export const getFolderStyleLock = (folderId: string | null | undefined): StyleLock | undefined => {
  if (!folderId) return undefined;
  const lock = activeStyleLock(state.locks[folderId]);
  return lock && { ...lock, folderName: state.names[folderId] || lock.folderName };
};
export const getActiveStyleLock = () => getFolderStyleLock(state.activeFolderId);

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;
/** Re-renders when locks, names or the active folder change. */
export const useStyleLockState = () => useSyncExternalStore(subscribe, snapshot, snapshot);
export const useActiveStyleLock = () => { const current = useStyleLockState(); return getFolderStyleLock(current.activeFolderId); };
