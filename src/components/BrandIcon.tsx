import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { BRAND_PATHS, BRAND_VIEWBOX } from '@/lib/brandPaths';
import type { BrandId } from '@/lib/modelNames';
import { useTheme } from '@/lib/theme';

export type { BrandId };

/**
 * The mark drawn on its own, without a label. Monochrome marks follow the theme text color so
 * they read on both palettes; color marks are tuned per scheme where the brand color sits badly
 * on one of them (Tencent's dark blue vanishes on black).
 */
export function BrandIcon({ brand, size }: { brand: BrandId; size: number }) {
  const { scheme, colors } = useTheme();
  const mono = colors.text;
  const paths = BRAND_PATHS[brand];
  const box = BRAND_VIEWBOX[brand];
  const common = { fillRule: 'evenodd' as const, clipRule: 'evenodd' as const };

  let body;
  switch (brand) {
    case 'openai':
    case 'zai':
      body = <Path {...common} d={paths[0]} fill={mono} />;
      break;
    case 'hermes':
      body = (
        <>
          {paths.map((d, i) => (
            <Path key={i} {...common} d={d} fill={mono} />
          ))}
        </>
      );
      break;
    case 'anthropic':
      body = <Path {...common} d={paths[0]} fill="#D97757" />;
      break;
    case 'deepseek':
      body = <Path {...common} d={paths[0]} fill="#4D6BFE" />;
      break;
    case 'qwen':
      // The official mark is a near-solid purple gradient at 84% opacity; one stop reads the same.
      body = <Path {...common} d={paths[0]} fill="#6336E7" fillOpacity={0.84} />;
      break;
    case 'kimi':
      body = (
        <>
          <Path {...common} d={paths[0]} fill="#1783FF" />
          <Path {...common} d={paths[1]} fill={mono} />
        </>
      );
      break;
    case 'google':
      // One star path painted four times: a blue base, then the green/red/yellow gradient washes.
      body = (
        <>
          <Path {...common} d={paths[0]} fill="#3186FF" />
          <Path {...common} d={paths[0]} fill="url(#brand-gemini-0)" />
          <Path {...common} d={paths[0]} fill="url(#brand-gemini-1)" />
          <Path {...common} d={paths[0]} fill="url(#brand-gemini-2)" />
          <Defs>
            <LinearGradient id="brand-gemini-0" x1={7} y1={15.5} x2={11} y2={12}>
              <Stop offset="0" stopColor="#08B962" />
              <Stop offset="1" stopColor="#08B962" stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id="brand-gemini-1" x1={8} y1={5.5} x2={11.5} y2={11}>
              <Stop offset="0" stopColor="#F94543" />
              <Stop offset="1" stopColor="#F94543" stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id="brand-gemini-2" x1={3.5} y1={13.5} x2={17.5} y2={12}>
              <Stop offset="0" stopColor="#FABC12" />
              <Stop offset="0.46" stopColor="#FABC12" stopOpacity={0} />
            </LinearGradient>
          </Defs>
        </>
      );
      break;
    case 'minimax':
      body = (
        <>
          <Path {...common} d={paths[0]} fill="url(#brand-minimax-0)" />
          <Defs>
            <LinearGradient id="brand-minimax-0" x1="0%" y1="50%" x2="100%" y2="50%">
              <Stop offset="0%" stopColor="#E2167E" />
              <Stop offset="100%" stopColor="#FE603C" />
            </LinearGradient>
          </Defs>
        </>
      );
      break;
    case 'xiaomi':
      // Orange badge with the wordmark on top; white letters sit on the orange, not the page.
      body = (
        <>
          <Path {...common} d={paths[0]} fill="#FF6900" />
          <Path {...common} d={paths[1]} fill="#FFFFFF" />
        </>
      );
      break;
    case 'tencent':
      // Brand navy disappears on the dark palette; lighten it there.
      body = <Path {...common} d={paths[0]} fill={scheme === 'dark' ? '#4C8DFF' : '#0052D9'} />;
      break;
  }

  return (
    <Svg width={size} height={size} viewBox={box} accessibilityElementsHidden importantForAccessibility="no">
      {body}
    </Svg>
  );
}
