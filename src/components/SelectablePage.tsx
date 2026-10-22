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
  /** 退出选择模式 */
  onExit: () => void;
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
    onExit,
  } = props;

  const lineH = fontSize * lineHeight;
  const lines = useMemo(() => String(text || '').split('\n'), [text]);

  const [sel, setSel] = useState<{ anchor: Pos; focus: Pos } | null>(null);
  const [dragging, setDragging] = useState(false);

  const selRef = useRef(sel);
  selRef.current = sel;

  /*
   * 手柄拖动时**冻结**起始坐标。
   * 如果每次 move 都读「手柄当前位置 + 累计 dy」，而手柄位置又被上一次 move 改过，
   * 位移就会被重复累加 —— 手指移 10pt，选区跑 20pt、30pt，越拖越远（"乱跑"）。
   * 所以 Grant 时把基准存下来，整个拖动过程只用它。
   */
  const dragBaseRef = useRef<{ x: number; y: number } | null>(null);

  /*
   * 排版参数走 ref。
   * PanResponder 必须是**一次性创建**的（依赖为空），否则选区一变 →
   * useMemo 重跑 → PanResponder 被换掉 → 正在进行的拖动直接中断。
   * 所以它内部不能闭包最新的 lines/lineH，只能通过 ref 读。
   */
  const metricsRef = useRef({ lines, lineH, padTop, padH, fontSize });
  metricsRef.current = { lines, lineH, padTop, padH, fontSize };

  const handlesRef = useRef<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);

  const hitTest = (x: number, y: number): Pos => {
    const m = metricsRef.current;
    const rel = y - m.padTop;
    let line = Math.floor(rel / m.lineH);
    if (line < 0) line = 0;
    if (line > m.lines.length - 1) line = Math.max(0, m.lines.length - 1);
    const ch = charAt(m.lines[line] || '', x - m.padH, m.fontSize);
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
    [] // 一次性创建，内部只读 ref
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

  handlesRef.current = handles;

  /** 手柄拖动：拖起点改 anchor，拖终点改 focus（钳制，不交换身份） */
  const makeHandleResponder = (which: 'anchor' | 'focus') => () =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        // 冻结基准：整个拖动过程只认这一份坐标
        dragBaseRef.current = (which === 'anchor' ? handlesRef.current?.a : handlesRef.current?.b) ?? null;
        setDragging(true);
      },
      onPanResponderMove: (_e, g) => {
        const cur = selRef.current;
        if (!cur) return;
        const base = dragBaseRef.current;
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
      onPanResponderRelease: () => {
        dragBaseRef.current = null;
        setDragging(false);
      },
      onPanResponderTerminate: () => {
        dragBaseRef.current = null;
        setDragging(false);
      },
    });

  // 手柄 responder 也只建一次（内部通过 handlesRef 拿实时位置）
  const anchorResponder = useMemo(() => makeHandleResponder('anchor')(), []);
  const focusResponder = useMemo(() => makeHandleResponder('focus')(), []);

  const hasSelection = selectedText.trim().length > 0;

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

      {/*
       * 底部固定操作条。
       * 原来用「浮在选区上方」的菜单，但选区靠上时会被顶部导航栏挡住、
       * 靠下时又被底部工具栏挡住 —— 位置算不完。改成钉死在容器底部，
       * 永远可见、永远点得到，而且顺带显示选中的内容预览。
       */}
      <View style={styles.bottomBar}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.preview} numberOfLines={1}>
            {hasSelection ? selectedText.trim() : '按住正文拖动选字'}
          </Text>
          <Text style={styles.previewSub} numberOfLines={1}>
            {hasSelection ? `已选 ${selectedText.trim().length} 字` : '选中后可净化或替换'}
          </Text>
        </View>
        {hasSelection ? (
          <>
            <BarBtn
              label="净化"
              solid
              onPress={() => onAction(selectedText.trim(), 'filter')}
            />
            <BarBtn label="替换" onPress={() => onAction(selectedText.trim(), 'replace')} />
          </>
        ) : null}
        <BarBtn label="退出" ghost onPress={onExit} />
      </View>
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

function BarBtn({
  label,
  onPress,
  solid,
  ghost,
}: {
  label: string;
  onPress: () => void;
  solid?: boolean;
  ghost?: boolean;
}) {
  return (
    <View
      onStartShouldSetResponder={() => true}
      onResponderRelease={onPress}
      style={[
        styles.barBtn,
        solid && styles.barBtnSolid,
        ghost && styles.barBtnGhost,
      ]}
    >
      <Text style={[styles.barBtnText, solid && { color: '#fff' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomBar: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(28,28,30,0.96)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  preview: { color: '#fff', fontSize: 13, fontWeight: '500' },
  previewSub: { color: '#8e8e93', fontSize: 11, marginTop: 2 },
  barBtn: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  barBtnSolid: { backgroundColor: '#0a84ff' },
  barBtnGhost: { backgroundColor: 'transparent' },
  barBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
