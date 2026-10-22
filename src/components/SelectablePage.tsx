import React, { useMemo, useRef, useState } from 'react';
import { View, StyleSheet, PanResponder } from 'react-native';
import { Text } from './AppText';

/*
 * ===========================================================================
 * 自绘文字选择（SelectablePage）
 * ===========================================================================
 * 为什么不用系统的 TextInput / Text：
 *   - `<Text selectable>` 拿不到「选中了哪几个字」，只能弹系统菜单
 *   - `TextInput` 在这套 RN + iOS 上要么选中手柄出不来（editable=false），
 *     要么弹键盘挡住半屏
 *
 * 爱阅书香、微信读书、Kindle 的做法都是**自己实现**：
 *   长按定位字符 → 拖动改范围 → 自己画高亮 → 弹自己的菜单
 *
 * 这里就是这套做法的最小实现。前提是正文**已经按行切好**（每行一个 \n），
 * 所以每行的 y = 行号 × 行高，字符位置可以按字宽近似算出来。
 * ===========================================================================
 */

interface Props {
  /** 一页的文本，行之间用 \n 分隔（就是 pages[i]） */
  text: string;
  width: number;
  height: number;
  fontSize: number;
  /** 行高倍数（settings.lineHeight） */
  lineHeight: number;
  color: string;
  bg: string;
  padTop: number;
  padBottom: number;
  padH: number;
  /** 用户选完并点了动作按钮 */
  onAction: (selected: string, action: 'filter' | 'copy') => void;
}

interface Pos {
  line: number;
  ch: number;
}

/** 中日韩字符按全角算，其余按半角 */
function isWide(code: number): boolean {
  return (
    (code >= 0x2e80 && code <= 0x9fff) || // 部首 ~ 汉字
    (code >= 0x3000 && code <= 0x303f) || // 中文标点
    (code >= 0xff00 && code <= 0xffef) || // 全角字符
    (code >= 0xa960 && code <= 0xa97f)
  );
}

/** 一行里，第 n 个字符左边距（相对行首） */
function xAt(line: string, index: number, fs: number): number {
  let w = 0;
  const n = Math.min(index, line.length);
  for (let i = 0; i < n; i++) {
    w += isWide(line.charCodeAt(i)) ? fs : fs * 0.5;
  }
  return w;
}

/** 反查：横坐标 x 落在第几个字符（按字符中点判断） */
function charAt(line: string, x: number, fs: number): number {
  if (x <= 0) return 0;
  let w = 0;
  for (let i = 0; i < line.length; i++) {
    const cw = isWide(line.charCodeAt(i)) ? fs : fs * 0.5;
    if (w + cw / 2 > x) return i;
    w += cw;
  }
  return line.length;
}

export function SelectablePage(props: Props) {
  const {
    text,
    width,
    height,
    fontSize,
    lineHeight,
    color,
    bg,
    padTop,
    padBottom,
    padH,
    onAction,
  } = props;

  const lineH = fontSize * lineHeight;
  const lines = useMemo(() => String(text || '').split('\n'), [text]);

  const [sel, setSel] = useState<{ anchor: Pos; focus: Pos } | null>(null);
  const [dragging, setDragging] = useState(false);

  // PanResponder 的闭包里拿不到最新 state，用 ref 兜着
  const selRef = useRef(sel);
  selRef.current = sel;
  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;

  /** 屏幕坐标 → 字符位置 */
  const hitTest = (x: number, y: number): Pos => {
    const rel = y - padTop;
    let line = Math.floor(rel / lineH);
    if (line < 0) line = 0;
    if (line > lines.length - 1) line = Math.max(0, lines.length - 1);
    const ch = charAt(lines[line] || '', x - padH, fontSize);
    return { line, ch };
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (e) => {
          const p = hitTest(e.nativeEvent.locationX, e.nativeEvent.locationY);
          setSel({ anchor: p, focus: p });
          setDragging(true);
        },

        onPanResponderMove: (e) => {
          const p = hitTest(e.nativeEvent.locationX, e.nativeEvent.locationY);
          const cur = selRef.current;
          if (!cur) return;
          setSel({ anchor: cur.anchor, focus: p });
        },

        onPanResponderRelease: () => {
          setDragging(false);
        },

        onPanResponderTerminate: () => {
          setDragging(false);
        },
      }),
    [lines, lineH, padTop, padH, fontSize]
  );

  /** 选中范围规范化：起点在前，终点在后 */
  const range = useMemo(() => {
    if (!sel) return null;
    let a = sel.anchor;
    let b = sel.focus;
    if (a.line > b.line || (a.line === b.line && a.ch > b.ch)) {
      [a, b] = [b, a];
    }
    return { a, b };
  }, [sel]);

  /** 拼出选中的文字 */
  const selectedText = useMemo(() => {
    if (!range) return '';
    const { a, b } = range;
    if (a.line === b.line) {
      return (lines[a.line] || '').slice(a.ch, b.ch);
    }
    const parts: string[] = [];
    parts.push((lines[a.line] || '').slice(a.ch));
    for (let i = a.line + 1; i < b.line; i++) parts.push(lines[i] || '');
    parts.push((lines[b.line] || '').slice(0, b.ch));
    return parts.join('\n');
  }, [range, lines]);

  /** 每行的高亮矩形 */
  const highlights = useMemo(() => {
    if (!range) return [];
    const { a, b } = range;
    const out: { top: number; left: number; w: number; key: string }[] = [];
    for (let i = a.line; i <= b.line; i++) {
      const line = lines[i] || '';
      const s = i === a.line ? a.ch : 0;
      const e = i === b.line ? b.ch : line.length;
      if (e <= s) continue;
      const x1 = xAt(line, s, fontSize);
      const x2 = xAt(line, e, fontSize);
      out.push({
        top: padTop + i * lineH,
        left: padH + x1,
        w: Math.max(1, x2 - x1),
        key: `hl-${i}`,
      });
    }
    return out;
  }, [range, lines, fontSize, lineH, padTop, padH]);

  const hasSelection = selectedText.trim().length > 0;

  return (
    <View style={{ width, height, backgroundColor: bg }}>
      {/* 正文：逐行渲染，这样才能精确拿到每行的 y */}
      <View style={{ flex: 1 }} {...responder.panHandlers}>
        <View style={{ paddingTop: padTop, paddingBottom: padBottom, paddingHorizontal: padH }}>
          {lines.map((line, i) => (
            <Text
              key={`ln-${i}`}
              numberOfLines={1}
              ellipsizeMode="clip"
              style={{
                fontSize,
                lineHeight: lineH,
                height: lineH,
                color,
              }}
            >
              {line || ' '}
            </Text>
          ))}
        </View>
      </View>

      {/* 选区高亮：画在文字上面一层，半透明蓝 */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {highlights.map((h) => (
          <View
            key={h.key}
            style={{
              position: 'absolute',
              top: h.top,
              left: h.left,
              width: h.w,
              height: lineH,
              backgroundColor: 'rgba(0,122,255,0.28)',
            }}
          />
        ))}
      </View>

      {/* 选中后浮出的动作条 */}
      {hasSelection && !dragging ? (
        <View style={styles.actions} pointerEvents="box-none">
          <Text style={styles.count} numberOfLines={1}>
            已选 {selectedText.trim().length} 字
          </Text>
          <View style={{ flexDirection: 'row' }}>
            <ActionBtn label="净化" onPress={() => onAction(selectedText.trim(), 'filter')} />
            <ActionBtn label="复制" onPress={() => onAction(selectedText.trim(), 'copy')} />
            <ActionBtn label="取消" onPress={() => setSel(null)} ghost />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ActionBtn({
  label,
  onPress,
  ghost,
}: {
  label: string;
  onPress: () => void;
  ghost?: boolean;
}) {
  return (
    <View
      onStartShouldSetResponder={() => true}
      onResponderRelease={onPress}
      style={[styles.btn, ghost ? styles.btnGhost : styles.btnSolid]}
    >
      <Text style={[styles.btnText, ghost && { color: '#9aa0a6' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: 'rgba(28,28,30,0.96)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  count: { color: '#8e8e93', fontSize: 12, flexShrink: 1, marginRight: 10 },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    marginLeft: 8,
  },
  btnSolid: { backgroundColor: '#0a84ff' },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.08)' },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
