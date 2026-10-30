import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Bundle the TypeScript prompt modules (their imports use .js specifiers).
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
export * from './src/lib/prompts/craftRules.ts';
export { buildForkTextGuidance, buildForkFinalPromptAddenda } from './src/lib/prompts/forkGuidance.ts';
export { buildSunburstGenerationPrompt } from './src/lib/images/imagePrompting.ts';` },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const m = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const settings = { imageModel: 'gpt-image-2.5-sunburst', aspectRatio: '16:9', resolution: '1K' };

test('spellExactText spells letters and separates words without changing the text', () => {
  assert.equal(m.spellExactText('ŞAŞIRTICI'), 'Ş-A-Ş-I-R-T-I-C-I');
  assert.equal(m.spellExactText('  İYİ  FİYAT '), 'İ-Y-İ / F-İ-Y-A-T');
  // Decomposed input is normalized so a combining dot is not spelled separately.
  assert.equal(m.spellExactText('İY'), 'İ-Y');
});

test('only quoted strings with Turkish or other non-ASCII letters are spelled', () => {
  assert.deepEqual(m.specialQuotedText('Başlık "ŞOK FİYAT" ve "SALE" @REFERENCE[ı] “Çılgın”'), ['ŞOK FİYAT', 'Çılgın']);
  assert.equal(m.buildExactTextSpellingRule('A cover with "SALE" text'), '');
  const rule = m.buildExactTextSpellingRule('"ŞAŞIRTICI"');
  assert.match(rule, /^EXACT TEXT SPELLING/);
  assert.match(rule, /"ŞAŞIRTICI" = Ş-A-Ş-I-R-T-I-C-I \(Ş = S with cedilla; I = capital I without a dot\)/);
  assert.match(rule, /dotted İ vs dotless I/);
});

test('the same quoted string from the prompt and the original brief is listed once', () => {
  const rule = m.buildExactTextSpellingRule('Use "ÇOK İYİ" big', 'Brief: "ÇOK İYİ"');
  assert.equal(rule.match(/"ÇOK İYİ" =/g).length, 1);
});

test('overlay layout rules apply to text-bearing designs and never to no-text or edits', () => {
  const base = { task: 'brainstorm', aspectRatio: '16:9', edit: false, youtube: true, category: 'youtube_thumbnail' };
  const youtube = m.buildCraftRules({ ...base, brief: 'Video about AI agents' });
  assert.match(youtube, /OVERLAY TEXT LAYOUT/);
  assert.match(youtube, /lower-right corner/);
  assert.match(youtube, /Do not repeat the video title/);
  assert.match(youtube, /COLOUR AND SPACE[\s\S]*#0B1F3A[\s\S]*negative space/);
  const noText = m.buildCraftRules({ ...base, brief: 'Video about AI agents, no text' });
  assert.doesNotMatch(noText, /OVERLAY TEXT LAYOUT/);
  assert.doesNotMatch(noText, /negative space where the overlay/);
  const square = m.buildCraftRules({ ...base, aspectRatio: '1:1', brief: 'Video' });
  assert.doesNotMatch(square, /lower-right/);
  const edit = m.buildCraftRules({ ...base, edit: true, brief: 'Replace the word with "İNDİRİM"' });
  assert.doesNotMatch(edit, /OVERLAY|COLOUR/);
  assert.match(edit, /İ-N-D-İ-R-İ-M/);
  const plain = m.buildCraftRules({ task: 'enhance', category: 'simple', brief: 'A cat on a sofa', edit: false, youtube: false });
  assert.doesNotMatch(plain, /OVERLAY/);
  const copy = m.buildCraftRules({ task: 'enhance', category: 'simple', brief: 'Poster with "YAZ İNDİRİMİ"', edit: false, youtube: false });
  assert.match(copy, /exact copy: keep it word for word/);
});

test('the final Sunburst prompt keeps quoted copy verbatim and appends the spelling', () => {
  const prompt = 'Thumbnail with the headline "ŞAŞIRTICI SONUÇ" on the left';
  const final = m.buildSunburstGenerationPrompt(prompt, [], settings);
  assert.ok(final.includes('"ŞAŞIRTICI SONUÇ" on the left'));
  assert.ok(final.includes('Ş-A-Ş-I-R-T-I-C-I / S-O-N-U-Ç'));
  assert.ok(final.indexOf('CREATIVE BRIEF') < final.indexOf('EXACT TEXT SPELLING'));
  assert.ok(!m.buildSunburstGenerationPrompt('A quiet beach at dawn', [], settings).includes('EXACT TEXT SPELLING'));
});
