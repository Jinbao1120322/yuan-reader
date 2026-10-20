import 'react-native-gesture-handler';
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: APP.card,
          borderTopColor: APP.border,
          height: 64,
          paddingBottom: 8,
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

function SearchTab() {
  // 搜索作为独立栈，便于全屏返回
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Search" component={SearchScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <NavigationContainer>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tip: { color: APP.sub, fontSize: 14 },
});
