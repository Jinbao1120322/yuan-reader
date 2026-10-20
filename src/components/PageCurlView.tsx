import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { ReaderTheme } from '../theme/theme';

const WIN_W = Dimensions.get('window').width;

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
  onTapCenter: () => void; // 打开菜单
}

// 仿真翻页容器：单页分页显示，拖拽/轻点翻页。
// simulate = 书脊卷页（rotateY + 阴影），slide = 横向滑动（无卷曲）。
export function PageCurlView(props: Props) {
  const {
    pages,
    index,
    onPageChange,
    canPrev,
    canNext,
    mode,
    theme,
    fontSize,
    lineHeight,
    areaW,
    areaH,
    onTapLeft,
    onTapRight,
    onTapCenter,
  } = props;

  const dragX = useSharedValue(0);
  const THRESH = areaW * 0.28;

  const textStyle = {
    color: theme.text,
    fontSize,
    lineHeight: fontSize * lineHeight,
  };

  const renderPage = (text: string, key: string) => (
    <View key={key} style={[styles.page, { width: areaW, height: areaH }]}>
      <Text style={[styles.pageText, textStyle]}>{text || ' '}</Text>
    </View>
  );

  const nextText = pages[index + 1] ?? '';
  const prevText = pages[index - 1] ?? '';

  // 底层目标页：位置固定，按拖拽方向显隐
  const nextLayerStyle = useAnimatedStyle(() => ({
    opacity: dragX.value < 0 ? 1 : 0,
  }));
  const prevLayerStyle = useAnimatedStyle(() => ({
    opacity: dragX.value > 0 ? 1 : 0,
  }));

  // 顶层当前页：随拖拽翻折 / 滑动
  const curStyle = useAnimatedStyle(() => {
    const x = dragX.value;
    if (mode === 'slide') {
      return { transform: [{ translateX: x }], opacity: 1 };
    }
    const goingNext = x < 0;
    const p = goingNext ? Math.min(-x / areaW, 1) : Math.min(x / areaW, 1);
    const angle = goingNext
      ? interpolate(p, [0, 1], [0, -160])
      : interpolate(p, [0, 1], [0, 160]);
    const tx = goingNext ? -areaW / 2 : areaW / 2;
    const opacity = p < 0.55 ? 1 : interpolate(p, [0.55, 1], [1, 0]);
    return {
      transform: [
        { perspective: 1200 },
        { translateX: tx },
        { rotateY: `${angle}deg` },
        { translateX: -tx },
      ],
      opacity,
    };
  });

  // 卷起区域的暗色阴影，增强翻页立体感
  const shadowStyle = useAnimatedStyle(() => {
    const x = dragX.value;
    const p = x < 0 ? Math.min(-x / areaW, 1) : Math.min(x / areaW, 1);
    return { opacity: Math.min(p * 0.55, 0.55) };
  });

  const finish = (dir: 1 | -1) => {
    const target = index + dir;
    // 翻到下一页：当前页应向左卷（dragX 走向 -areaW）；
    // 翻到上一页：当前页应向右卷（dragX 走向 +areaW）。
    // 注意 curStyle 里 goingNext 判定依据 dragX < 0，故此处取 -dir。
    dragX.value = withTiming(-dir * areaW, { duration: 240 }, () => {
      runOnJS(onPageChange)(target);
      dragX.value = 0;
    });
  };

  const pan = Gesture.Pan()
    .onStart(() => {
      dragX.value = 0;
    })
    .onUpdate((e) => {
      dragX.value = e.translationX;
    })
    .onEnd((e) => {
      const t = e.translationX;
      if (t < -THRESH) {
        if (canNext) finish(1);
        else {
          dragX.value = withSpring(0);
          if (t < -THRESH * 1.7) runOnJS(onTapRight)();
        }
      } else if (t > THRESH) {
        if (canPrev) finish(-1);
        else {
          dragX.value = withSpring(0);
          if (t > THRESH * 1.7) runOnJS(onTapLeft)();
        }
      } else {
        dragX.value = withSpring(0);
      }
    });

  const tap = Gesture.Tap().onEnd((e) => {
    const x = e.x;
    if (x < areaW * 0.33) {
      if (canPrev) runOnJS(onPageChange)(index - 1);
      else runOnJS(onTapLeft)();
    } else if (x > areaW * 0.67) {
      if (canNext) runOnJS(onPageChange)(index + 1);
      else runOnJS(onTapRight)();
    } else {
      runOnJS(onTapCenter)();
    }
  });

  const composed = Gesture.Exclusive(pan, tap);

  return (
    <GestureDetector gesture={composed}>
      <View style={[styles.container, { width: areaW, height: areaH }]}>
        <Animated.View style={[styles.layer, nextLayerStyle, { zIndex: 1 }]}>
          {renderPage(nextText, 'next')}
        </Animated.View>
        <Animated.View style={[styles.layer, prevLayerStyle, { zIndex: 1 }]}>
          {renderPage(prevText, 'prev')}
        </Animated.View>
        <Animated.View style={[styles.layer, curStyle, { zIndex: 2 }]}>
          {renderPage(pages[index] ?? '', 'cur')}
          {mode === 'simulate' && (
            <Animated.View style={[styles.shadow, shadowStyle]} pointerEvents="none" />
          )}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative', overflow: 'hidden' },
  layer: { position: 'absolute', left: 0, top: 0 },
  page: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    backgroundColor: 'transparent',
  },
  pageText: { textAlign: 'left' },
  shadow: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
  },
});
