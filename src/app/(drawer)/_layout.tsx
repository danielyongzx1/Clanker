import { Drawer } from 'expo-router/drawer';
import { useWindowDimensions } from 'react-native';
import { Sidebar } from '@/components/Sidebar';
import { useTheme } from '@/lib/theme';

export default function DrawerLayout() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();

  return (
    <Drawer
      drawerContent={(props) => <Sidebar {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'slide',
        drawerStyle: { width: Math.min(width * 0.85, 360), backgroundColor: colors.sidebar },
        overlayColor: colors.overlay,
        swipeEdgeWidth: width / 2,
      }}
    >
      <Drawer.Screen name="index" />
    </Drawer>
  );
}
