import Feather from '@expo/vector-icons/Feather';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Given each code's text; returns whether it was the code wanted, which closes the scanner. */
  onScan: (data: string) => boolean;
  hint: string;
};

/** A full-screen camera that reads QR codes, until one is accepted. */
export function QrScanner({ visible, onClose, onScan, hint }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [rejected, setRejected] = useState(false);
  // Each opening starts without the last one's complaint.
  const [open, setOpen] = useState(visible);
  if (visible !== open) {
    setOpen(visible);
    if (visible) setRejected(false);
  }
  // The camera reports the same code many times a second; one answer per code is enough.
  const last = useRef('');
  // Asks once per opening, rather than again after each answer changes the permission.
  const asked = useRef(false);

  useEffect(() => {
    last.current = '';
    asked.current = false;
  }, [visible]);
  useEffect(() => {
    if (!visible || !permission || permission.granted || !permission.canAskAgain || asked.current) return;
    asked.current = true;
    void requestPermission();
  }, [visible, permission, requestPermission]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.fill, { backgroundColor: '#000' }]}>
        {/* Only one camera preview can run at a time, so it exists only while the scanner shows. */}
        {visible && permission?.granted && (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (data === last.current) return;
              last.current = data;
              if (onScan(data)) onClose();
              else setRejected(true);
            }}
          />
        )}

        <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close scanner" style={styles.close}>
            <Feather name="x" size={22} color="#fff" />
          </Pressable>
        </View>

        {permission?.granted ? (
          <View style={styles.frame} pointerEvents="none" />
        ) : (
          permission && (
            <View style={styles.permission}>
              <Text style={styles.text}>Clanker needs the camera to scan the pairing code.</Text>
              <Pressable
                onPress={() => (permission.canAskAgain ? void requestPermission() : void Linking.openSettings())}
                style={({ pressed }) => [styles.button, { backgroundColor: colors.sendBg }, pressed && { opacity: 0.7 }]}
              >
                <Text style={{ color: colors.sendFg, fontSize: 16, fontWeight: '600' }}>
                  {permission.canAskAgain ? 'Allow camera' : 'Open settings'}
                </Text>
              </Pressable>
            </View>
          )
        )}

        <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]} accessibilityLiveRegion="polite">
          <Text style={styles.text}>{rejected ? 'That isn’t a Clanker pairing code. Scan the one on the host’s pairing page.' : hint}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, alignItems: 'flex-start' },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0008' },
  frame: {
    position: 'absolute',
    alignSelf: 'center',
    top: '30%',
    width: 240,
    height: 240,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#fffc',
  },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, paddingHorizontal: 32 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 32 },
  text: { color: '#fff', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  button: { borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 },
});
