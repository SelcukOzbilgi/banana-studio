/** Single entry point for fork additions to prompt guidance. Upstream call
 * sites append these strings at their existing joins; nothing here rewrites
 * upstream templates. */
import { buildCraftRules, buildExactTextSpellingRule, type CraftRuleContext } from './craftRules.js';

export type ForkTextGuidanceContext = CraftRuleContext & { settings: object };

/** Appended to the text-model guidance (Enhance, Brainstorm, Variation). */
export const buildForkTextGuidance = (context: ForkTextGuidanceContext): string =>
  [buildCraftRules(context)].filter(Boolean).join('\n\n');

/** Appended to the final image prompt composed on the server. */
export const buildForkFinalPromptAddenda = (prompt: string, settings: { originalPrompt?: string }, _edit: boolean): string =>
  [buildExactTextSpellingRule(prompt, settings.originalPrompt)].filter(Boolean).join('\n\n');
