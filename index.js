/**
 * 启动引导（Bootstrap）
 *
 * 为什么不用顶层 `import App from './App'`：
 * ESM 静态 import 会被提升求值——App 的整条依赖图（navigation / reanimated /
 * gesture-handler / safe-area / cheerio / iconv-lite / xmldom / xpath ...）都会在
 * registerRootComponent 之前执行。其中任何一个模块在**加载期**抛错，
 * registerRootComponent 就永远不会被调用，于是：
 *   App 内部什么都不渲染 → 纯白屏、无任何报错、也不闪退（原生层完全正常）。
 * 这正好对应实测现象：屏幕全白 + 没有绿点。
 *
 * 因此这里改成运行期 require + try/catch，并套一层渲染期错误边界：
 *   加载期抛错 → 显示错误类型 / 消息 / 堆栈
 *   渲染期抛错 → 同上
 *   都正常     → 正常渲染 App
 *
 * 另外最外层直接渲染一个橙色小圆点（在 App 之外）：
 *   看得到圆点 = JS 引擎已运行、React 已挂出原生视图
 *   看不到圆点 = JS 根本没跑起来（原生/引擎层问题，与 React 代码无关）
 */
import React from 'react';
import { registerRootComponent } from 'expo';
import { View, Text, ScrollView, StyleSheet } from 'react-native';

const BOOT_TAG = 'v1.0.3';

function describeError(e) {
  if (!e) return '未知错误（throw 了空值）';
  const name = e.name || (e.constructor && e.constructor.name) || 'Error';
  const msg = e.message || String(e);
  const stack = e.stack || '';
  return name + ': ' + msg + (stack ? '\n\n' + stack : '');
}

// 每个 App 构建都会修改这个值，用来确认用户装的是哪一版
const BUILD_STAMP = '1.0.3.4';

// ---------------------------------------------------------------------------
// 1. 加载期保护：require('./App') 失败也不至于白屏
// ---------------------------------------------------------------------------
let bootResult = null;

function boot() {
  if (bootResult) return bootResult;
  try {
    // gesture-handler 需要先于任何手势组件完成初始化，但同样纳入保护范围
    require('react-native-gesture-handler');
    const mod = require('./App');
    const App = mod && (mod.default || mod);
    if (!App) {
      throw new Error('App.tsx 没有导出组件（module keys: ' + Object.keys(mod || {}).join(',') + '）');
    }
    bootResult = { App, error: null };
  } catch (e) {
    bootResult = { App: null, error: e };
  }
  return bootResult;
}

// ---------------------------------------------------------------------------
// 2. 渲染期保护：App 里任何组件抛错都能显示出来
// ---------------------------------------------------------------------------
class RenderGuard extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    // 只记录到控制台；界面上由 Fallback 展示
    console.warn('[yuan-reader] render error:', error);
  }

  render() {
    if (this.state.error) {
      return <Fallback title="界面渲染失败" error={this.state.error} />;
    }
    return this.props.children;
  }
}

/**
 * 最外层：深色底 + 橙色探针点。
 * 即使 App 渲染成 null，屏幕也会是深色（而不是白屏），配合探针点可自证 JS 已运行。
 */
function Fallback({ title, error }) {
  return (
    <View style={s.wrap}>
      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.hint}>请把这一屏截图发给开发者（{BOOT_TAG}）</Text>
        <Text style={s.err} selectable>
          {describeError(error).slice(0, 4000)}
        </Text>
      </ScrollView>
    </View>
  );
}

function Boot() {
  const { App, error } = boot();

  return (
    <View style={s.root}>
      {error || !App ? (
        <Fallback title="App 模块加载失败" error={error} />
      ) : (
        <RenderGuard>
          <App />
        </RenderGuard>
      )}

      {/* 启动探针：在 App 之外渲染，与 App 是否正常无关 */}
      <View pointerEvents="none" style={s.probe} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f0f12' },
  wrap: { flex: 1, backgroundColor: '#1a0b0b' },
  body: { padding: 16, paddingTop: 64, paddingBottom: 64 },
  title: { color: '#ff6b6b', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  hint: { color: '#e0a0a0', fontSize: 12, marginBottom: 16 },
  err: { color: '#ffd4d4', fontSize: 11, lineHeight: 16 },
  probe: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 16,
    height: 16,
    borderRadius: 8,
    // 颜色随版本变化，方便从截图确认用户装的是哪一版：v1.0.3 = 橙色
    backgroundColor: '#ff9500',
  },
});

// 让构建产物的标识可被核对（不参与渲染）
Boot.buildStamp = BUILD_STAMP;

registerRootComponent(Boot);
