import type { AIProvider } from '../providers.js';

export type SeedanceRequest = { videoModel: string; mode: string; prompt?: string; duration: number; quality: string; aspectRatio: string;
  generateAudio?: boolean; referenceEditMode?: boolean; editSourcePreparationVersion?: number; imageUrls?: string[]; videoUrls?: string[]; audioUrls?: string[] };
export function seedanceProviderError(provider: AIProvider, body: SeedanceRequest): string | undefined {
  const newer = body.videoModel === 'seedance-2.5';
  if (!['seedance-2.0','seedance-2.5'].includes(body.videoModel)) return 'Unsupported Seedance model.';
  // Fork: the client's text-only mode is 'text_only' (EvoLink's name); accept it here too.
  if (!['text_only','text_to_video','image_to_video','reference_to_video','video_edit','video_extend'].includes(body.mode)) return 'Unsupported video operation.';
  if (body.mode.startsWith('video_') && !newer) return 'Video editing and extension require Seedance 2.5.';
  const counts = [body.imageUrls?.length || 0, body.videoUrls?.length || 0, body.audioUrls?.length || 0];
  if (counts.some((n, i) => n > (body.mode === 'image_to_video' ? [2,0,0] : newer ? [30,10,10] : [9,3,3])[i]) || counts.reduce((a,b) => a+b,0) > (newer ? 50 : 12)) return 'Too many references for this video mode.';
  if (body.mode === 'image_to_video' && !counts[0]) return 'Choose a first frame.';
  if (body.mode === 'reference_to_video' && !counts[0] && !counts[1]) return 'References mode needs an image or video.';
  if (body.mode.startsWith('video_') && !counts[1]) return 'This operation needs a source video.';
  if (!Number.isInteger(body.duration) || !(body.duration === -1 && newer) && (body.duration < 4 || body.duration > (newer ? 30 : 15))) return 'Choose a supported video duration.';
  if (!['480p','720p','1080p'].includes(body.quality)) return 'Unsupported video resolution.';
  if (!['adaptive','16:9','9:16','1:1','4:3','3:4','21:9'].includes(body.aspectRatio)) return 'Unsupported video aspect ratio.';
  if (provider === 'openrouter') {
    if (body.mode.startsWith('video_') || counts[1] || counts[2] || body.referenceEditMode) return 'OpenRouter supports text, first/last frames and image references here. Choose fal.ai or EvoLink in AI settings for video/audio references, Edit or Extend.';
    if (body.duration === -1) return 'OpenRouter requires a fixed duration. Choose 4–30 seconds or use fal.ai / EvoLink for Auto.';
    if (newer && body.quality === '1080p') return 'Seedance 2.5 on OpenRouter supports 480p and 720p. Choose 720p or use fal.ai / EvoLink for 1080p.';
    if (body.aspectRatio === 'adaptive') return 'Choose an aspect ratio for OpenRouter.';
    if (counts[0] > 9) return 'Use up to 9 image references with this OpenRouter route.';
  }
  // Fork: Wiro routes, from Wiro's Seedance schemas (no video inputs, Edit or Extend).
  if (provider === 'wiro') {
    if (body.mode.startsWith('video_') || counts[1] || body.referenceEditMode) return 'Wiro Seedance supports text, first/last frames and image references. Choose fal.ai or EvoLink in AI settings for video references, Edit or Extend.';
    if (body.duration === -1) return `Wiro needs a fixed duration (4–${newer ? 30 : 15} seconds). 5 seconds at 720p is the cheapest useful setting.`;
    if (counts[2] && newer) return 'Seedance 2.5 on Wiro does not accept reference audio. Remove the audio or choose Seedance 2.0.';
    if (counts[2] && (body.mode !== 'reference_to_video' || !counts[0])) return 'Reference audio on Wiro needs at least one reference image and cannot be combined with first/last frames.';
  }
}
const referencePrompt = (prompt = '') => prompt.replace(/@(?:REF[_ ]?)?IMAGE[_ ]?(\d+)/gi, '@Image$1').replace(/@VIDEO[_ ]?(\d+)/gi, '@Video$1').replace(/@AUDIO[_ ]?(\d+)/gi, '@Audio$1');
export function falSeedanceInput(body: SeedanceRequest) {
  const prompt = (body.prompt || '').replace(/@(?:REF[_ ]?)?IMAGE[_ ]?(\d+)/gi, '@Image$1').replace(/@VIDEO[_ ]?(\d+)/gi, '@Video$1').replace(/@AUDIO[_ ]?(\d+)/gi, '@Audio$1');
  const input: Record<string, unknown> = { prompt, resolution: body.quality, duration: body.duration === -1 ? 'auto' : String(body.duration),
    aspect_ratio: body.aspectRatio === 'adaptive' || body.mode === 'image_to_video' && body.videoModel === 'seedance-2.5' ? 'auto' : body.aspectRatio, generate_audio: body.generateAudio !== false };
  if (body.mode === 'image_to_video') { input.image_url = body.imageUrls?.[0]; if (body.imageUrls?.[1]) input.end_image_url = body.imageUrls[1]; }
  if (['reference_to_video','video_edit','video_extend'].includes(body.mode)) {
    input.image_urls = body.imageUrls || []; input.video_urls = body.videoUrls || []; input.audio_urls = body.audioUrls || [];
    if (body.mode === 'video_edit') { input.task = 'editing'; input.aspect_ratio = 'auto'; input.duration = 'auto'; }
    if (body.mode === 'video_extend') { input.task = 'extension'; input.aspect_ratio = 'auto'; }
  }
  const mode = body.mode.startsWith('video_') ? 'reference-to-video' : body.mode === 'text_only' ? 'text-to-video' : body.mode.replaceAll('_','-');
  return { endpoint: `bytedance/${body.videoModel}/${mode}`, input };
}
export function openRouterSeedanceInput(body: SeedanceRequest) {
  return { model: `bytedance/${body.videoModel}`, prompt: referencePrompt(body.prompt), duration: body.duration, resolution: body.quality,
    ...(body.aspectRatio !== 'adaptive' ? { aspect_ratio: body.aspectRatio } : {}), generate_audio: body.generateAudio !== false,
    ...(body.mode === 'image_to_video' ? { frame_images: body.imageUrls!.map((url, i) => ({ type: 'image_url', image_url: { url }, frame_type: i ? 'last_frame' : 'first_frame' })) }
      : body.imageUrls?.length ? { input_references: body.imageUrls.map(url => ({ type: 'image_url', image_url: { url } })) } : {}),
    provider: { allow_fallbacks: false },
  };
}

/** Fork: short Wiro Seedance tips shown next to the video controls. */
export const WIRO_SEEDANCE_TIPS = 'Wiro tips: with a start frame, describe only the motion; a locked camera loops best; 5 s at 720p is the cheap sweet spot; up to 2 Wiro videos run at once; failed tasks are not billed.';
