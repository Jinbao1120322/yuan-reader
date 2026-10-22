import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { ReaderTheme } from '../theme/theme';
import {
  PAGE_FOOTER_H,
  PAGE_HEADER_H,
  PAGE_PAD_BOTTOM,
  PAGE_PAD_H,
  PAGE_PAD_TOP,
} from '../theme/layout';
import { Text } from './AppText';

// 卷曲段切片数。这一段在纸面上只有 πR/2 ≈ 93pt 宽，12 片足够看出圆弧，
// 再加片数收益很小，却要多渲染整页文字副本。
const COLS = 12;

// 圆柱半径占页宽的比例。逆向出来的原版 iPhone 初值是 50（iPad 80），
// 这里按页宽等比取，并夹在 [40, 84] 之间，避免小屏过卷 / 大屏太平。
const R_RATIO = 0.14;
const R_MIN = 40;
const R_MAX = 84;

/*
 * ===========================================================================
 * 几何：逆向自「爱阅书香」的圆柱卷曲（原版是 OpenGL ES 顶点着色器）
 * ===========================================================================
 *
 *   n  = (sin a, -cos a)     圆柱轴法线。翻页时 a = π/2，所以 n = (1, 0)
 *   d  = dot(p - c, n)       纸面点到圆柱轴的有符号距离
 *
 *   d <= 0        → 平放，z = 0
 *   0 < d <= πR   → 卷到圆柱面上：θ = d/R
 *                   p' = proj + R·sin(θ)·n     (proj = p - n·d)
 *                   z  = R·(1 - cos(θ))
 *   d > πR        → 绕过顶部，背面平铺：p' = p - n·(2d - πR)，z = 2R
 *
 * 关键推论一：**只有 θ ∈ [0, π/2] 的部分可见**。
 *   θ 越过 π/2 后法线 n.z = cos(θ) < 0，原版片元着色器做 rgb *= n.z，
 *   会把它压成纯黑 —— 也就是说这段被圆柱自己挡住了。
 *   于是投影区间互不重叠，不需要 zIndex 排序：
 *     卷曲可见段  p' ∈ [c, c+R]
 *     背面        p' ∈ [2c + πR - W, c]
 *
 * 关键推论二：**卷曲段的形状是常量**。
 *   第 i 片的纸面区间是 [i·SLICE, (i+1)·SLICE)，SLICE = (πR/2)/COLS。
 *   它的投影左缘恒为 R·sin(iθ)，宽度恒为 R·(sin((i+1)θ) - sin(iθ))，θ = π/(2·COLS)。
 *   这两项都只跟 R 有关，**与翻页进度无关**。
 *   所以整段卷曲只有外层一个 translateX 跟着折痕移动，内部片全部静态 ——
 *   翻页过程中不重排、不重建，性能跟单页动画差不多。
 *
 * 折痕位置 c 的行程：
 *   next（当前页卷走向左消失）：c 从 W 走到 -πR/2
 *   prev（上一页展开向右盖满）：  c 从 -πR/2 走到 W
 *   两端各多走 πR/2，是为了让卷曲段整个滑出屏幕，翻完时不留一条纸边。
 */
interface CurlSlice {
  dx: number; // translateX：把片摆到投影位置
  scale: number; // scaleX：投影宽度 / 纸面宽度
  innerDx: number; // 内容 translateX：把整页挪到本片该显示的纸面区域
  dark: number; // 压暗强度（原版是 rgb *= cos θ）
}

/*
 * 单页内容层（memo 化）
 * ===========================================================================
 * 为什么必须是 memo 组件：
 * 翻页完成时 index 变 1，整个 PageCurlView 重渲染。原来 pageBody 是内联函数，
 * 每次都会创建全新的 View + Text —— 新页得重新做一次文字排版，几十毫秒里
 * 底下的页面是空的，也就是用户看到的「下一页空白一下才出现内容」。
 *
 * memo 之后，同一个 text 字符串渲染出的页面会被 React 复用：
 * 翻页前它是 under 页，翻完之后它变成当前页，节点不用重建，也就没有空窗。
 * 卷曲段的 12 个切片用的是同一页文本，也一起吃这个红利。
 */
/*
 * 压掉文本里的连续空行。
 * 空行没有任何可见内容，但渲染时会占掉整整一行的高度 ——
 * 段落之间就会莫名其妙空一截。数据从哪来的都可能带空行
 * （原文结构、onTextLayout 切行、切页 join），所以在送进 Text 之前统一压一遍。
 */
function collapseBlankLines(text: string): string {
  return String(text || '').replace(/(\r?\n)(?:[ \t\u3000]*\r?\n)+/g, '$1');
}

const PageLayer = React.memo(function PageLayer({
  text,
  imageUri,
  width,
  height,
  bg,
  padTop,
  padBottom,
  textStyle,
}: {
  text: string;
  imageUri?: string;
  width: number;
  height: number;
  bg: string;
  padTop: number;
  padBottom: number;
  textStyle: any;
}) {
  /*
   * 有预渲染好的位图就直接贴图 —— 这是「爱阅书香」的做法：
   * 翻页期间完全不碰文字排版，只对一张图做几何变换，物理上不可能出现空白。
   * 没有图时才退回实时渲染文字（首屏、刚换章、刚换字号的那一下）。
   */
  // 渲染前再压一次空行：双保险，就算上层数据漏了也不会显示空白行
  const safeText = collapseBlankLines(text);
  if (imageUri) {
    return (
      <View style={[styles.page, { width, height, backgroundColor: bg }]}>
        <Image
          source={{ uri: imageUri }}
          style={{ width, height }}
          resizeMode="cover"
          fadeDuration={0}
        />
      </View>
    );
  }
  return (
    <View
      style={[
        styles.page,
        {
          width,
          height,
          backgroundColor: bg,
          paddingTop: padTop,
          paddingBottom: padBottom,
        },
      ]}
      /*
       * 去掉了 shouldRasterizeIOS：
       * 光栅化要 GPU 先把整页合成成一张纹理，内容一变（翻页/换章/换字号）
       * 就得重新生成 —— 那一瞬间屏幕上是空的。之前翻页"空白一下"、
       * 甚至一直白，很可能就是它和节点重建叠加的结果。
       * 现在靠 PageLayer 的 memo 保证节点复用，不需要再光栅化了。
       */
      renderToHardwareTextureAndroid
    >
      <Text style={[styles.pageText, textStyle]}>{safeText || ' '}</Text>
    </View>
  );
});

interface Props {
  pages: string[];
  index: number; // 当前页（受控）
  onPageChange: (i: number) => void; // 页内翻页（带动画）
  canPrev: boolean;
  canNext: boolean;
  mode: 'simulate' | 'slide';
  theme: ReaderTheme;
  fontSize: number;
  lineHeight: number;
  areaW: number;
  areaH: number;
  onTapLeft: () => void; // 章边界：翻到上一章
  onTapRight: () => void; // 章边界：翻到下一章
  onTapCenter: () => void; // 打开/收起工具栏
  onLongPress?: () => void; // 长按正文：打开「过滤文字」面板
  /** 页眉占位高度，0 = 不显示页眉（正文直接排到边上） */
  headerH?: number;
  /** 页脚占位高度，0 = 不显示页脚 */
  footerH?: number;
  /** 页号 → 预渲染位图 URI。有图就贴图，翻页期间不碰文字排版 */
  images?: Record<number, string>;
}

export function PageCurlView(props: Props) {
  const {
    pages,
    index,
    mode,
    theme,
    fontSize,
    lineHeight,
    areaW,
    areaH,
    headerH = PAGE_HEADER_H,
    footerH = PAGE_FOOTER_H,
    images,
    onLongPress,
  } = props;

  const AW = Math.max(areaW, 1);
  const AH = Math.max(areaH, 1);
  const THRESH = AW * 0.28;
  const FLING = AW * 0.476;

  // 圆柱半径与由它导出的一串常量
  const R = Math.min(Math.max(AW * R_RATIO, R_MIN), R_MAX);
  const ARC = (Math.PI * R) / 2; // 卷曲可见段的纸面长度
  const SLICE = ARC / COLS; // 每片纸面宽度
  const PI_R = Math.PI * R;
  const CU_END = -ARC; // 折痕的两端（卷曲段完全滑出屏幕）

  // 全部换成 Reanimated：手势和动画都在 UI 线程（worklet）里跑，
  // 不经过 JS 桥，翻页/拖动都不会被 JS 线程拖累。
  const dragX = useSharedValue(0);
  const dirSV = useSharedValue(0); // 0 = next, 1 = prev（给 UI 线程判断用）
  const animatingSV = useSharedValue(false);

  const latest = useRef(props);
  latest.current = props;

  const grantX = useSharedValue(0);
  const [dir, setDir] = useState<'next' | 'prev'>('next');

  useEffect(() => {
    animatingSV.value = false;
    dragX.value = 0;
    /*
     * 必须把方向重置回 next。
     * 静止状态（dragX = 0）下，如果 dir 还是 'prev'，布局是「纸面宽度 0、纸背铺满」——
     * 纸背是纯色块（barBg），结果整屏只有背景色，看起来就是「内容变空白」。
     * 用户「往前滑一页就空」正是这个原因。
     */
    dirSV.value = 0;
    setDir('next');
  }, [index, areaW, mode, animatingSV, dragX, dirSV]);

  // 每片的静态几何：只跟 R 有关，翻页过程中完全不变
  const curl = useMemo<CurlSlice[]>(() => {
    const theta = Math.PI / 2 / COLS;
    const out: CurlSlice[] = [];
    for (let i = 0; i < COLS; i++) {
      const p0 = R * Math.sin(i * theta);
      const p1 = R * Math.sin((i + 1) * theta);
      const scale = SLICE > 0 ? (p1 - p0) / SLICE : 1;
      out.push({
        // scaleX 默认绕片中心缩放，左缘会右移 SLICE·(1-s)/2，用 dx 补回来，
        // 这样片就精确落在 [p0, p1] 上，相邻片严丝合缝。
        dx: p0 - (SLICE * (1 - scale)) / 2,
        scale,
        // 内容从整页左上角起算，向左挪 i 片，正好取到本片该显示的纸面区域
        innerDx: -i * SLICE,
        // 原版片元着色器 rgb *= n.z，n.z = cos θ —— 越靠折痕越暗
        dark: Math.min(1, (1 - Math.cos((i + 0.5) * theta)) * 1.05),
      });
    }
    return out;
  }, [R, SLICE]);

  /*
   * ===== 动画样式（全部在 UI 线程算）=====
   * 折痕位置 c 的行程：
   *   next：c 从 W 走到 -πR/2   prev：c 从 -πR/2 走到 W
   * 下面每个 useAnimatedStyle 都自己算一遍 c —— worklet 里不做函数抽取，
   * 避免跨 worklet 调用的序列化开销。
   */
  const cuOf = `__CU__`; // 占位，实际逻辑写在各 style 内

  /** 平铺段右侧遮罩的位移（等于折痕位置 c） */
  const maskStyle = useAnimatedStyle(() => {
    const cu =
      dirSV.value === 0
        ? interpolate(dragX.value, [-AW, 0], [CU_END, AW], Extrapolation.CLAMP)
        : interpolate(dragX.value, [0, AW], [CU_END, AW], Extrapolation.CLAMP);
    const flatW = interpolate(cu, [CU_END, 0, AW], [0, 0, AW], Extrapolation.CLAMP);
    return { transform: [{ translateX: flatW }] };
  }, [AW, CU_END]);

  /** 纸背：宽度用 scaleX 表达，配 translateX 补偿 */
  const backStyle = useAnimatedStyle(() => {
    const cu =
      dirSV.value === 0
        ? interpolate(dragX.value, [-AW, 0], [CU_END, AW], Extrapolation.CLAMP)
        : interpolate(dragX.value, [0, AW], [CU_END, AW], Extrapolation.CLAMP);
    const backW = interpolate(
      cu,
      [CU_END, 0, AW - PI_R, AW],
      [AW + ARC - PI_R, AW - PI_R, 0, 0],
      Extrapolation.CLAMP
    );
    const backX = interpolate(
      cu,
      [CU_END, AW],
      [2 * CU_END + PI_R - AW, 2 * AW + PI_R - AW],
      Extrapolation.CLAMP
    );
    const scale = AW > 0 ? backW / AW : 1;
    // scaleX 绕元素中心缩放，左缘会右移 W(1-s)/2，用 translateX 补回来
    const tx = backX + (backW - AW) / 2;
    return { transform: [{ translateX: tx }, { scaleX: scale }] };
  }, [AW, CU_END, PI_R, ARC]);

  /** 折痕阴影：翻得越深越明显 */
  const creaseStyle = useAnimatedStyle(() => {
    const q =
      dirSV.value === 0
        ? interpolate(dragX.value, [-AW, 0], [1, 0], Extrapolation.CLAMP)
        : interpolate(dragX.value, [0, AW], [0, 1], Extrapolation.CLAMP);
    const op = interpolate(q, [0, 0.15, 0.85, 1], [0, 0.32, 0.32, 0], Extrapolation.CLAMP);
    return { opacity: op };
  }, [AW]);

  /** 卷曲层整体跟着折痕平移（内部 12 片是静态的） */
  const curlStyle = useAnimatedStyle(() => {
    const cu =
      dirSV.value === 0
        ? interpolate(dragX.value, [-AW, 0], [CU_END, AW], Extrapolation.CLAMP)
        : interpolate(dragX.value, [0, AW], [CU_END, AW], Extrapolation.CLAMP);
    return { transform: [{ translateX: cu }] };
  }, [AW, CU_END]);

  /** slide 模式：整页平移 + 收尾淡出 */
  const slideStyle = useAnimatedStyle(() => {
    if (dirSV.value !== 0) return { transform: [{ translateX: dragX.value }], opacity: 1 };
    const q = interpolate(dragX.value, [-AW, 0], [1, 0], Extrapolation.CLAMP);
    const op = interpolate(q, [0, 0.98, 1], [1, 1, 0], Extrapolation.CLAMP);
    return { transform: [{ translateX: dragX.value }], opacity: op };
  }, [AW]);


  // 这四个回调必须稳定（worklet 里通过 runOnJS 调），内部读 latest 拿最新值
  const commitFlip = useCallback((d: 'next' | 'prev') => {
    const P = latest.current;
    P.onPageChange(P.index + (d === 'next' ? 1 : -1));
  }, []);
  const doTapLeft = useCallback(() => latest.current.onTapLeft(), []);
  const doTapRight = useCallback(() => latest.current.onTapRight(), []);
  const doTapCenter = useCallback(() => latest.current.onTapCenter(), []);

  const canPrev = props.canPrev;
  const canNext = props.canNext;

  const gesture = useMemo(() => {
    // 全部 'worklet'：手势判定 + 动画都在 UI 线程跑，JS 线程再忙也不掉帧
    const flip = (d: 'next' | 'prev') => {
      'worklet';
      // 点击翻页不经过 onUpdate，这里必须自己把方向切过去，
      // 否则渲染的还是错误方向的页面组合。
      dirSV.value = d === 'next' ? 0 : 1;
      runOnJS(setDir)(d);
      animatingSV.value = true;
      dragX.value = withTiming(d === 'next' ? -AW : AW, { duration: 280 }, (fin) => {
        if (fin) {
          runOnJS(commitFlip)(d);
        } else {
          dragX.value = 0;
        }
        animatingSV.value = false;
      });
    };

    const springBack = () => {
      'worklet';
      dragX.value = withSpring(0, { damping: 24, stiffness: 320, mass: 0.6 }, (fin) => {
        // 回弹到位、回到静止，方向也要归位，否则又变成纯色空屏
        if (fin) runOnJS(setDir)('next');
      });
    };

    // 长按：打开过滤面板。放 Exclusive 最前面，手指按住不动 450ms 就归它
    const longPress = Gesture.LongPress()
      .minDuration(400)
      .maxDistance(30) // 手指按住时的自然抖动不算移动
      .onEnd(() => {
        'worklet';
        if (onLongPress) runOnJS(onLongPress)();
      });

    // 轻点必须单独用 Tap 手势：Pan 需要手指移动才会激活，
    // 纯点击（不移动）Pan 根本不会触发 onEnd —— 换到 Reanimated 之后
    // 「点屏幕中间收/开工具栏」就失灵了，工具栏一直挂着关不掉。
    const tap = Gesture.Tap()
      .maxDistance(14)
      .onEnd((e) => {
        'worklet';
        if (animatingSV.value) return;
        const x = e.x;
        if (x < AW * 0.33) {
          if (canPrev) flip('prev');
          else runOnJS(doTapLeft)();
        } else if (x > AW * 0.67) {
          if (canNext) flip('next');
          else runOnJS(doTapRight)();
        } else {
          runOnJS(doTapCenter)();
        }
      });

    const pan = Gesture.Pan()
      /*
       * 必须给 Pan 设激活距离。
       * 不设的话它几乎一碰就激活，长按（要 400ms 不动）永远抢不过它 ——
       * 表现就是「长按没反应」，进不了选取模式。
       * 24pt 对翻页几乎没影响（半厘米都不到），但给长按留出了窗口。
       */
      .activeOffsetX([-24, 24])
      .failOffsetY([-40, 40])
      .onBegin((e) => {
        'worklet';
        grantX.value = e.x;
        if (!animatingSV.value) dragX.value = 0;
      })
      .onUpdate((e) => {
        'worklet';
        if (animatingSV.value) return;
        const dx = e.translationX;
        if (dx < -4 && dirSV.value !== 0) {
          dirSV.value = 0;
          runOnJS(setDir)('next');
        } else if (dx > 4 && dirSV.value !== 1) {
          dirSV.value = 1;
          runOnJS(setDir)('prev');
        }
        dragX.value = dx;
      })
      .onEnd((e) => {
        'worklet';
        if (animatingSV.value) return;
        const dx = e.translationX;
        const dist = Math.sqrt(dx * dx + e.translationY * e.translationY);

        // 轻点：三分区——左翻上一页 / 右翻下一页 / 中间切工具栏
        if (dist < 20) {
          dragX.value = 0;
          const x = grantX.value;
          if (x < AW * 0.33) {
            if (canPrev) flip('prev');
            else runOnJS(doTapLeft)();
          } else if (x > AW * 0.67) {
            if (canNext) flip('next');
            else runOnJS(doTapRight)();
          } else {
            runOnJS(doTapCenter)();
          }
          return;
        }

        if (dx < -THRESH) {
          if (canNext) {
            flip('next');
          } else {
            springBack();
            if (dx < -FLING) runOnJS(doTapRight)();
          }
        } else if (dx > THRESH) {
          if (canPrev) {
            flip('prev');
          } else {
            springBack();
            if (dx > FLING) runOnJS(doTapLeft)();
          }
        } else {
          springBack();
        }
      });

    // 拖动优先，没拖动就交给 tap
    return Gesture.Exclusive(longPress, pan, tap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [AW, THRESH, FLING, canPrev, canNext]);

  // 必须 useMemo：这个对象每次新建的话，下面的 PageLayer.memo 永远不会命中
  const textStyle = useMemo(
    () => ({
      color: theme.text,
      fontSize,
      lineHeight: fontSize * lineHeight,
    }),
    [theme.text, fontSize, lineHeight]
  );

  // 每份页面必须自带不透明底色。
  // 底层（还没翻到的那页）永远铺在最下面，如果上面的页面是透明的，
  // 两页文字就会叠印在一起 —— 看上去像「第二页的字印到了上一页」。
  const pageBody = (rawText: string, pageIdx: number) => (
    <PageLayer
      text={collapseBlankLines(rawText)}
      imageUri={images?.[pageIdx]}
      width={areaW}
      height={areaH}
      bg={theme.bg}
      padTop={PAGE_PAD_TOP + headerH}
      padBottom={PAGE_PAD_BOTTOM + footerH}
      textStyle={textStyle}
    />
  );

  // simulate：翻下一页时上层是当前页、底层是下一页；翻上一页时上层是上一页、底层是当前页。
  // slide：当前页直接平移走，底层换成真正该露出的那一页。
  const sheetText = dir === 'next' ? pages[index] ?? '' : pages[index - 1] ?? '';
  // 页码：给 PageLayer 找对应的预渲染位图
  const sheetIdx = dir === 'next' ? index : index - 1;
  const underIdx = dir === 'next' ? index + 1 : index;
  const underText = dir === 'next' ? pages[index + 1] ?? '' : pages[index] ?? '';
  const slideUnder = dir === 'next' ? pages[index + 1] ?? '' : pages[index - 1] ?? '';

  if (mode === 'slide') {
    return (
      <GestureDetector gesture={gesture}>
        <View
          style={[styles.container, { width: areaW, height: areaH, backgroundColor: theme.bg }]}
        >
          {index > 0 && pages[index - 1] ? (
            <View style={[styles.layer, { zIndex: 0, opacity: 0 }]} pointerEvents="none">
              {pageBody(pages[index - 1], index - 1)}
            </View>
          ) : null}
          <View style={[styles.layer, { zIndex: 1 }]} pointerEvents="none">
            {pageBody(slideUnder, dir === 'next' ? index + 1 : index - 1)}
          </View>
          <Animated.View style={[styles.layer, { zIndex: 2 }, slideStyle]} pointerEvents="none">
            {pageBody(pages[index] ?? '', index)}
          </Animated.View>
        </View>
      </GestureDetector>
    );
  }

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[styles.container, { width: areaW, height: areaH, backgroundColor: theme.bg }]}
      >
      {/*
       * 预渲染「上一页」（完全透明，看不见但参与布局）。
       * 为什么需要它：静止时只渲染了当前页和下一页，往回翻的那一页是**第一次**上屏，
       * 要现场做文字排版 —— 那几十毫秒里就是用户看到的「往回翻变空白」。
       * 翻下一页不空，正是因为下一页一直作为底层渲染着、早就排好了。
       * 这里把上一页也提前挂上去，配合 PageLayer 的 memo，翻回去时直接复用。
       */}
      {index > 0 && pages[index - 1] ? (
        <View style={[styles.layer, { zIndex: 0, opacity: 0 }]} pointerEvents="none">
          {pageBody(pages[index - 1], index - 1)}
        </View>
      ) : null}

      {/* 底层：还没翻到的那一页 */}
      <View style={[styles.layer, { zIndex: 1 }]} pointerEvents="none">
        {pageBody(underText, underIdx)}
      </View>

      {/* 平铺段：纸面 [0, c]。
          以前靠动画容器 width 来裁掉右边，width 不能用原生驱动；
          现在改成「整页铺满 + 一块跟着折痕走的底色遮罩」，只动 translateX。 */}
      <View
        style={[styles.flat, { zIndex: 2, width: areaW, height: areaH }]}
        pointerEvents="none"
      >
        {pageBody(sheetText, sheetIdx)}
        {/* 遮罩必须放在平铺段**内部**：放外面会连下面那页一起盖掉，
            右上角就变成一片空白了。这里只盖住本节自己的内容。 */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 0,
              top: 0,
              width: areaW,
              height: areaH,
              backgroundColor: theme.bg,
            },
            maskStyle,
          ]}
          pointerEvents="none"
        />
      </View>

      {/* 纸背：绕过圆柱顶之后平铺回来的那一段，压住平铺段的右端。
          纯色块，宽度用 scaleX 表达即可，肉眼无差。 */}
      <Animated.View
        style={[
          styles.back,
          {
            zIndex: 4,
            width: areaW,
            height: areaH,
            backgroundColor: theme.barBg,
          },
          backStyle,
        ]}
        pointerEvents="none"
      >
        {/* 折痕投影：纸和下面那页之间的暗部，翻得越深越明显 */}
        <Animated.View
          style={[styles.crease, { height: areaH }, creaseStyle]}
          pointerEvents="none"
        />
      </Animated.View>

      {/* 卷曲段：整段跟着折痕平移，内部 12 片全部静态 */}
      <Animated.View
        style={[styles.curlLayer, { zIndex: 5, width: AW, height: areaH }, curlStyle]}
        pointerEvents="none"
      >
        {curl.map((c, i) => (
          <View
            key={i}
            style={[
              styles.curlSlice,
              {
                width: SLICE + 0.5, // 多半个点吃掉浮点误差，避免相邻片出现发丝缝
                height: areaH,
                transform: [{ translateX: c.dx }, { scaleX: c.scale }],
              },
            ]}
            pointerEvents="none"
          >
            <View style={[styles.clip, { width: SLICE + 0.5, height: areaH }]} pointerEvents="none">
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: areaW,
                  height: areaH,
                  transform: [{ translateX: c.innerDx }],
                }}
                pointerEvents="none"
              >
                {pageBody(sheetText, sheetIdx)}
              </View>
            </View>
            {/* 圆柱面上的明暗：原版 rgb *= cos θ */}
            <View
              style={[StyleSheet.absoluteFill, styles.dark, { opacity: c.dark }]}
              pointerEvents="none"
            />
          </View>
        ))}
      </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative', overflow: 'hidden' },
  layer: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  page: {
    // 必须和 pageTextHeight 用同一套常量，否则分页算出来的行数和实际渲染对不上，
    // 就会出现「最后一行被裁半个字」和「底部空一块」
    paddingHorizontal: PAGE_PAD_H,
    // 上下内边距在渲染时按「是否显示页眉页脚」动态给（见 pageBody）
  },
  pageText: { textAlign: 'left' },
  flat: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  back: { position: 'absolute', left: 0, top: 0 },
  crease: { position: 'absolute', right: 0, top: 0, width: 14, backgroundColor: '#000' },
  curlLayer: { position: 'absolute', left: 0, top: 0 },
  // 外层不能 overflow:hidden，否则 scaleX 压缩后超出布局宽的部分会被裁掉
  curlSlice: { position: 'absolute', left: 0, top: 0 },
  clip: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  dark: { backgroundColor: '#000' },
});
