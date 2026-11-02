/**
 * User-friendly model naming: brand marks instead of provider names, and model ids tidied for
 * display (`llama-swap/qwen3.8-flash-next-mxfp4` → `Qwen3.8 Flash Next MXFP4` with a Qwen mark).
 * Pure logic; the marks themselves live in components/BrandIcon.
 */

/** Brand marks for the model providers and remote backends shown in the UI. */
export type BrandId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'qwen'
  | 'deepseek'
  | 'kimi'
  | 'zai'
  | 'minimax'
  | 'xiaomi'
  | 'tencent'
  | 'hermes';

export const BRAND_IDS: BrandId[] = [
  'openai',
  'anthropic',
  'google',
  'qwen',
  'deepseek',
  'kimi',
  'zai',
  'minimax',
  'xiaomi',
  'tencent',
  'hermes',
];

export function isBrandId(v: unknown): v is BrandId {
  return BRAND_IDS.includes(v as BrandId);
}

/** The brand a single route segment (provider prefix or model id) spells. */
const SEGMENT_BRANDS: [RegExp, BrandId][] = [
  [/claude|anthropic/i, 'anthropic'],
  [/\bgemini|\bbard|\bgemma|google/i, 'google'],
  [/deepseek/i, 'deepseek'],
  [/qwen|qwq|tongyi/i, 'qwen'],
  [/kimi|moonshot/i, 'kimi'],
  [/\bglm|zhipu|z-?ai\b/i, 'zai'],
  [/minimax/i, 'minimax'],
  [/hunyuan|tencent/i, 'tencent'],
  [/xiaomi|mi-?mo/i, 'xiaomi'],
  [/hermes/i, 'hermes'],
  [/\bchatgpt|\bgpt|text-embedding|davinci|whisper|(^|[^0-9a-z])o[1-9]([.-]|$)/i, 'openai'],
];

function segmentBrand(segment: string): BrandId | undefined {
  for (const [re, brand] of SEGMENT_BRANDS) if (re.test(segment)) return brand;
  return undefined;
}

/**
 * The brand a model string names: remote routes carry a provider prefix (`openrouter/qwen/qwen3`),
 * local ids usually name themselves. Later segments win over earlier ones — `llama-swap` and
 * `huggingface` are servers, not brands, while the model at the end is.
 */
export function brandOfModel(model: string): BrandId | undefined {
  const segments = model.split(/[/:]/).filter(Boolean);
  let found: BrandId | undefined;
  for (const s of segments) {
    const b = segmentBrand(s);
    if (b) found = b;
  }
  return found;
}

/** The brand a hosted endpoint belongs to, from its API host, name, and protocol. */
export function brandOfEndpoint(endpoint: { baseUrl: string; name?: string; type: string }): BrandId | undefined {
  let host = endpoint.baseUrl;
  try {
    host = new URL(endpoint.baseUrl).hostname;
  } catch {
    /* keep the raw string when it isn't a URL */
  }
  if (/api\.openai\.com/i.test(host)) return 'openai';
  if (/api\.anthropic\.com/i.test(host)) return 'anthropic';
  if (/generativelanguage\.googleapis\.com/i.test(host)) return 'google';
  if (/api\.deepseek\.com/i.test(host)) return 'deepseek';
  if (/api\.moonshot\.ai|api\.kimi\.com/i.test(host)) return 'kimi';
  if (/bigmodel\.cn|zhipu\.ai|api\.z\.ai/i.test(host)) return 'zai';
  if (/minimax[_-]?(i|io|ai)|api\.minimax/i.test(host)) return 'minimax';
  if (/hunyuan|tencentcloud\.com/i.test(host)) return 'tencent';
  if (/xiaomi|mimo/i.test(host)) return 'xiaomi';
  const named = segmentBrand(endpoint.name ?? '') ?? (endpoint.type === 'anthropic' ? 'anthropic' : endpoint.type === 'gemini' ? 'google' : undefined);
  return named;
}

/** The mark for a remote backend: Hermes has its own, DeepSeek Harness borrows the DeepSeek one. */
export function brandOfBackendKind(kind: 'hermes' | 'harness'): BrandId {
  return kind === 'hermes' ? 'hermes' : 'deepseek';
}

/** Names vendors write a particular way; matched case-insensitively per token. */
const CANONICAL: Record<string, string> = {
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  moonshot: 'Moonshot',
  qwen: 'Qwen',
  qwq: 'QwQ',
  tongyi: 'Tongyi',
  claude: 'Claude',
  gemini: 'Gemini',
  gemma: 'Gemma',
  gpt: 'GPT',
  llama: 'Llama',
  mistral: 'Mistral',
  mixtral: 'Mixtral',
  grok: 'Grok',
  hunyuan: 'Hunyuan',
  minimax: 'MiniMax',
  mimo: 'MiMo',
  glm: 'GLM',
  zhipu: 'Zhipu',
  ernie: 'ERNIE',
  doubao: 'Doubao',
  phi: 'Phi',
  magistral: 'Magistral',
  devstral: 'Devstral',
  command: 'Command',
  aya: 'Aya',
};

/** Word shapes that read better all caps; everything else is title-cased. */
const UPPER = /^(gguf|awq|mlx|mxfp[46]|fp[168][ce]?|int[245678]|nf[234]|qlora|bnb|exl[23]|dpo|sft)$/i;
const SIZE = /^a?\d+(\.\d+)?[bm]$/i;
/** llama.cpp quant tags stay one token: q4_k_m → Q4_K_M. */
const QUANT = /^q\d(_[a-z]+)+$/i;

function humanizeToken(token: string): string {
  if (!token) return token;
  const canonical = CANONICAL[token.toLowerCase()];
  if (canonical) return canonical;
  // Already mixed case (KimiK2): leave it as the vendor wrote it.
  if (token.slice(1).match(/[A-Z]/)) return token;
  if (QUANT.test(token)) return token.toUpperCase();
  if (SIZE.test(token)) return token.toUpperCase();
  if (UPPER.test(token)) return token.toUpperCase();
  return token[0].toUpperCase() + token.slice(1);
}

/**
 * The name to show for a model id: the route prefix is dropped (the brand mark represents it),
 * separators become spaces, versions and acronyms are tidied.
 * `llama-swap/qwen3.8-flash-next-mxfp4` → `Qwen3.8 Flash Next MXFP4`.
 */
export function friendlyModelName(model: string): string {
  const name = model.split(/[/:]/).filter(Boolean).pop() ?? model;
  // Split on separators, but keep a dot between digits (qwen3.8) as part of the token.
  const tokens = name.replace(/\.(?=\d)/g, '·').split(/[-_. ]+/).filter(Boolean);
  return tokens.map((t) => humanizeToken(t.replace(/·/g, '.'))).join(' ');
}
