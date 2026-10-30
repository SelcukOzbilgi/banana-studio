import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Bundle the TypeScript prompt modules (their imports use .js specifiers).
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'js', contents: `
export * from './src/lib/prompts/craftRules.ts';
export { buildForkTextGuidance, buildForkFinalPromptAddenda } from './src/lib/prompts/forkGuidance.ts';
export { PRODUCT_SHOT_MODES, buildProductShotModeGuidance, isProductShotMode } from './src/lib/prompts/productShotModes.ts';
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

test('product shot Standard adds nothing; other modes add one guidance block', () => {
  assert.equal(m.PRODUCT_SHOT_MODES[0].id, 'standard');
  assert.equal(m.buildProductShotModeGuidance('standard'), '');
  assert.equal(m.buildProductShotModeGuidance('unknown'), '');
  for (const { id, label } of m.PRODUCT_SHOT_MODES.slice(1)) {
    const block = m.buildProductShotModeGuidance(id);
    assert.ok(block.startsWith(`PRODUCT SHOT MODE · ${label.toUpperCase()}`), id);
    assert.match(block, /never write aspect ratios/);
  }
  const context = { task: 'brainstorm', category: 'product_shot', brief: 'Bottle', edit: false, youtube: false };
  const standard = m.buildForkTextGuidance({ ...context, settings: { productShotMode: 'standard' } });
  assert.doesNotMatch(standard, /PRODUCT SHOT MODE/);
  assert.match(m.buildForkTextGuidance({ ...context, settings: { productShotMode: 'pinterest' } }), /PRODUCT SHOT MODE · PINTEREST PIN/);
  // Only Product Brainstorm uses the mode; Enhance, other categories and local edits do not.
  for (const other of [{ task: 'enhance' }, { category: 'simple' }, { edit: true }]) {
    assert.doesNotMatch(m.buildForkTextGuidance({ ...context, ...other, settings: { productShotMode: 'studio' } }), /PRODUCT SHOT MODE/);
  }
});

test('no-text and text requests read Turkish capitals and word boundaries', () => {
  for (const brief of ['Kahve fincanı, YAZI YOK', 'YAZISIZ bir afiş', 'METİNSİZ ürün fotoğrafı', 'Yazı yok, sade arka plan']) {
    assert.equal(m.requestsNoText(brief), true, brief);
    assert.equal(m.isTextBearingDesign('simple', brief), false, brief);
  }
  assert.equal(m.requestsNoText('WITHOUT ANY TEXT'), true);
  for (const brief of ['Yazılım ekibi ofiste çalışıyor', 'Metin parkta kahve içiyor', 'Overlay the logo on the bottle'])
    assert.equal(m.isTextBearingDesign('simple', brief), false, brief);
  for (const brief of ['Üstünde büyük bir yazı olsun', 'Afişin yazısı kırmızı', 'BAŞLIK ortada', 'Kısa bir başlığı olsun', 'METİN sağda', 'Add a text overlay', 'Bold HEADLINE on top', 'Sloganlı bir kampanya görseli'])
    assert.equal(m.isTextBearingDesign('simple', brief), true, brief);
});

test('an inch mark after a digit never opens a quote; typographic quotes pair with their own closers', () => {
  assert.deepEqual(m.extractQuotedText('27" monitör kampanyası, üstünde "İNDİRİM" yazsın'), ['İNDİRİM']);
  assert.deepEqual(m.extractQuotedText('27" ve 32" ekranlar'), []);
  assert.deepEqual(m.extractQuotedText('Poster “ŞİMDİ AL” and «ÇOK İYİ» and „GÜZEL“'), ['ŞİMDİ AL', 'ÇOK İYİ', 'GÜZEL']);
  assert.match(m.buildExactTextSpellingRule('55" TV, başlık "İNDİRİM"'), /"İNDİRİM" = İ-N-D-İ-R-İ-M/);
});
