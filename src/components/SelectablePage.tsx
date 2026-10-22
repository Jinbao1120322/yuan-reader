import React, { useMemo, useRef, useState } from 'react';
import { View, StyleSheet, PanResponder } from 'react-native';
import { Text } from './AppText';

/*
 * ===========================================================================
 * 自绘文字选择（SelectablePage）—— 对齐爱阅书香的交互
 * ===========================================================================
 * 交互要点：
 *   1. 按住拖动 → 蓝色高亮跟着走
 *   2. 选区**两端各有一个可拖的手柄**，拖它精调起止位置
 *   3. 选区上方浮一条菜单：**净化 / 替换**（不用低头找底部按钮）
 *
 * 为什么不用系统 TextInput：
 *   `<Text selectable>` 拿不到选中范围；`TextInput` 在 iOS 上要么手柄出不来，
 *   要么弹键盘挡住半屏。所以坐标、选区、手柄、菜单全部自己算。
 *
 * 前提：正文已按行切好（`\n` 分隔），所以「第 i 行 y = i × 行高」是确定的，
 * 字符 x 按字宽累加即可（CJK 全角、其余半角）。
 * ===========================================================================
 */

export type SelectAction = 'filter' | 'replace';

interface Props {
  text: string;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  color: string;
  bg: string;
  padTop: number;
  padBottom: number;
  padH: number;
  /** 净化 = 直接删；替换 = 打开输入框 */
  onAction: (selected: string, action: SelectAction) => void;
}

interface Pos {
  line: number;
  ch: number;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0xa960 && code <= 0xa97f)
  );
}

function xAt(line: string, index: number, fs: number): number {
  let w = 0;
  const n = Math.min(index, line.length);
  for (let i = 0; i < n; i++) {
    w += isWide(line.charCodeAt(i)) ? fs : fs * 0.5;
  }
  return w;
}

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

  const selRef = useRef(sel);
  selRef.current = sel;

  const hitTest = (x: number, y: number): Pos => {
    const rel = y - padTop;
    let line = Math.floor(rel / lineH);
    if (line < 0) line = 0;
    if (line > lines.length - 1) line = Math.max(0, lines.length - 1);
    const ch = charAt(lines[line] || '', x - padH, fontSize);
    return { line, ch };
  };

  /* ---------- 主体拖动：拉出选区 ---------- */
  const bodyResponder = useMemo(
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
        onPanResponderRelease: () => setDragging(false),
        onPanResponderTerminate: () => setDragging(false),
      }),
    [lines, lineH, padTop, padH, fontSize]
  );

  /* ---------- 选区规范化 ---------- */
  const range = useMemo(() => {
    if (!sel) return null;
    let a = sel.anchor;
    let b = sel.focus;
    if (a.line > b.line || (a.line === b.line && a.ch > b.ch)) [a, b] = [b, a];
    return { a, b };
  }, [sel]);

  const selectedText = useMemo(() => {
    if (!range) return '';
    const { a, b } = range;
    if (a.line === b.line) return (lines[a.line] || '').slice(a.ch, b.ch);
    const parts: string[] = [(lines[a.line] || '').slice(a.ch)];
    for (let i = a.line + 1; i < b.line; i++) parts.push(lines[i] || '');
    parts.push((lines[b.line] || '').slice(0, b.ch));
    return parts.join('\n');
  }, [range, lines]);

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

  /* ---------- 手柄位置 ---------- */
  const handles = useMemo(() => {
    if (!range) return null;
    const { a, b } = range;
    return {
      a: {
        x: padH + xAt(lines[a.line] || '', a.ch, fontSize),
        y: padTop + a.line * lineH,
      },
      b: {
        x: padH + xAt(lines[b.line] || '', b.ch, fontSize),
        y: padTop + b.line * lineH,
      },
    };
  }, [range, lines, fontSize, lineH, padTop, padH]);

  /** 手柄拖动：拖起点改 anchor，拖终点改 focus，并自动纠正前后关系 */
  const makeHandleResponder = (which: 'anchor' | 'focus') => () =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => setDragging(true),
      onPanResponderMove: (_e, g) => {
        const cur = selRef.current;
        if (!cur) return;
        // 目标点 = 手柄**原始位置** + 手指位移（locationX 是相对手柄的，不能用）
        const base = which === 'anchor' ? handles?.a : handles?.b;
        if (!base) return;
        let target = hitTest(base.x + g.dx, base.y + g.dy);

        /*
         * 钳制（clamp）：起点不能越过终点，终点不能越过起点。
         * 之前写的是「越过了就交换」，交换之后手柄的身份变了 ——
         * 用户手里拖着的这个手柄突然变成另一端，再拖就完全是反的，
         * 感觉就是「动不了 / 只能重头来」。系统选择也是 clamp，不交换。
         */
        if (which === 'anchor') {
          const f = cur.focus;
          if (target.line > f.line || (target.line === f.line && target.ch > f.ch)) {
            target = { ...f };
          }
          setSel({ anchor: target, focus: f });
        } else {
          const a = cur.anchor;
          if (target.line < a.line || (target.line === a.line && target.ch < a.ch)) {
            target = { ...a };
          }
          setSel({ anchor: a, focus: target });
        }
      },
      onPanResponderRelease: () => setDragging(false),
      onPanResponderTerminate: () => setDragging(false),
    });

  const anchorResponder = useMemo(
    () => makeHandleResponder('anchor')(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handles, lines, lineH, padTop, padH, fontSize]
  );
  const focusResponder = useMemo(
    () => makeHandleResponder('focus')(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handles, lines, lineH, padTop, padH, fontSize]
  );

  const hasSelection = selectedText.trim().length > 0;

  /* ---------- 浮动菜单位置：选区上方，放不下就放下面 ---------- */
  const menuPos = useMemo(() => {
    if (!highlights.length) return null;
    const first = highlights[0];
    const last = highlights[highlights.length - 1];
    const MENU_H = 44;
    const above = first.top - MENU_H - 10;
    const top = above > 10 ? above : last.top + lineH + 10;
    const cx = first.left + first.w / 2;
    const left = Math.min(Math.max(8, cx - 70), width - 148);
    return { top, left };
  }, [highlights, lineH, width]);

  return (
    <View style={{ width, height, backgroundColor: bg }}>
      {/* 正文：逐行渲染，行坐标才确定 */}
      <View style={{ flex: 1 }} {...bodyResponder.panHandlers}>
        <View
          style={{ paddingTop: padTop, paddingBottom: padBottom, paddingHorizontal: padH }}
        >
          {lines.map((line, i) => (
            <Text
              key={`ln-${i}`}
              numberOfLines={1}
              ellipsizeMode="clip"
              style={{ fontSize, lineHeight: lineH, height: lineH, color }}
            >
              {line || ' '}
            </Text>
          ))}
        </View>
      </View>

      {/* 高亮 */}
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
              backgroundColor: 'rgba(10,132,255,0.26)',
            }}
          />
        ))}
      </View>

      {/* 两端手柄：拖它精调起止 */}
      {handles ? (
        <>
          <Handle x={handles.a.x} y={handles.a.y} lineH={lineH} responder={anchorResponder} />
          <Handle x={handles.b.x} y={handles.b.y} lineH={lineH} responder={focusResponder} />
        </>
      ) : null}

      {/* 菜单：净化 / 替换 */}
      {hasSelection && !dragging && menuPos ? (
        <View style={[styles.menu, { top: menuPos.top, left: menuPos.left }]}>
          <MenuBtn label="净化" onPress={() => onAction(selectedText.trim(), 'filter')} />
          <View style={styles.divider} />
          <MenuBtn label="替换" onPress={() => onAction(selectedText.trim(), 'replace')} />
        </View>
      ) : null}
    </View>
  );
}

/** 选区端点手柄：一个圆点 + 一条竖线 */
function Handle({
  x,
  y,
  lineH,
  responder,
}: {
  x: number;
  y: number;
  lineH: number;
  responder: ReturnType<typeof PanResponder.create>;
}) {
  return (
    <View
      {...responder.panHandlers}
      hitSlop={{ top: 18, bottom: 18, left: 18, right: 18 }}
      style={{ position: 'absolute', left: x - 12, top: y, width: 24, height: lineH }}
    >
      <View
        style={{
          position: 'absolute',
          left: 11,
          top: 0,
          width: 2,
          height: lineH,
          backgroundColor: '#0a84ff',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 2,
          top: lineH / 2 - 10,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: '#0a84ff',
          borderWidth: 2,
          borderColor: '#fff',
        }}
      />
    </View>
  );
}

function MenuBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <View
      onStartShouldSetResponder={() => true}
      onResponderRelease={onPress}
      style={styles.menuBtn}
    >
      <Text style={styles.menuBtnText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f2f2f7',
    borderRadius: 10,
    paddingHorizontal: 4,
    height: 44,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  menuBtn: { paddingHorizontal: 20, paddingVertical: 10 },
  menuBtnText: { color: '#1c1c1e', fontSize: 15, fontWeight: '500' },
  divider: { width: StyleSheet.hairlineWidth, height: 20, backgroundColor: '#c7c7cc' },
});
