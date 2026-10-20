import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  info: string;
}

/**
 * 兜底错误边界：生产包里 JS 异常默认只会白屏，这里把错误直接显示出来，
 * 方便真机排查（用户截图即可定位）。
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info: info?.componentStack || '' });
    // 同时打到原生日志，便于 Xcode / Console 里看
    console.error('[yuan-reader] render error:', error?.message, info?.componentStack);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>启动出错了</Text>
          <Text style={styles.hint}>把这一屏截图发给开发者即可定位</Text>

          <Text style={styles.label}>错误信息</Text>
          <Text style={styles.code} selectable>
            {error.name}: {error.message}
          </Text>

          {!!error.stack && (
            <>
              <Text style={styles.label}>堆栈</Text>
              <Text style={styles.code} selectable>
                {error.stack.split('\n').slice(0, 14).join('\n')}
              </Text>
            </>
          )}

          {!!info && (
            <>
              <Text style={styles.label}>组件栈</Text>
              <Text style={styles.code} selectable>
                {info.split('\n').slice(0, 14).join('\n')}
              </Text>
            </>
          )}

          <TouchableOpacity
            style={styles.btn}
            onPress={() => this.setState({ error: null, info: '' })}
          >
            <Text style={styles.btnText}>重试</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#141414' },
  scroll: { padding: 20, paddingTop: 70, paddingBottom: 60 },
  title: { color: '#ff6b6b', fontSize: 20, fontWeight: '700' },
  hint: { color: '#9a9a9a', fontSize: 13, marginTop: 8, marginBottom: 6 },
  label: { color: '#7bd88f', fontSize: 13, fontWeight: '600', marginTop: 18, marginBottom: 6 },
  code: { color: '#e8e8e8', fontSize: 12, fontFamily: 'Courier', lineHeight: 18 },
  btn: {
    marginTop: 28,
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  btnText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
