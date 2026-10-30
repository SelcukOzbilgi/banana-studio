/** Fork prompt-craft rules (Efe's Mac fork). Standalone like youtubeCameraGaze:
 * the builders return rule text that call sites append at their existing
 * `.join('\n\n')`; upstream templates are not rewritten. Rules adapt ideas from
 * Avenox (MIT) thumbnail and gpt-image prompting notes; wording is our own. */
import type { BrainstormCategory } from '../../types.js';

// Straight and typographic double quotes. Single quotes are skipped on purpose:
// Turkish uses apostrophes inside words ("İstanbul'da").
const QUOTED = /["“”„«»]([^"“”„«»\n]{1,160})["“”„«»]/g;
const REFERENCE_TOKEN = /@REFERENCE\[[^\]\n]*\]/g;
const TURKISH = /[İıŞşĞğÜüÖöÇç]/;
const NON_ASCII_LETTER = /[^\u0000-\u007f]/;
const MAX_SPELLED = 8;

/** Quoted strings from the brief(s), in order, deduplicated. Reference tokens
 * are app syntax, not copy. */
export const extractQuotedText = (...sources: (string | undefined)[]): string[] => {
  const found: string[] = [];
  for (const source of sources) {
    if (!source) continue;
    for (const match of source.replace(REFERENCE_TOKEN, ' ').matchAll(QUOTED)) {
      const text = match[1].trim();
      if (text && !found.includes(text)) found.push(text);
    }
  }
  return found;
};

const hasSpecialLetters = (text: string) => Array.from(text).some(char => NON_ASCII_LETTER.test(char) && /\p{L}/u.test(char));

/** Deterministic letter-by-letter form: letters joined by "-", words by " / ".
 * The input string itself is never modified. */
export const spellExactText = (text: string): string => text.normalize('NFC').trim().split(/\s+/).filter(Boolean)
  .map(word => Array.from(word).join('-')).join(' / ');

const LETTER_NOTES: Record<string, string> = {
  'İ': 'İ = capital I with a dot', 'ı': 'ı = small i without a dot', 'Ş': 'Ş = S with cedilla', 'ş': 'ş = s with cedilla',
  'Ğ': 'Ğ = G with breve', 'ğ': 'ğ = g with breve', 'Ç': 'Ç = C with cedilla', 'ç': 'ç = c with cedilla',
  'Ö': 'Ö = O with two dots', 'ö': 'ö = o with two dots', 'Ü': 'Ü = U with two dots', 'ü': 'ü = u with two dots',
};
const letterNotes = (text: string): string[] => {
  const chars = new Set(Array.from(text.normalize('NFC')));
  const notes = Object.entries(LETTER_NOTES).filter(([char]) => chars.has(char)).map(([, note]) => note);
  // In Turkish capitals a plain I is the dotless letter; say so when it matters.
  if (TURKISH.test(text) && chars.has('I')) notes.push('I = capital I without a dot');
  return notes;
};

/** Quoted strings that need letter-level protection (Turkish or other non-ASCII letters). */
export const specialQuotedText = (...sources: (string | undefined)[]): string[] =>
  extractQuotedText(...sources).filter(hasSpecialLetters).slice(0, MAX_SPELLED);

/** Rule attached to the final image prompt and the text-model guidance. */
export const buildExactTextSpellingRule = (...sources: (string | undefined)[]): string => {
  const texts = specialQuotedText(...sources);
  if (!texts.length) return '';
  return [
    'EXACT TEXT SPELLING',
    'Where a quoted string below appears as visible text, render it exactly as written, letter by letter, with the same case and every diacritic. Do not swap look-alike letters: dotted İ vs dotless I, ı vs i, Ş vs S, Ğ vs G, Ç vs C, Ö vs O, Ü vs U.',
    ...texts.map(text => {
      const notes = letterNotes(text);
      return `- "${text}" = ${spellExactText(text)}${notes.length ? ` (${notes.join('; ')})` : ''}`;
    }),
  ].join('\n');
};

const NO_TEXT = /\b(?:no text|without (?:any )?text|text-?free|no words|no lettering|no typography|no captions?)\b|yazısız|yazı olmadan|yazı olmasın|yazı yok|metinsiz|metin olmadan|metin yok/i;
const TEXT_REQUEST = /\b(?:text|headline|caption|typography|lettering|slogan|tagline|title text|overlay)\b|yazı|başlık|metin|slogan/i;

export const requestsNoText = (brief: string): boolean => NO_TEXT.test(brief);
/** Designs whose layout should plan for overlay text. A no-text request always wins. */
export const isTextBearingDesign = (category: BrainstormCategory | undefined, brief: string, youtube = false): boolean =>
  !requestsNoText(brief) && (youtube || category === 'youtube_thumbnail' || category === 'social_media'
    || extractQuotedText(brief).length > 0 || TEXT_REQUEST.test(brief));

export const buildOverlayTextRule = (options: { youtube: boolean; wide: boolean; exactCopy: boolean }): string => [
  'OVERLAY TEXT LAYOUT',
  `These defaults apply only to text you propose. ${options.exactCopy ? 'The user supplied exact copy: keep it word for word, in their language and placement; apply only the styling and layout points that do not change it.' : 'Keep any exact user copy word for word.'} A no-text request means no text.`,
  '- Headline of 2–4 words in a heavy sans-serif: white, with ONE word in the accent colour, and a thick dark outline so it reads at small sizes.',
  '- Text on one side, the main subject on the other. At most 3 main elements and one clear focal point.',
  options.youtube && options.wide ? '- Keep the lower-right corner free of text and key details; the player duration badge covers it.' : '',
  options.youtube ? '- Do not repeat the video title word for word; the cover text should add to the title, not copy it.' : '',
].filter(Boolean).join('\n');

export const buildColourSpaceRule = (textBearing: boolean): string => [
  'COLOUR AND SPACE',
  '- When colour matters, name the palette with hex codes (for example deep navy #0B1F3A, warm off-white #F4EFE6). Keep supplied brand colours.',
  '- Choose one accent by the intended emotion: red for urgency, green for success or money, blue for tech, purple for automation, gold for value.',
  textBearing ? '- Reserve calm, low-detail negative space where the overlay text will sit.' : '',
].filter(Boolean).join('\n');

export type CraftRuleContext = {
  task: 'enhance' | 'brainstorm' | 'variation';
  category?: BrainstormCategory;
  brief: string;
  originalPrompt?: string;
  aspectRatio?: string;
  /** Local edit: only spelling protection applies; layout and colour rules would fight "change nothing else". */
  edit: boolean;
  youtube: boolean;
};

/** Text-model craft rules for image prompts. Empty when nothing applies. */
export const buildCraftRules = (context: CraftRuleContext): string => {
  const spelling = buildExactTextSpellingRule(context.brief, context.originalPrompt);
  const spellingNote = spelling ? `${spelling}\nKeep these quoted strings unchanged in your prompt; the app attaches this spelling to the final image prompt.` : '';
  if (context.edit) return spellingNote;
  const textBearing = isTextBearingDesign(context.category, context.brief, context.youtube);
  return [
    spellingNote,
    textBearing ? buildOverlayTextRule({ youtube: context.youtube || context.category === 'youtube_thumbnail', wide: context.aspectRatio === '16:9', exactCopy: extractQuotedText(context.brief).length > 0 }) : '',
    buildColourSpaceRule(textBearing),
  ].filter(Boolean).join('\n\n');
};
