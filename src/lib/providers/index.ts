import { anthropic } from './anthropic';
import { gemini } from './gemini';
import { ollama } from './ollama';
import { openai } from './openai';
import type { ProviderAdapter, ProviderType } from './types';

const adapters: Record<ProviderType, ProviderAdapter> = { openai, anthropic, ollama, gemini };

export function getAdapter(type: ProviderType) {
  return adapters[type];
}

export const PROVIDER_LABELS: Record<ProviderType, string> = {
  openai: 'OpenAI-compatible',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
  gemini: 'Google Gemini',
};

export type Preset = {
  name: string;
  type: ProviderType;
  baseUrl: string;
  needsKey: boolean;
  models?: string[];
};

export const PRESETS: Preset[] = [
  { name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  { name: 'Anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true },
  { name: 'Gemini', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', needsKey: true },
  { name: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true },
  { name: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true },
  { name: 'Ollama', type: 'ollama', baseUrl: 'http://192.168.1.10:11434', needsKey: false },
  { name: 'LM Studio', type: 'openai', baseUrl: 'http://192.168.1.10:1234/v1', needsKey: false },
  { name: 'Custom', type: 'openai', baseUrl: '', needsKey: false },
];

export * from './effort';
export * from './types';
