import 'react-native-gesture-handler';
import React from 'react';
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
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={SAFE_METRICS}>
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
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: APP.bg },
});
