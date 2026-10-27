import type { PromptPreparation } from '../../types.js';
import { OPENAI_TEXT_MODEL, isOpenAIReasoningEffort } from './openaiText.js';
import { OPENROUTER_TEXT_MODEL } from './openrouterText.js';
import { PROVIDER_LABELS } from '../providers.js';

/** Keep only recorded task data. Never fill historical gaps with today's preferences. */
export const normalizePromptPreparation = (value: unknown): PromptPreparation | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.action !== 'string' || !['enhance', 'brainstorm', 'variation'].includes(record.action)
    || typeof record.model !== 'string' || !record.model.trim() || record.model.length > 120) return undefined;
  const result: PromptPreparation = { action: record.action as PromptPreparation['action'], model: record.model.trim() };
  const reasoningModel = result.model === OPENAI_TEXT_MODEL || result.model === OPENROUTER_TEXT_MODEL;
  if (reasoningModel && isOpenAIReasoningEffort(record.reasoningEffort)) result.reasoningEffort = record.reasoningEffort;
  if (!reasoningModel && typeof record.thinkingLevel === 'string' && ['LOW', 'MEDIUM', 'HIGH'].includes(record.thinkingLevel)) {
    result.thinkingLevel = record.thinkingLevel as PromptPreparation['thinkingLevel'];
  }
  if (typeof record.provider === 'string' && Object.hasOwn(PROVIDER_LABELS, record.provider)) result.provider = record.provider as PromptPreparation['provider'];
  return result;
};

export const createPromptPreparation = (
  action: PromptPreparation['action'],
  options: { model?: string; reasoningEffort?: unknown; thinkingLevel?: unknown; provider?: unknown },
): PromptPreparation | undefined => normalizePromptPreparation({ action, ...options });
