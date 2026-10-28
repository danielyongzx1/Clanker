import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo } from 'react';
import { Appearance } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ScriptRuntime } from '@/components/ScriptRuntime';
import { useTheme } from '@/lib/theme';
import { useSettings } from '@/store/settings';

export default function RootLayout() {
  const themePreference = useSettings((s) => s.theme);
  const toolsOn = useSettings((s) => s.tools);
  const { scheme, colors } = useTheme();

  useEffect(() => {
    Appearance.setColorScheme(themePreference === 'system' ? 'unspecified' : themePreference);
  }, [themePreference]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  const navTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: colors.background,
        card: colors.background,
        text: colors.text,
        border: colors.border,
        primary: colors.text,
      },
    };
  }, [scheme, colors]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Moves content for the keyboard itself rather than leaning on the window resize, which
          stops happening on Android once Appearance.setColorScheme changes the night mode. Its
          edge-to-edge detection misses this build, so the bars are flagged translucent here;
          otherwise it pushes the content down by the status bar height on first launch. */}
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent preserveEdgeToEdge>
        <SafeAreaProvider>
          <ThemeProvider value={navTheme}>
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <Stack screenOptions={{ headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
              <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
              <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
              <Stack.Screen name="settings/endpoint" options={{ presentation: 'modal', title: 'Endpoint' }} />
              <Stack.Screen name="settings/workspace" options={{ title: 'Workspace' }} />
            </Stack>
            {toolsOn && <ScriptRuntime />}
          </ThemeProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
