import { GoogleGenAI } from '@google/genai';
import { OPENROUTER_MODELS, type AIProvider } from '../../src/lib/providers.js';
import { providerImageData } from './providerMedia.js';
import { requestWiroImage, WiroError } from './wiro.js';
import { WIRO_BUILTIN_MODELS, WIRO_CUSTOM_EDGE, WIRO_SUNBURST_CUSTOM, wiroCatalogFields, wiroSlugForModel, type WiroControls, type WiroImageOptions } from '../../src/lib/wiro/catalog.js';

export const imageProviderModel = (provider: AIProvider, model: string, references: boolean, exactSize = false): string => provider === 'wiro'
  ? model === 'gpt-image-2.5-sunburst' && exactSize ? WIRO_SUNBURST_CUSTOM : wiroSlugForModel(model) || model
  : provider === 'openrouter'
  ? OPENROUTER_MODELS[model] : provider === 'fal'
    ? model === 'gpt-image-2.5-sunburst' ? `openai/gpt-image-2.5/sunburst/${references ? 'edit' : 'text-to-image'}`
      : `${model === 'gemini-nano-banana-2.1' ? 'google/nano-banana-2.1' : 'fal-ai/nano-banana-pro'}${references ? '/edit' : ''}`
    : model;

export type ImageRequestOptions = {
  /** Wiro: persist the task ID before polling. */
  onTask?: (taskId: string) => Promise<void> | void;
  /** Wiro: recover an already submitted task without a new Run. */
  resumeTaskId?: string;
  pollUntil?: number;
  /** Wiro catalog models: controls from the saved Tool/Detail schema. */
  wiroControls?: WiroControls;
  wiroOptions?: WiroImageOptions;
};

/** Fixed Wiro fields for the three built-in app models (schemas checked 2026-10-27). */
export function wiroBuiltinRequest(model: string, input: Record<string, any>): { slug: string; fields: Record<string, string>; imageField: { id: string; type: string } } {
  const imageField = { id: 'inputImage', type: 'combinefileinput' };
  if (model === 'gpt-image-2.5-sunburst') {
    // Wiro has no "auto" quality; use the model's schema default (low).
    const quality = ['low', 'medium', 'high', 'xhigh', 'max'].includes(input.quality) ? input.quality : 'low';
    const common = { prompt: input.prompt, quality, samples: '1', background: input.background || 'auto', outputFormat: input.output_format || 'png', moderation: input.moderation || 'low' };
    if (input.exact_size) {
      const [width, height] = String(input.size).split('x').map(Number);
      if (![width, height].every(edge => Number.isInteger(edge) && edge >= WIRO_CUSTOM_EDGE.min && edge <= WIRO_CUSTOM_EDGE.max)) throw new WiroError(`Wiro exact sizes need both edges between ${WIRO_CUSTOM_EDGE.min} and ${WIRO_CUSTOM_EDGE.max} px.`);
      return { slug: WIRO_SUNBURST_CUSTOM, fields: { ...common, width: String(width), height: String(height) }, imageField };
    }
    return { slug: WIRO_BUILTIN_MODELS[model], fields: { ...common, resolution: String(input.resolution || '1K').toLowerCase(), ratio: input.aspect_ratio || '1:1' }, imageField };
  }
  if (!WIRO_BUILTIN_MODELS[model]) throw new WiroError('Unsupported Wiro model.');
  return { slug: WIRO_BUILTIN_MODELS[model], fields: { prompt: input.prompt, resolution: input.resolution || '1K', aspectRatio: input.aspect_ratio || '1:1',
    ...(model === 'gemini-nano-banana-2.1' ? { outputFormat: 'png' } : {}) }, imageField };
}

/** All destinations and fields are server-owned. One paid request, no provider retry. */
export async function requestImage(provider: AIProvider, model: string, input: Record<string, any>, db: any, key: string, auditId: string, options: ImageRequestOptions = {}): Promise<Response> {
  if (provider === 'wiro') {
    const images = options.resumeTaskId ? [] : await Promise.all((input.images || []).map((image: any) => providerImageData(db, image.image_url)));
    const request = options.wiroControls
      ? { slug: wiroSlugForModel(model)!, fields: wiroCatalogFields(options.wiroControls, input.prompt, options.wiroOptions), imageField: options.wiroControls.images }
      : wiroBuiltinRequest(model, input);
    if (!request.slug) throw new WiroError('Unsupported Wiro model.');
    return requestWiroImage({ ...request, images, onTask: options.onTask, resumeTaskId: options.resumeTaskId, pollUntil: options.pollUntil });
  }
  const signal = AbortSignal.timeout(250_000);
  const { resolution, aspect_ratio, ...openaiInput } = input;
  if (provider === 'openai') return fetch(`https://api.openai.com/v1/images/${input.images?.length ? 'edits' : 'generations'}`, {
    method: 'POST', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': auditId }, body: JSON.stringify(openaiInput),
  });
  if (provider === 'openrouter') {
    const sunburst = model === 'gpt-image-2.5-sunburst';
    const endpoint = sunburst ? 'openai' : model === 'gemini-3-pro-image-preview' ? 'google-ai-studio/global' : 'google-ai-studio';
    const body = { model: OPENROUTER_MODELS[model], prompt: input.prompt, n: 1,
      ...(sunburst ? { size: input.size, quality: input.quality, background: input.background, output_format: input.output_format }
        : { resolution: input.resolution, aspect_ratio: input.aspect_ratio, output_format: 'png' }),
      ...(input.images?.length ? { input_references: input.images.map((image: any) => ({ type: 'image_url', image_url: { url: image.image_url } })) } : {}),
      provider: { only: [endpoint], allow_fallbacks: false, ...(sunburst ? { options: { openai: { moderation: input.moderation } } } : {}) },
    };
    return fetch('https://openrouter.ai/api/v1/images', { method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'Banana Studio' }, body: JSON.stringify(body) });
  }
  if (provider === 'fal') {
    const sunburst = model === 'gpt-image-2.5-sunburst';
    const body = sunburst ? { prompt: input.prompt, image_size: input.size === 'auto' ? 'auto' : Object.fromEntries(input.size.split('x').map(Number).map((n: number, i: number) => [i ? 'height' : 'width', n])),
      quality: input.quality, num_images: 1, output_format: input.output_format, background: input.background, sync_mode: true,
      ...(input.images?.length ? { image_urls: input.images.map((image: any) => image.image_url) } : {}),
    } : { prompt: input.prompt, aspect_ratio: input.aspect_ratio, resolution: input.resolution, num_images: 1, output_format: 'png', sync_mode: true, ...(model === 'gemini-nano-banana-2.1' ? { thinking_level: 'high' } : {}), ...(input.images?.length ? { image_urls: input.images.map((image: any) => image.image_url) } : {}) };
    const endpoint = imageProviderModel(provider, model, !!input.images?.length);
    const response = await fetch(`https://fal.run/${endpoint}`, {
      method: 'POST', redirect: 'error', signal, headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) return response;
    const value = await response.json();
    const image = value?.images?.[0];
    let bytes: Buffer;
    const data = typeof image?.url === 'string' && image.url.match(/^data:image\/(?:png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/);
    if (data) bytes = Buffer.from(data[1], 'base64');
    else {
      const url = new URL(image?.url);
      if (url.protocol !== 'https:' || !(url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media'))) throw new Error('fal.ai returned an unsupported image location.');
      const file = await fetch(url, { redirect: 'error', signal });
      if (!file.ok || Number(file.headers.get('content-length')) > 50 * 1024 * 1024) throw new Error('Generated image download failed.');
      bytes = Buffer.from(await file.arrayBuffer());
    }
    if (bytes.length > 50 * 1024 * 1024) throw new Error('Generated image exceeds the output limit.');
    return Response.json({ data: [{ b64_json: bytes.toString('base64') }], output_format: input.output_format }, { headers: { 'x-request-id': response.headers.get('x-fal-request-id') || '' } });
  }
  if (provider === 'gemini' && model.startsWith('gemini-')) {
    const parts: any[] = [];
    for (const image of input.images || []) {
      const data = await providerImageData(db, image.image_url);
      const match = data.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
      if (!match) throw new Error('This reference could not be prepared for Gemini.');
      parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }
    parts.push({ text: input.prompt });
    const result = await new GoogleGenAI({ apiKey: key }).models.generateContent({ model, contents: { parts },
      config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: input.aspect_ratio, imageSize: input.resolution },
        abortSignal: signal, httpOptions: { timeout: 250_000 } } });
    const output = result.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)?.inlineData;
    return Response.json({ data: output?.data ? [{ b64_json: output.data, media_type: output.mimeType }] : [], usage: result.usageMetadata, output_format: output?.mimeType?.split('/')[1] || 'png' });
  }
  throw new Error('Unsupported image provider route.');
}
