import { AppRegistry, Platform } from 'react-native';
import { ClankerPhone, type PhoneElement, type PhoneScreen } from '../../../modules/clanker-phone';
import { MAX_EDGE, storeJpeg } from '../attachments';
import type { Tool, ToolOutcome } from './index';

// Chats whose current reply has used the phone, so the overlay knows when to show "Done".
const using = new Set<string>();

// React Native pauses JS timers while its activity is in the background, which would stall every
// wait, timeout and save while the agent works in another app. A headless task keeps them running;
// native starts it when the phone is first used and it lasts until the last reply using it ends.
const KEEP_ALIVE_TASK = 'ClankerPhoneKeepAlive';
let releases: (() => void)[] = [];

AppRegistry.registerHeadlessTask(KEEP_ALIVE_TASK, () => () =>
  new Promise<void>((resolve) => {
    if (using.size) releases.push(resolve);
    else resolve();
  })
);

/** Whether this build can control the phone at all (Android, with the native module). */
export const phoneSupported = () => Platform.OS === 'android' && !!ClankerPhone;

/** True while the user has Clanker's accessibility service on (Android only). */
export const phoneAvailable = () => Platform.OS === 'android' && !!ClankerPhone && ClankerPhone.isEnabled();

/** Calls `stop` with each chat using the phone when the user taps Stop on the overlay. */
export function onPhoneStop(stop: (conversationId: string) => void) {
  ClankerPhone?.addListener('onStop', () => {
    for (const id of [...using]) stop(id);
  });
}

/** Called when a reply ends: the overlay turns into the Done chip, or goes when the reply was stopped. */
export function endPhoneRun(conversationId: string, stopped: boolean) {
  if (!using.delete(conversationId) || using.size) return;
  void ClankerPhone?.setOverlay(stopped ? 'hidden' : 'done').catch(() => {});
  void ClankerPhone?.keepAwake(false).catch(() => {});
  releases.forEach((release) => release());
  releases = [];
}

function phone(conversationId: string) {
  if (!ClankerPhone || !ClankerPhone.isEnabled()) {
    throw new Error("Phone control is off. The user can turn it on under Clanker phone control in Android's accessibility settings.");
  }
  if (!using.has(conversationId)) {
    using.add(conversationId);
    void ClankerPhone.keepAwake(true).catch(() => {});
    void ClankerPhone.setOverlay('working').catch(() => {});
  }
  return ClankerPhone;
}

/** Native rejections, without the bridge's "Call to function … has been rejected" preamble. */
async function native<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(message.replace(/^[\s\S]*Caused by:\s*/, ''));
  }
}

const quote = (s: string) => JSON.stringify(s);

function describeElement(e: PhoneElement) {
  return [
    `[${e.index}] ${e.cls}`,
    e.text && quote(e.text),
    e.desc && `desc ${quote(e.desc)}`,
    e.hint && `hint ${quote(e.hint)}`,
    e.id && `#${e.id}`,
    `@(${e.x},${e.y})`,
    ...e.flags,
  ]
    .filter(Boolean)
    .join(' ');
}

function listing(s: PhoneScreen) {
  const header = `App: ${s.appLabel}${s.appLabel !== s.package ? ` (${s.package})` : ''} · screen ${s.width}×${s.height} px`;
  if (!s.elements.length) {
    return `${header}\n(No readable elements: the app may draw its own UI, or the screen is still loading. Take a screenshot.)`;
  }
  const more = s.truncated ? '\n[More elements than fit in the listing; scroll or take a screenshot to see the rest.]' : '';
  return `${header}\n${s.elements.map(describeElement).join('\n')}${more}`;
}

/** An action's status line followed by the screen as it is now. */
async function after(status: string, conversationId: string): Promise<ToolOutcome> {
  try {
    return { output: `${status}\n\n${listing(await native(phone(conversationId).screen()))}` };
  } catch (e) {
    return { output: `${status}\n\n[Could not read the screen afterwards: ${e instanceof Error ? e.message : e}]` };
  }
}

const int = (value: unknown) => {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? Math.round(n) : undefined;
};

const ELEMENT_PARAM = { type: 'integer', description: 'Element number from the latest screen listing.' };

const phoneScreen: Tool = {
  name: 'phone_screen',
  description:
    'Read what is on the phone screen: the app in front and its visible elements, numbered for phone_tap, phone_type and phone_scroll ' +
    '(e.g. `[12] Button "Send" @(980,2210) click`; @ is the centre in screen pixels, then flags such as click, edit, scroll, checked, focused). ' +
    'Numbers change whenever the screen does, so act on the latest listing. Every phone action already returns a fresh listing; ' +
    'call this to look again, to wait for something to load, or with screenshot to see the screen as an image.',
  parameters: {
    type: 'object',
    properties: {
      screenshot: { type: 'boolean', description: 'Also return a screenshot. Use it when the listing is sparse or the layout matters.' },
      wait_seconds: { type: 'number', description: 'Wait this long first (max 30), e.g. for a page to load.' },
    },
  },
  async run(input, { conversationId, signal }) {
    const p = phone(conversationId);
    const wait = Math.min(30, Math.max(0, Number(input.wait_seconds) || 0));
    if (wait) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, wait * 1000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    const screen = await native(p.screen());
    if (!input.screenshot) return { output: listing(screen) };
    // Scaled natively, which saves decoding the full-size image in JS.
    const shot = await native(p.screenshot(MAX_EDGE));
    const image = await storeJpeg(shot);
    const { width, height } = shot;
    const scale = screen.width / width;
    const note =
      Math.abs(scale - 1) < 0.01
        ? `Screenshot ${width}×${height}, at screen scale.`
        : `Screenshot scaled to ${width}×${height}; multiply its coordinates by ${scale.toFixed(3)} for screen pixels.`;
    return { output: `${listing(screen)}\n\n${note}`, images: [image] };
  },
};

const phoneTap: Tool = {
  name: 'phone_tap',
  description:
    'Tap an element by its number from the latest listing (preferred), or a point given in screen pixels. Set long_press for a long press.',
  parameters: {
    type: 'object',
    properties: {
      element: ELEMENT_PARAM,
      x: { type: 'number', description: 'Screen x in pixels, when tapping a point instead of an element.' },
      y: { type: 'number', description: 'Screen y in pixels.' },
      long_press: { type: 'boolean', description: 'Press and hold. Default false.' },
    },
  },
  async run(input, { conversationId }) {
    const p = phone(conversationId);
    const element = int(input.element);
    const long = !!input.long_press;
    if (element != null) return after(await native(p.tap(element, long)), conversationId);
    const x = int(input.x);
    const y = int(input.y);
    if (x == null || y == null) throw new Error('Pass element, or both x and y.');
    return after(await native(p.tapAt(x, y, long ? 700 : 60)), conversationId);
  },
};

const phoneType: Tool = {
  name: 'phone_type',
  description:
    "Replace the text in a text field with `text`. Pass the field's element number, or leave it out to type into the focused field. " +
    "Set submit to press the keyboard's enter / search / send key afterwards.",
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      element: ELEMENT_PARAM,
      submit: { type: 'boolean', description: 'Press enter afterwards. Default false.' },
    },
    required: ['text'],
  },
  async run(input, { conversationId }) {
    const p = phone(conversationId);
    const text = typeof input.text === 'string' ? input.text : String(input.text ?? '');
    return after(await native(p.type(int(input.element) ?? -1, text, !!input.submit)), conversationId);
  },
};

const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

const phoneScroll: Tool = {
  name: 'phone_scroll',
  description:
    'Scroll to reveal more content: "down" shows what is further down the page, "right" what is further right. ' +
    'Pass a scrollable element (or anything inside one) to scroll that list; by default the largest scrollable area scrolls.',
  parameters: {
    type: 'object',
    properties: {
      direction: { type: 'string', enum: [...DIRECTIONS] },
      element: ELEMENT_PARAM,
    },
    required: ['direction'],
  },
  async run(input, { conversationId }) {
    const p = phone(conversationId);
    const direction = DIRECTIONS.find((d) => d === input.direction);
    if (!direction) throw new Error(`direction must be one of ${DIRECTIONS.join(', ')}.`);
    return after(await native(p.scroll(int(input.element) ?? -1, direction)), conversationId);
  },
};

const phoneSwipe: Tool = {
  name: 'phone_swipe',
  description:
    'Drag a finger from one point to another, in screen pixels: for carousels, sliders, pull-to-refresh, dismissing and other gestures phone_scroll does not cover.',
  parameters: {
    type: 'object',
    properties: {
      x1: { type: 'number' },
      y1: { type: 'number' },
      x2: { type: 'number' },
      y2: { type: 'number' },
      duration_ms: { type: 'integer', description: 'How long the drag takes. Default 300.' },
    },
    required: ['x1', 'y1', 'x2', 'y2'],
  },
  async run(input, { conversationId }) {
    const p = phone(conversationId);
    const [x1, y1, x2, y2] = [input.x1, input.y1, input.x2, input.y2].map(int);
    if (x1 == null || y1 == null || x2 == null || y2 == null) throw new Error('Pass x1, y1, x2 and y2.');
    const duration = Math.min(10_000, Math.max(50, int(input.duration_ms) ?? 300));
    return after(await native(p.swipe(x1, y1, x2, y2, duration)), conversationId);
  },
};

const KEYS = ['back', 'home', 'recents', 'notifications', 'quick_settings'] as const;

const phonePress: Tool = {
  name: 'phone_press',
  description:
    'Press a system button: back, home, recents (the app switcher), or pull down notifications or quick settings.',
  parameters: {
    type: 'object',
    properties: { key: { type: 'string', enum: [...KEYS] } },
    required: ['key'],
  },
  async run(input, { conversationId }) {
    const p = phone(conversationId);
    const key = KEYS.find((k) => k === input.key);
    if (!key) throw new Error(`key must be one of ${KEYS.join(', ')}.`);
    return after(await native(p.globalAction(key)), conversationId);
  },
};

const phoneOpenApp: Tool = {
  name: 'phone_open_app',
  description: 'Open an installed app by its name (e.g. "Spotify") or package name. Returns the screen once it has opened.',
  parameters: {
    type: 'object',
    properties: { app: { type: 'string', description: 'App name or package name.' } },
    required: ['app'],
  },
  async run(input, { conversationId }) {
    const p = phone(conversationId);
    const query = String(input.app ?? '').trim().toLowerCase();
    if (!query) throw new Error('Missing required argument "app".');
    const apps = await native(p.listApps());
    const exact = apps.filter((a) => a.package.toLowerCase() === query || a.label.toLowerCase() === query);
    const prefix = apps.filter((a) => a.label.toLowerCase().startsWith(query));
    const partial = apps.filter((a) => a.label.toLowerCase().includes(query) || a.package.toLowerCase().includes(query));
    const matches = exact.length ? exact : prefix.length ? prefix : partial;
    if (matches.length !== 1) {
      const list = (matches.length ? matches : apps).map((a) => `${a.label} (${a.package})`).join('\n');
      return {
        output: matches.length
          ? `Several apps match “${input.app}”; pass one of these exactly:\n${list}`
          : `No app matches “${input.app}”. Installed apps:\n${list}`,
        isError: true,
      };
    }
    const app = matches[0];
    await native(p.launchApp(app.package));
    return after(`Opened ${app.label} (${app.package}).`, conversationId);
  },
};

const phoneListApps: Tool = {
  name: 'phone_list_apps',
  description: 'List the apps installed on the phone that can be opened, with their package names.',
  parameters: { type: 'object', properties: {} },
  async run(_input, { conversationId }) {
    const apps = await native(phone(conversationId).listApps());
    return { output: apps.map((a) => `${a.label} (${a.package})`).join('\n') || 'No launchable apps found.' };
  },
};

export const PHONE_TOOLS: Tool[] = [
  phoneScreen,
  phoneTap,
  phoneType,
  phoneScroll,
  phoneSwipe,
  phonePress,
  phoneOpenApp,
  phoneListApps,
];
