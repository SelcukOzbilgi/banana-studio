/** Application routes, verified against the providers' catalogues on 2026-10-20.
 * Auto selects an available route BEFORE submission, never after a paid call. */
export type AIProvider = 'openai' | 'openrouter' | 'gemini' | 'fal' | 'evolink' | 'claude-cli';
export type ProviderChoice = AIProvider | 'auto';
export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: 'OpenAI', openrouter: 'OpenRouter', gemini: 'Google Gemini', fal: 'fal.ai', evolink: 'EvoLink', 'claude-cli': 'Claude (abonelik)',
};
export const PROVIDER_KEYS: Record<AIProvider, string> = {
  openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY', gemini: 'GEMINI_API_KEY', fal: 'FAL_KEY', evolink: 'EVOLINK_API_KEY',
  // Not a key: the desktop server sets this to the verified local CLI path.
  'claude-cli': 'BANANA_CLAUDE_CLI',
};
/** Desktop-only provider: the user's own logged-in Claude Code CLI. */
export const LOCAL_ONLY_PROVIDERS: readonly AIProvider[] = ['claude-cli'];
const unavailableMessage = (provider: AIProvider) => provider === 'claude-cli'
  ? 'Claude CLI bulunamadı (yalnız Mac uygulamasında). Claude Code\'u kurup giriş yap veya AI ayarlarında Auto seç.'
  : `Add your ${PROVIDER_LABELS[provider]} key in Provider keys, or choose Auto in AI settings.`;
export const MODEL_ROUTES: Record<string, readonly AIProvider[]> = {
  'gpt-image-2.5-sunburst': ['openai', 'openrouter', 'fal'],
  'gemini-3-pro-image-preview': ['fal', 'gemini', 'openrouter'],
  'gemini-nano-banana-2.1': ['fal', 'gemini', 'openrouter'],
  'anthropic/claude-opus-5.5': ['claude-cli', 'openrouter'],
  'gpt-6.1-sol': ['openai', 'openrouter'],
  'gemini-3.8-flash': ['gemini', 'openrouter'],
  'seedance-2.0': ['evolink', 'fal', 'openrouter'],
  'seedance-2.5': ['evolink', 'fal', 'openrouter'],
  'minimax-h3': ['fal'],
};
export type ProviderAvailability = Partial<Record<AIProvider, boolean>>;
export function resolveProvider(model: string, choice: unknown, available: ProviderAvailability): AIProvider {
  const routes = MODEL_ROUTES[model];
  if (!Array.isArray(routes)) throw new Error('Unsupported model.');
  if (choice != null && choice !== 'auto') {
    if (!routes.includes(choice as AIProvider)) throw new Error('This provider does not serve the selected model.');
    if (!available[choice as AIProvider]) throw new Error(unavailableMessage(choice as AIProvider));
    return choice as AIProvider;
  }
  const selected = routes.find(provider => available[provider]);
  if (!selected) throw new Error(`This model needs ${routes.map(provider => PROVIDER_LABELS[provider]).join(' or ')}. Add one key in Provider keys; the other keys are optional.`);
  return selected;
}

export const OPENROUTER_MODELS: Record<string, string> = {
  'gpt-image-2.5-sunburst': 'openai/gpt-image-2.5-sunburst',
  'gemini-3-pro-image-preview': 'google/gemini-3-pro-image',
  'gemini-nano-banana-2.1': 'google/gemini-nano-banana-2.1',
  'gpt-6.1-sol': 'openai/gpt-6.1-sol', 'gemini-3.8-flash': 'google/gemini-3.8-flash',
  'anthropic/claude-opus-5.5': 'anthropic/claude-opus-5.5',
  'seedance-2.0': 'bytedance/seedance-2.0', 'seedance-2.5': 'bytedance/seedance-2.5',
};
