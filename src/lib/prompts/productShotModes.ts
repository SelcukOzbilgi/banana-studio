/** Brainstorm "Product" modes (fork). "standard" adds nothing, so the
 * brief-led Brainstorm stays exactly as upstream. Mode taxonomy inspired by
 * the higgsfield-studio product photoshoot skill (ideas only); the guidance
 * text is written for this app. */
export const PRODUCT_SHOT_MODES = [
  { id: 'standard', label: 'Standard' },
  { id: 'studio', label: 'Studio / catalog' },
  { id: 'lifestyle', label: 'Lifestyle scene' },
  { id: 'hands', label: 'Close-up with hands/person' },
  { id: 'hero_banner', label: 'Hero banner (wide)' },
  { id: 'pinterest', label: 'Pinterest pin (vertical 2:3)' },
  { id: 'conceptual', label: 'Conceptual / CGI' },
  { id: 'restyle', label: 'Restyle existing image' },
] as const;
export type ProductShotMode = typeof PRODUCT_SHOT_MODES[number]['id'];
export const DEFAULT_PRODUCT_SHOT_MODE: ProductShotMode = 'standard';
export const isProductShotMode = (value: unknown): value is ProductShotMode =>
  PRODUCT_SHOT_MODES.some(mode => mode.id === value);

const CANVAS_NOTE = 'The suggested framing is advice only: compose for the canvas the user selected and never write aspect ratios or pixel sizes into the prompt.';

const GUIDANCE: Record<Exclude<ProductShotMode, 'standard'>, string> = {
  studio: `Catalogue presentation. The product is the only hero on a seamless sweep or soft gradient backdrop. Show true colour and material; light it with a large softbox key, gentle fill and a thin rim so the edges separate from the background. Keep the whole product sharp (macro-lens look, deep focus) with a soft contact shadow or a subtle floor reflection. Labels stay legible and undistorted. Suggested framing: square or 4:5.`,
  lifestyle: `Lifestyle scene. Place the product where it is really used, in a believable setting that matches its audience. The environment supports the product and never competes with it: natural window light or golden-hour light, a 35–50 mm perspective, shallow depth of field with the product in crisp focus. A few props echo the brand palette. Suggested framing: 4:5 or 3:2.`,
  hands: `Close-up with a person. Show hands, or part of a person, naturally holding, opening, applying or using the product. Keep the pose relaxed and anatomically correct, skin texture realistic, the label turned toward the camera and the product as the focal point. Crop the face out or keep it secondary unless the brief asks for it. Suggested framing: 4:5 or square, 85–100 mm look.`,
  hero_banner: `Wide hero banner. Put the product on one third of the frame with generous, calm negative space on the other side for a headline and a call to action. Use directional, dramatic light and a clean, uncluttered background that extends naturally to the frame edges. Suggested framing: 16:9 or wider.`,
  pinterest: `Vertical Pinterest pin. Build a tall composition with layered depth: the product in the upper-middle, styled props or a flat-lay that leads the eye downward, and a bright, airy, editorial look. Leave a calm band at the top or bottom for a short title overlay. Suggested framing: 2:3 vertical.`,
  conceptual: `Conceptual / CGI. Build one striking idea around the product: levitation, a frozen liquid splash, floating ingredients, surreal scale or unexpected materials. Keep lighting, reflections and shadows physically plausible with high-end render quality, and keep the product's real geometry, colours and branding exact. Suggested framing: square or 4:5.`,
  restyle: `Restyle an existing image. Keep the same product or subject, its shape, label, colours and camera angle. Change only the mood, season, setting, lighting or colour grade the brief asks for, and state clearly what stays fixed. Use the attached image as the source; without one, apply the new mood to the product described in the brief.`,
};

/** Guidance block appended to Brainstorm when a non-standard mode is chosen. */
export const buildProductShotModeGuidance = (mode: unknown): string => {
  if (!isProductShotMode(mode) || mode === 'standard') return '';
  const label = PRODUCT_SHOT_MODES.find(item => item.id === mode)!.label;
  return `PRODUCT SHOT MODE · ${label.toUpperCase()}\nEvery idea uses this presentation while keeping the brief's product, packaging geometry, branding and exact copy. Vary the ideas within the mode.\n${GUIDANCE[mode]}\n${CANVAS_NOTE}`;
};
