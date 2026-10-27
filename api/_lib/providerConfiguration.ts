export const missingProviderMessage = (provider: string, variable: string): string => process.env.BANANA_RUNTIME === 'local'
  ? `Open Provider keys and add your ${provider} API key before using this feature.`
  : `${provider} is not configured. The workspace owner must add ${variable} to the server environment.`;
import { PROVIDER_KEYS, PROVIDER_SECRET_KEYS, resolveProvider, type AIProvider, type ProviderAvailability } from '../../src/lib/providers.js';

export const providerAvailability = (): ProviderAvailability => Object.fromEntries(
  Object.entries(PROVIDER_KEYS).map(([provider, key]) => { const secret = PROVIDER_SECRET_KEYS[provider as AIProvider];
    return [provider, Boolean(process.env[key]?.trim()) && (!secret || Boolean(process.env[secret]?.trim())) && process.env[`${provider.toUpperCase()}_ENABLED`] !== 'false']; }),
);
export const chooseProvider = (model: string, preference?: unknown) => resolveProvider(model, preference, providerAvailability());
