import { Drawer } from 'expo-router/drawer';
import { useWindowDimensions } from 'react-native';
import { Sidebar } from '@/components/Sidebar';
import { useTheme } from '@/lib/theme';
import { useUI } from '@/store/ui';

export default function DrawerLayout() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  // The effort slider swipes across the same edge, so pause the drawer gesture while it is open.
  const effortOpen = useUI((s) => s.effortOpen);

  return (
    <Drawer
      drawerContent={(props) => <Sidebar {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'slide',
        swipeEnabled: !effortOpen,
        drawerStyle: { width: Math.min(width * 0.85, 360), backgroundColor: colors.sidebar },
        overlayColor: colors.overlay,
        swipeEdgeWidth: width / 2,
      }}
    >
      <Drawer.Screen name="index" />
    </Drawer>
  );
}
