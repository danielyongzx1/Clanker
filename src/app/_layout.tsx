import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DialogHost } from '@/components/Dialogs';
import { ScriptRuntime } from '@/components/ScriptRuntime';
import { useTheme } from '@/lib/theme';
import { useSettings } from '@/store/settings';

const RUNTIME_DELAY = 600;

export default function RootLayout() {
  const themePreference = useSettings((s) => s.theme);
  const toolsOn = useSettings((s) => s.tools);
  const { scheme, colors } = useTheme();

  // Creating or tearing down the runtime's WebView stalls the UI thread, so when the setting
  // changes it waits until the switch in Settings has finished animating.
  const [runtimeOn, setRuntimeOn] = useState(toolsOn);
  useEffect(() => {
    const timer = setTimeout(() => setRuntimeOn(toolsOn), RUNTIME_DELAY);
    return () => clearTimeout(timer);
  }, [toolsOn]);

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
            {/* Screens under the top one stay mounted; frozen, they skip re-rendering meanwhile (a
                project's chat streaming over the main chat screen, which shows the same stores). */}
            <Stack screenOptions={{ headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal', freezeOnBlur: true }}>
              <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
              <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
              <Stack.Screen name="settings/endpoint" options={{ presentation: 'modal', title: 'Endpoint' }} />
              <Stack.Screen name="settings/workspace" options={{ title: 'Workspace files' }} />
              <Stack.Screen name="settings/tools" options={{ title: 'Files & code' }} />
              <Stack.Screen name="settings/context" options={{ title: 'Auto-compression' }} />
              <Stack.Screen name="settings/search" options={{ title: 'Web access' }} />
              <Stack.Screen name="settings/memory" options={{ title: 'Memory' }} />
              <Stack.Screen name="settings/files" options={{ title: 'Files' }} />
              <Stack.Screen name="projects/index" options={{ title: 'Projects' }} />
              <Stack.Screen name="projects/[id]" options={{ title: '' }} />
              <Stack.Screen name="projects/chat" options={{ headerShown: false }} />
              <Stack.Screen name="projects/edit" options={{ title: 'Edit project' }} />
              <Stack.Screen name="projects/instructions" options={{ title: 'Instructions' }} />
            </Stack>
            <DialogHost />
            {runtimeOn && <ScriptRuntime />}
          </ThemeProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
