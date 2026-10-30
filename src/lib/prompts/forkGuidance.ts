/** Single entry point for fork additions to prompt guidance. Upstream call
 * sites append these strings at their existing joins; nothing here rewrites
 * upstream templates. */
import { buildCraftRules, buildExactTextSpellingRule, type CraftRuleContext } from './craftRules.js';
import { buildProductShotModeGuidance, type ProductShotMode } from './productShotModes.js';
import { buildStyleLockBlock, type StyleLock } from '../styleLock/styleLock.js';

export type ForkPromptSettings = { productShotMode?: ProductShotMode; styleLock?: StyleLock };
export type ForkTextGuidanceContext = CraftRuleContext & { settings: ForkPromptSettings };

/** Appended to the text-model guidance (Enhance, Brainstorm, Variation). */
export const buildForkTextGuidance = (context: ForkTextGuidanceContext): string =>
  [
    context.task === 'brainstorm' && context.category === 'product_shot' && !context.edit ? buildProductShotModeGuidance(context.settings.productShotMode) : '',
    buildCraftRules(context),
    // A house style would fight a local edit's "change nothing else" contract.
    context.edit ? '' : buildStyleLockBlock(context.settings.styleLock, 'text'),
  ].filter(Boolean).join('\n\n');

/** Appended to the final image prompt composed on the server. */
export const buildForkFinalPromptAddenda = (prompt: string, settings: { originalPrompt?: string; styleLock?: unknown }, edit: boolean): string =>
  [buildExactTextSpellingRule(prompt, settings.originalPrompt), edit ? '' : buildStyleLockBlock(settings.styleLock, 'image')].filter(Boolean).join('\n\n');
