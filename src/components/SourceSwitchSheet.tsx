import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useStore } from '../store/useStore';
import { SearchBook } from '../engine/types';
import { findAltSources } from '../utils/bookMatch';
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
 */
export function SourceSwitchSheet(props: Props) {
  const { visible, name, author, currentSourceId, presets, onClose, onPick } = props;
  const sources = useStore((s) => s.sources);

  const [phase, setPhase] = useState<Phase>('idle');
  const [list, setList] = useState<SearchBook[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const cancelRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      cancelRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    cancelRef.current = false;
    setDone(0);
    setTotal(0);

    // 有现成的（搜索结果里同名的其他源）就直接用，不再发请求
    if (presets && presets.length) {
      setList(presets);
      setPhase('done');
      return;
    }

    setList([]);
    setPhase('searching');
    const run = async () => {
      const found = await findAltSources(name, author || '', sources, {
        isCancelled: () => cancelRef.current,
        onProgress: (d, t) => {
          if (!aliveRef.current) return;
          setDone(d);
          setTotal(t);
        },
      });
      if (!aliveRef.current) return;
      setList(found);
      setPhase('done');
    };
    run().catch(() => {
      if (aliveRef.current) setPhase('done');
    });
    // sources 变化不重搜，只在打开时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, name, author]);

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
                  ? `正在 ${total || '所有'} 个书源里找同名书… ${done}/${total || '?'}`
                  : `找到 ${others.length} 个其他来源`}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.close}>关闭</Text>
            </TouchableOpacity>
          </View>

          {phase === 'searching' && (
            <View style={styles.loading}>
              <ActivityIndicator color={APP.accent} />
              <Text style={styles.loadingText}>搜索是逐个书源跑的，源越多越慢，稍等</Text>
            </View>
          )}

          {phase === 'done' && (
            <ScrollView style={styles.listWrap} contentContainerStyle={{ paddingBottom: 8 }}>
              {list.length === 0 && (
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
          )}
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
    paddingBottom: 26,
    maxHeight: '72%',
    borderTopWidth: 1,
    borderColor: APP.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  title: { color: APP.text, fontSize: 17, fontWeight: '700' },
  sub: { color: APP.sub, fontSize: 12, marginTop: 4 },
  close: { color: APP.sub, fontSize: 15 },
  loading: { alignItems: 'center', paddingVertical: 28 },
  loadingText: { color: APP.sub, fontSize: 12, marginTop: 10 },
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
});
