/** Fork: per-folder style lock. Shared by the WebView, the API pipeline and the
 * desktop store, so this module has no imports. */
export type StyleLock = { enabled: boolean; paragraph: string; never: string[]; folderName?: string };

export const STYLE_LOCK_LIMITS = { paragraph: 2000, neverItems: 20, neverItem: 160, folderName: 120 } as const;

const clean = (value: unknown, limit: number) => typeof value === 'string'
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, limit) : '';

/** One item per line; list markers and duplicates are dropped. */
export const parseNeverList = (text: string): string[] => {
  const items: string[] = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const item = clean(line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''), STYLE_LOCK_LIMITS.neverItem);
    if (item && !items.some(existing => existing.toLowerCase() === item.toLowerCase())) items.push(item);
    if (items.length >= STYLE_LOCK_LIMITS.neverItems) break;
  }
  return items;
};

/** Bounded copy of an untrusted value. Returns undefined when the value is not
 * an object; `enabled` is only true for a literal true. */
export const sanitizeStyleLock = (value: unknown): StyleLock | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const never = Array.isArray(source.never) ? parseNeverList(source.never.filter(item => typeof item === 'string').join('\n')) : [];
  const folderName = clean(source.folderName, STYLE_LOCK_LIMITS.folderName);
  return { enabled: source.enabled === true, paragraph: clean(source.paragraph, STYLE_LOCK_LIMITS.paragraph), never, ...(folderName ? { folderName } : {}) };
};

/** The lock to apply, or undefined when it is disabled or empty. */
export const activeStyleLock = (value: unknown): StyleLock | undefined => {
  const lock = sanitizeStyleLock(value);
  return lock?.enabled && (lock.paragraph || lock.never.length) ? lock : undefined;
};

/** Paragraph verbatim plus the NEVER list. Empty when the lock does not apply. */
export const buildStyleLockBlock = (value: unknown, audience: 'text' | 'image'): string => {
  const lock = activeStyleLock(value);
  if (!lock) return '';
  return [
    `FOLDER STYLE LOCK${lock.folderName ? ` · ${lock.folderName}` : ''}`,
    'House style for every image in this folder. It sets the look (palette, light, medium, finish); the brief still decides the subject, people and exact copy.',
    audience === 'text' ? 'The app appends this block unchanged to the final image prompt. Keep every prompt compatible with it; do not restate or contradict it.' : '',
    lock.paragraph,
    lock.never.length ? `NEVER: ${lock.never.join('; ')}` : '',
  ].filter(Boolean).join('\n');
};

/** Generation-details record, only when the composed prompt really carries the lock. */
export const styleLockRecord = (composedPrompt: string, value: unknown): { folderName: string } | undefined => {
  const lock = activeStyleLock(value);
  return lock && composedPrompt.includes('FOLDER STYLE LOCK') ? { folderName: lock.folderName || 'Folder' } : undefined;
};
