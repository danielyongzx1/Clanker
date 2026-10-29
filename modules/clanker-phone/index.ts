import { requireOptionalNativeModule, type EventSubscription } from 'expo';

export type PhoneElement = {
  index: number;
  /** Short class name, e.g. "Button" or "EditText". */
  cls: string;
  text: string;
  desc: string;
  hint: string;
  /** View id without the package, e.g. "send_button". */
  id: string;
  /** Centre on screen, in pixels. */
  x: number;
  y: number;
  /** click, longclick, edit, scroll, checked/unchecked, selected, focused, disabled, password. */
  flags: string[];
};

export type PhoneScreen = {
  package: string;
  appLabel: string;
  width: number;
  height: number;
  /** True when there were more elements than the listing holds. */
  truncated: boolean;
  elements: PhoneElement[];
};

export type PhoneApp = { label: string; package: string };

export type OverlayState = 'working' | 'done' | 'hidden';

type ClankerPhoneModule = {
  isEnabled(): boolean;
  screen(): Promise<PhoneScreen>;
  /** Scaled so its long edge is at most `maxEdge` pixels. */
  screenshot(maxEdge: number): Promise<{ uri: string; width: number; height: number }>;
  /** Element numbers refer to the last `screen` listing. */
  tap(index: number, long: boolean): Promise<string>;
  tapAt(x: number, y: number, durationMs: number): Promise<string>;
  swipe(x1: number, y1: number, x2: number, y2: number, durationMs: number): Promise<string>;
  /** index -1 types into the focused field. */
  type(index: number, text: string, submit: boolean): Promise<string>;
  /** index -1 scrolls the largest scrollable element. */
  scroll(index: number, direction: 'up' | 'down' | 'left' | 'right'): Promise<string>;
  globalAction(name: 'back' | 'home' | 'recents' | 'notifications' | 'quick_settings'): Promise<string>;
  listApps(): Promise<PhoneApp[]>;
  launchApp(pkg: string): Promise<string>;
  setOverlay(state: OverlayState): Promise<void>;
  /** Holds JS timers on while Clanker is in the background (see the `ClankerPhoneKeepAlive` task). */
  keepAwake(on: boolean): Promise<void>;
  addListener(event: 'onStop', listener: () => void): EventSubscription;
};

/** Null on iOS (apps there can't operate other apps) and in builds made before this module was added. */
export const ClankerPhone = requireOptionalNativeModule<ClankerPhoneModule>('ClankerPhone');
