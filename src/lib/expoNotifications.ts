import { isRunningInExpoGo } from 'expo';

/**
 * expo-notifications, or null in Expo Go: it loads native modules on import that Expo Go doesn't
 * include, so it's only required in a development or release build.
 */
export const Notifications: typeof import('expo-notifications') | null = isRunningInExpoGo()
  ? null
  : // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('expo-notifications');
