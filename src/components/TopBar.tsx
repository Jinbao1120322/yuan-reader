import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { APP } from '../theme/theme';

interface Props {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
  backgroundColor?: string;
  darkText?: boolean; // 浅色背景（如阅读器日间/羊皮纸/护眼主题）时用深色状态栏文字
  // 标题/返回的文字色。浅色主题下必须显式传深色，否则默认的近白色会糊在浅底上看不清
  textColor?: string;
}

// 顶部栏：标题一律左对齐，避开灵动岛中央禁区；顶部用 SafeArea 留出刘海/岛空间
export function TopBar({
  title,
  onBack,
  right,
  backgroundColor,
  darkText,
  textColor,
}: Props) {
  return (
    <SafeAreaView
      style={[
        styles.safe,
        { backgroundColor: backgroundColor ?? APP.bg },
      ]}
      edges={['top']}
    >
      <StatusBar barStyle={darkText ? 'dark-content' : 'light-content'} />
      <View style={styles.row}>
        {onBack ? (
          <TouchableOpacity style={styles.back} onPress={onBack}>
            <Text style={[styles.backText, textColor ? { color: textColor } : null]}>
              ‹ 返回
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.back} />
        )}
        <Text
          style={[styles.title, textColor ? { color: textColor } : null]}
          numberOfLines={1}
        >
          {title}
        </Text>
        <View style={styles.right}>{right}</View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: APP.bg,
  },
  row: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    // 灵动岛横向禁区：标题不居中，整体左移并在顶部已留 safe area
  },
  back: {
    minWidth: 56,
    justifyContent: 'center',
  },
  backText: {
    color: APP.accent,
    fontSize: 16,
  },
  title: {
    flex: 1,
    color: APP.text,
    fontSize: 18,
    fontWeight: '700',
    // 左对齐，避免进入中央禁区
    textAlign: 'left',
  },
  right: {
    minWidth: 56,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
