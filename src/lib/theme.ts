import { Platform, useColorScheme } from 'react-native';

// Palettes sampled from the ChatGPT apps.
const light = {
  background: '#FFFFFF',
  sidebar: '#F9F9F9',
  surface: '#F4F4F4',
  surfaceHover: '#ECECEC',
  userBubble: '#F4F4F4',
  text: '#0D0D0D',
  textSecondary: '#5D5D5D',
  textTertiary: '#8F8F8F',
  border: '#E5E5E5',
  composer: '#F2F2F2',
  chrome: '#F4F4F4',
  chromeBorder: '#E6E6E6',
  segmentTrack: '#E8E8E8',
  segmentThumb: '#FFFFFF',
  toggleTrack: '#DADADA',
  accent: '#3C6CF0',
  accentFg: '#FFFFFF',
  accentText: '#3C6CF0',
  sendBg: '#000000',
  sendFg: '#FFFFFF',
  codeBg: '#F9F9F9',
  codeHeader: '#F0F0F0',
  inlineCode: '#ECECEC',
  link: '#2964AA',
  success: '#1A7F37',
  danger: '#E02E2A',
  dangerBg: '#FDECEC',
  overlay: 'rgba(0,0,0,0.4)',
};

export type Colors = typeof light;

const dark: Colors = {
  background: '#000000',
  sidebar: '#171717',
  surface: '#2F2F2F',
  surfaceHover: '#3A3A3A',
  userBubble: '#303030',
  text: '#ECECEC',
  textSecondary: '#B4B4B4',
  textTertiary: '#8E8E8E',
  border: '#3A3A3A',
  composer: '#2F2F2F',
  chrome: '#232323',
  chromeBorder: '#333333',
  segmentTrack: '#3A3A3A',
  segmentThumb: '#1E1E1E',
  toggleTrack: '#4A4A4A',
  accent: '#3C6CF0',
  accentFg: '#FFFFFF',
  accentText: '#93B1FF',
  sendBg: '#FFFFFF',
  sendFg: '#000000',
  codeBg: '#171717',
  codeHeader: '#2F2F2F',
  inlineCode: '#424242',
  link: '#7AB7FF',
  success: '#4ADE80',
  danger: '#F87171',
  dangerBg: '#3B1F1F',
  overlay: 'rgba(0,0,0,0.6)',
};

export function useTheme() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, colors: scheme === 'dark' ? dark : light } as const;
}

export const fonts = {
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }),
};
