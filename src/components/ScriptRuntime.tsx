import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { attachRuntime, handleRuntimeMessage, resetRuntime } from '@/lib/runtime';
import { RUNTIME_HTML } from '@/lib/runtime/page';

/**
 * Invisible WebView that hosts the agent's Python and JavaScript runtimes. Mounted once at the
 * root so scripts keep running (and Pyodide stays loaded) while the user moves between screens.
 */
export function ScriptRuntime() {
  // The type argument matters: the default `undefined` intersects the props down to `never`.
  const ref = useRef<WebView<object>>(null);

  useEffect(() => {
    attachRuntime((js) => ref.current?.injectJavaScript(js));
    return () => attachRuntime(null);
  }, []);

  return (
    // A 1px box rather than 0: some Android WebViews stop running timers in zero-size views.
    <View pointerEvents="none" style={styles.host}>
      <WebView<object>
        ref={ref}
        source={{ html: RUNTIME_HTML, baseUrl: 'https://runtime.clanker.local/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={(e) => handleRuntimeMessage(e.nativeEvent.data)}
        onLoadStart={() => resetRuntime('The script runtime reloaded.')}
        onRenderProcessGone={() => {
          resetRuntime('The script runtime ran out of memory and was restarted.');
          ref.current?.reload();
        }}
        onContentProcessDidTerminate={() => {
          resetRuntime('The script runtime ran out of memory and was restarted.');
          ref.current?.reload();
        }}
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', width: 1, height: 1, opacity: 0, left: 0, top: 0, overflow: 'hidden' },
  webview: { width: 1, height: 1, backgroundColor: 'transparent' },
});
