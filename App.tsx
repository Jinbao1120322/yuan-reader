import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';

import { ErrorBoundary } from './src/components/ErrorBoundary';
import { BookshelfScreen } from './src/screens/BookshelfScreen';
import { SourcesScreen } from './src/screens/SourcesScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { BookDetailScreen } from './src/screens/BookDetailScreen';
import { ReaderScreen } from './src/screens/ReaderScreen';
import { APP } from './src/theme/theme';
import { FontProvider } from './src/components/AppText';
import { useStore } from './src/store/useStore';
import { currentFontFamily, registerFont, withFileName } from './src/utils/customFonts';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

/**
 * 关键保险：SafeAreaProvider 在 insets === null 时会把 children 整个渲染成 null
 * （见 react-native-safe-area-context/lib/module/SafeAreaContext.js:58），
 * 而 insets 初始值依赖原生 onInsetsChange 事件。一旦事件没来 → 永久白屏且无任何报错。
 * 这里提供刚性的首帧 metrics，保证第一帧就能渲染出 children。
 * 数值按目标设备 iPhone Air（420×912pt，灵动岛 59pt，home indicator 34pt）。
 */
const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 420, height: 912 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};
const SAFE_METRICS = initialWindowMetrics ?? FALLBACK_METRICS;

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: APP.accent,
    background: APP.bg,
    card: APP.card,
    text: APP.text,
    border: APP.border,
    notification: APP.accent,
  },
};

function TabNavigator() {
  // 标签栏高度必须把底部 home indicator 的 inset 算进去，
  // 否则写死 64 会把图标/文字压到手势区上。
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: APP.bg },
        tabBarStyle: {
          backgroundColor: APP.card,
          borderTopColor: APP.border,
          height: 52 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom,
        },
        tabBarActiveTintColor: APP.accent,
        tabBarInactiveTintColor: APP.sub,
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tab.Screen name="书架" component={BookshelfScreen} />
      <Tab.Screen name="书源" component={SourcesScreen} />
      <Tab.Screen name="我的" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  // 自定义字体要在本次进程里重新注册一次（CTFontManager 的注册不跨启动），
  // 注册完再切字体，否则第一帧会用系统字体、随后跳一下。
  const fonts = useStore((s) => s.fonts);
  const fontId = useStore((s) => s.settings.fontId);
  const [family, setFamily] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const want = currentFontFamily(fonts, fontId);
    if (!want) {
      setFamily(null);
      return;
    }
    const f = fonts.find((x) => x.id === fontId);
    if (!f) return;
    registerFont(withFileName(f))
      .then(() => {
        if (alive) setFamily(want);
      })
      .catch(() => {
        // 文件确实找不到了（用户清过数据之类）：退回系统字体，
        // 并把选中项清掉 —— 否则设置页会一直显示"使用中"，但实际用的是系统字体。
        if (alive) {
          setFamily(null);
          try {
            useStore.getState().updateSettings({ fontId: null });
          } catch {
            /* ignore */
          }
        }
      });
    return () => {
      alive = false;
    };
  }, [fonts, fontId]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={SAFE_METRICS}>
        <FontProvider font={family}>
        <ErrorBoundary>
          <NavigationContainer theme={navTheme}>
            <StatusBar style="light" />
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Main" component={TabNavigator} />
              <Stack.Screen name="Search" component={SearchScreen} />
              <Stack.Screen name="BookDetail" component={BookDetailScreen} />
              <Stack.Screen name="Reader" component={ReaderScreen} />
            </Stack.Navigator>
          </NavigationContainer>
        </ErrorBoundary>
        </FontProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: APP.bg },
});
