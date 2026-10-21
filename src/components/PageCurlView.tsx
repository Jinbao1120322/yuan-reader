import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Animated, PanResponder } from 'react-native';
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
}

export function PageCurlView(props: Props) {
  const { pages, index, mode, theme, fontSize, lineHeight, areaW, areaH } = props;

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

  const dragX = useRef(new Animated.Value(0)).current;

  const latest = useRef(props);
  latest.current = props;

  const grantX = useRef(0);
  const animating = useRef(false);
  const [dir, setDir] = useState<'next' | 'prev'>('next');
  const dirRef = useRef<'next' | 'prev'>('next');

  useEffect(() => {
    animating.current = false;
    dragX.stopAnimation();
    dragX.setValue(0);
  }, [index, areaW, mode, dragX]);

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

  const anim = useMemo(() => {
    // 折痕位置（屏幕坐标）
    const cuNext = dragX.interpolate({
      inputRange: [-AW, 0],
      outputRange: [CU_END, AW],
      extrapolate: 'clamp',
    });
    const cuPrev = dragX.interpolate({
      inputRange: [0, AW],
      outputRange: [CU_END, AW],
      extrapolate: 'clamp',
    });

    const mkFlat = (cu: any) =>
      cu.interpolate({
        inputRange: [CU_END, 0, AW],
        outputRange: [0, 0, AW],
        extrapolate: 'clamp',
      });

    // 背面：纸面 [c+πR, W] 投影到 [2c+πR-W, c]
    const mkBackW = (cu: any) =>
      cu.interpolate({
        inputRange: [CU_END, 0, AW - PI_R, AW],
        outputRange: [AW + ARC - PI_R, AW - PI_R, 0, 0],
        extrapolate: 'clamp',
      });
    const mkBackX = (cu: any) =>
      cu.interpolate({
        inputRange: [CU_END, AW],
        outputRange: [2 * CU_END + PI_R - AW, 2 * AW + PI_R - AW],
        extrapolate: 'clamp',
      });

    // 折痕阴影：翻得越深越明显
    const qNext = dragX.interpolate({
      inputRange: [-AW, 0],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    });
    const qPrev = dragX.interpolate({
      inputRange: [0, AW],
      outputRange: [0, 1],
      extrapolate: 'clamp',
    });

    return {
      cuNext,
      cuPrev,
      flatNext: mkFlat(cuNext),
      flatPrev: mkFlat(cuPrev),
      backWNext: mkBackW(cuNext),
      backWPrev: mkBackW(cuPrev),
      backXNext: mkBackX(cuNext),
      backXPrev: mkBackX(cuPrev),
      creaseNext: qNext.interpolate({
        inputRange: [0, 0.15, 0.85, 1],
        outputRange: [0, 0.32, 0.32, 0],
        extrapolate: 'clamp',
      }),
      creasePrev: qPrev.interpolate({
        inputRange: [0, 0.15, 0.85, 1],
        outputRange: [0, 0.32, 0.32, 0],
        extrapolate: 'clamp',
      }),
      // slide 模式：整页平移
      slide: { transform: [{ translateX: dragX }] },
      curOpacity: qNext.interpolate({
        inputRange: [0, 0.98, 1],
        outputRange: [1, 1, 0],
        extrapolate: 'clamp',
      }),
    };
  }, [dragX, AW, PI_R, ARC, CU_END]);

  const responder = useMemo(() => {
    const springBack = () => {
      Animated.spring(dragX, {
        toValue: 0,
        useNativeDriver: false, // 有 width 动画，native driver 不支持
        speed: 20,
        bounciness: 0,
      }).start();
    };

    const flip = (d: 'next' | 'prev') => {
      if (dirRef.current !== d) {
        dirRef.current = d;
        setDir(d);
      }
      animating.current = true;
      Animated.timing(dragX, {
        toValue: d === 'next' ? -AW : AW,
        duration: 280,
        useNativeDriver: false,
      }).start(({ finished }) => {
        animating.current = false;
        if (finished) {
          latest.current.onPageChange(
            latest.current.index + (d === 'next' ? 1 : -1)
          );
        } else {
          dragX.setValue(0);
        }
      });
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4,
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: (e) => {
        grantX.current = e.nativeEvent.locationX;
        if (!animating.current) {
          dragX.stopAnimation();
          dragX.setValue(0);
        }
      },

      onPanResponderMove: (_, g) => {
        if (animating.current) return;
        if (g.dx < -4 && dirRef.current !== 'next') {
          dirRef.current = 'next';
          setDir('next');
        } else if (g.dx > 4 && dirRef.current !== 'prev') {
          dirRef.current = 'prev';
          setDir('prev');
        }
        dragX.setValue(g.dx);
      },

      onPanResponderRelease: (_, g) => {
        if (animating.current) return;
        const P = latest.current;
        const dist = Math.sqrt(g.dx * g.dx + g.dy * g.dy);

        // 轻点：三分区——左翻上一页 / 右翻下一页 / 中间切工具栏
        if (dist < 20) {
          dragX.setValue(0);
          const x = grantX.current;
          if (x < AW * 0.33) {
            if (P.canPrev) flip('prev');
            else P.onTapLeft();
          } else if (x > AW * 0.67) {
            if (P.canNext) flip('next');
            else P.onTapRight();
          } else {
            P.onTapCenter();
          }
          return;
        }

        const dx = g.dx;
        if (dx < -THRESH) {
          if (P.canNext) flip('next');
          else {
            springBack();
            if (dx < -FLING) P.onTapRight();
          }
        } else if (dx > THRESH) {
          if (P.canPrev) flip('prev');
          else {
            springBack();
            if (dx > FLING) P.onTapLeft();
          }
        } else {
          springBack();
        }
      },

      onPanResponderTerminate: () => {
        springBack();
      },
    });
  }, [dragX, AW, THRESH, FLING]);

  const textStyle = {
    color: theme.text,
    fontSize,
    lineHeight: fontSize * lineHeight,
  };

  // 每份页面必须自带不透明底色。
  // 底层（还没翻到的那页）永远铺在最下面，如果上面的页面是透明的，
  // 两页文字就会叠印在一起 —— 看上去像「第二页的字印到了上一页」。
  const pageBody = (text: string) => (
    <View style={[styles.page, { width: areaW, height: areaH, backgroundColor: theme.bg }]}>
      <Text style={[styles.pageText, textStyle]}>{text || ' '}</Text>
    </View>
  );

  // simulate：翻下一页时上层是当前页、底层是下一页；翻上一页时上层是上一页、底层是当前页。
  // slide：当前页直接平移走，底层换成真正该露出的那一页。
  const sheetText = dir === 'next' ? pages[index] ?? '' : pages[index - 1] ?? '';
  const underText = dir === 'next' ? pages[index + 1] ?? '' : pages[index] ?? '';
  const slideUnder = dir === 'next' ? pages[index + 1] ?? '' : pages[index - 1] ?? '';

  if (mode === 'slide') {
    return (
      <View
        style={[styles.container, { width: areaW, height: areaH, backgroundColor: theme.bg }]}
        {...responder.panHandlers}
      >
        <View style={[styles.layer, { zIndex: 1 }]} pointerEvents="none">
          {pageBody(slideUnder)}
        </View>
        <Animated.View
          style={[styles.layer, { zIndex: 2, opacity: anim.curOpacity }, anim.slide]}
          pointerEvents="none"
        >
          {pageBody(pages[index] ?? '')}
        </Animated.View>
      </View>
    );
  }

  const isNext = dir === 'next';
  const flatW = isNext ? anim.flatNext : anim.flatPrev;
  const backW = isNext ? anim.backWNext : anim.backWPrev;
  const backX = isNext ? anim.backXNext : anim.backXPrev;
  const cu = isNext ? anim.cuNext : anim.cuPrev;
  const crease = isNext ? anim.creaseNext : anim.creasePrev;

  return (
    <View
      style={[styles.container, { width: areaW, height: areaH, backgroundColor: theme.bg }]}
      {...responder.panHandlers}
    >
      {/* 底层：还没翻到的那一页 */}
      <View style={[styles.layer, { zIndex: 1 }]} pointerEvents="none">
        {pageBody(underText)}
      </View>

      {/* 平铺段：纸面 [0, c]。容器宽度就是折痕位置，右侧自然被裁掉 */}
      <Animated.View
        style={[styles.flat, { zIndex: 2, width: flatW, height: areaH }]}
        pointerEvents="none"
      >
        <View style={{ width: areaW, height: areaH, position: 'absolute', left: 0, top: 0 }}>
          {pageBody(sheetText)}
        </View>
      </Animated.View>

      {/* 纸背：绕过圆柱顶之后平铺回来的那一段，压住平铺段的右端 */}
      <Animated.View
        style={[
          styles.back,
          {
            zIndex: 3,
            width: backW,
            height: areaH,
            backgroundColor: theme.barBg,
            transform: [{ translateX: backX }],
          },
        ]}
        pointerEvents="none"
      >
        {/* 折痕投影：纸和下面那页之间的暗部，翻得越深越明显 */}
        <Animated.View
          style={[styles.crease, { height: areaH, opacity: crease }]}
          pointerEvents="none"
        />
      </Animated.View>

      {/* 卷曲段：整段跟着折痕平移，内部 12 片全部静态 */}
      <Animated.View
        style={[
          styles.curlLayer,
          { zIndex: 4, width: AW, height: areaH, transform: [{ translateX: cu }] },
        ]}
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
                {pageBody(sheetText)}
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
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative', overflow: 'hidden' },
  layer: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  page: {
    // 必须和 pageTextHeight 用同一套常量，否则分页算出来的行数和实际渲染对不上，
    // 就会出现「最后一行被裁半个字」和「底部空一块」
    paddingHorizontal: PAGE_PAD_H,
    // 顶部要让出页眉那一行（章节名 / 书名），正文从页眉下面开始
    paddingTop: PAGE_PAD_TOP + PAGE_HEADER_H,
    paddingBottom: PAGE_PAD_BOTTOM + PAGE_FOOTER_H,
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
