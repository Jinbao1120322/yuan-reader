import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useStore } from '../store/useStore';
import { SearchBook } from '../engine/types';
import { clearAltCache, findAltSources, getCachedAltSources } from '../utils/bookMatch';
import { APP } from '../theme/theme';
import { Text } from './AppText';

interface Props {
  visible: boolean;
  name: string;
  author?: string;
  /** 当前正在用的书源，列表里会标出来并禁止重复点 */
  currentSourceId?: string;
  /** 已经知道的其他来源（搜索结果聚合带来的），有的话就不用再搜一遍 */
  presets?: SearchBook[];
  onClose: () => void;
  onPick: (b: SearchBook) => void;
}

type Phase = 'idle' | 'searching' | 'done';

/**
 * 换源面板。两种入口：
 *   - 从搜索结果进详情：presets 里已经有各源的条目，秒开
 *   - 从书架/阅读器换源：没有现成的，现场在所有已启用源里搜同名书
 *
 * 三条体验规则（用户提的）：
 *   1. 边搜边显示 —— 搜到一个源就追加一行，不等全部跑完
 *   2. 结果按「书名+作者」缓存 5 分钟，反复打开不重复拉取
 *   3. 需要最新结果时点「重新搜索」
 */
export function SourceSwitchSheet(props: Props) {
  const { visible, name, author, currentSourceId, presets, onClose, onPick } = props;
  const sources = useStore((s) => s.sources);

  const [phase, setPhase] = useState<Phase>('idle');
  const [list, setList] = useState<SearchBook[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [fromCache, setFromCache] = useState(false);
  const cancelRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      cancelRef.current = true;
    };
  }, []);

  const runSearch = (force: boolean) => {
    cancelRef.current = false;
    setDone(0);
    setTotal(0);

    // 有现成的（搜索结果里同名的其他源）直接用
    if (presets && presets.length) {
      setList(presets);
      setPhase('done');
      setFromCache(false);
      return;
    }
    // 之前搜过就直接拿缓存，不重新拉
    if (!force) {
      const cached = getCachedAltSources(name, author);
      if (cached) {
        setList(cached);
        setPhase('done');
        setFromCache(true);
        return;
      }
    }

    setList([]);
    setPhase('searching');
    setFromCache(false);

    findAltSources(name, author || '', sources, {
      isCancelled: () => cancelRef.current,
      onProgress: (d, t) => {
        if (!aliveRef.current) return;
        setDone(d);
        setTotal(t);
      },
      // 每搜到一个就上屏，不等全部跑完
      onFound: (b) => {
        if (!aliveRef.current) return;
        setList((prev) =>
          prev.some((x) => x.sourceId === b.sourceId) ? prev : [...prev, b]
        );
      },
    })
      .then((found) => {
        if (!aliveRef.current) return;
        setList(found);
        setPhase('done');
      })
      .catch(() => {
        if (aliveRef.current) setPhase('done');
      });
  };

  useEffect(() => {
    if (!visible) return;
    runSearch(false);
    // 只在打开 / 换书时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, name, author]);

  const rescan = () => {
    clearAltCache(name, author);
    runSearch(true);
  };

  const others = list.filter((b) => b.sourceId !== currentSourceId);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.mask} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                换源 · {name}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                {phase === 'searching'
                  ? `搜索中 ${done}/${total || '?'} · 已找到 ${others.length} 个`
                  : fromCache
                  ? `已找到 ${others.length} 个来源（缓存结果）`
                  : `找到 ${others.length} 个其他来源`}
              </Text>
            </View>
            {phase === 'searching' ? (
              <ActivityIndicator color={APP.accent} size="small" />
            ) : (
              <TouchableOpacity
                onPress={rescan}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.rescan}>重新搜索</Text>
              </TouchableOpacity>
            )}
          </View>

          <ScrollView style={styles.listWrap} contentContainerStyle={{ paddingBottom: 8 }}>
            {/* 搜索中就把已经找到的列出来 */}
            {phase === 'searching' && list.length === 0 && (
              <View style={styles.loading}>
                <Text style={styles.loadingText}>正在逐个书源查找同名书…</Text>
              </View>
            )}
            {phase === 'done' && list.length === 0 && (
              <Text style={styles.empty}>没有在别的书源里找到这本书</Text>
            )}
            {list.map((b) => {
              const cur = b.sourceId === currentSourceId;
              return (
                <TouchableOpacity
                  key={b.sourceId + '|' + b.bookUrl}
                  style={[styles.row, cur && styles.rowCur]}
                  onPress={() => {
                    if (cur) return;
                    onPick(b);
                  }}
                  disabled={cur}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.srcName} numberOfLines={1}>
                      {b.sourceName}
                      {cur ? '（当前）' : ''}
                    </Text>
                    <Text style={styles.srcMeta} numberOfLines={1}>
                      {b.author || '未知作者'}
                      {b.lastChapter ? ` · ${b.lastChapter}` : ''}
                    </Text>
                  </View>
                  {!cur && <Text style={styles.go}>切换</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeText}>关闭</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  mask: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: APP.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 10,
    maxHeight: '72%',
    borderTopWidth: 1,
    borderColor: APP.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  title: { color: APP.text, fontSize: 17, fontWeight: '700' },
  sub: { color: APP.sub, fontSize: 12, marginTop: 4 },
  rescan: { color: APP.accent, fontSize: 13, fontWeight: '700', marginLeft: 12 },
  loading: { alignItems: 'center', paddingVertical: 22 },
  loadingText: { color: APP.sub, fontSize: 12 },
  listWrap: { maxHeight: 380 },
  empty: { color: APP.sub, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: APP.border,
  },
  rowCur: { opacity: 0.5 },
  srcName: { color: APP.text, fontSize: 15, fontWeight: '600' },
  srcMeta: { color: APP.sub, fontSize: 12, marginTop: 3 },
  go: { color: APP.accent, fontSize: 14, fontWeight: '700', marginLeft: 12 },
  closeBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  closeText: { color: APP.sub, fontSize: 15 },
});
