import type { EffortParam, ProviderType } from './types';

const LOW_MEDIUM_HIGH = ['low', 'medium', 'high'];

// Open-weight models whose chat templates can switch thinking on and off.
const HYBRID_THINKING =
  /qwen3|qwq|deepseek-(r1|v3\.[1-9])|glm-(4\.[5-9]|[5-9])|magistral|phi-4-(mini-)?reasoning|seed-oss|nemotron|exaone|granite-?[4-9]|hunyuan|smollm3|kimi/;

/**
 * Effort levels for models whose API doesn't report them, guessed from the model name.
 * Users can correct the result per model in the endpoint settings.
 */
export function guessEfforts(type: ProviderType, model: string, effortParam?: EffortParam): string[] | undefined {
  const id = model.toLowerCase();
  switch (type) {
    case 'openai':
      if (effortParam === 'chat_template_kwargs') {
        if (id.includes('gpt-oss')) return LOW_MEDIUM_HIGH;
        return HYBRID_THINKING.test(id) ? ['off', 'on'] : undefined;
      }
      // o-series, GPT-5 and gpt-oss, also behind prefixes like OpenRouter's "openai/".
      return /(^|\/)(o\d|gpt-5|gpt-oss)/.test(id) ? LOW_MEDIUM_HIGH : undefined;
    case 'gemini':
      if (/gemini-3[\w.-]*-pro/.test(id)) return ['low', 'high'];
      return /gemini-(2\.5|[3-9])/.test(id) ? LOW_MEDIUM_HIGH : undefined;
    case 'ollama':
      return id.includes('gpt-oss') ? LOW_MEDIUM_HIGH : undefined;
    case 'anthropic':
      // The Models API reports effort support, so there is nothing to guess.
      return undefined;
  }
}

/** The level the slider starts on for a model the user hasn't set one for. */
export function defaultEffort(levels: string[]) {
  return levels.includes('medium') ? 'medium' : levels[levels.length - 1];
}

/** Splits a level into the highlighted word and the rest, e.g. "Medium" + "effort". */
export function describeEffort(level: string): [string, string] {
  switch (level) {
    case 'off':
    case 'none':
      return ['No', 'thinking'];
    case 'on':
      return ['Thinking', 'on'];
    case 'xhigh':
      return ['Extra high', 'effort'];
    default:
      return [level.charAt(0).toUpperCase() + level.slice(1), 'effort'];
  }
}
