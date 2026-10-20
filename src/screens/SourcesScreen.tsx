import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, ScrollView, TouchableOpacity, StyleSheet, Alert, TextInput, Modal, ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, InputAccessoryView, Switch } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useStore } from '../store/useStore';
import { BookSource } from '../engine/types';
import { SAMPLE_SOURCE } from '../sources/sampleSource';
import { APP } from '../theme/theme';
import { TopBar } from '../components/TopBar';
import { readLocalText } from '../utils/localBook';
import { parseSourceText } from '../utils/parseSources';
import { filterSources, SourceFilter } from '../utils/sourceFilter';
import {
  CheckItem,
  CHECK_KEYWORD,
  emptyTally,
  REMOVABLE,
  runCheck,
  searchable,
  Tally,
  VERDICT_LABEL,
} from '../utils/checkSources';
import { Text } from '../components/AppText';

// iOS 键盘上方那条「完成」工具条的 id
const KEYBOARD_DONE_ID = 'sources-import-done';

type FilterKey = 'all' | 'on' | 'off';

export function SourcesScreen() {
  const sources = useStore((s) => s.sources);
  const toggleSource = useStore((s) => s.toggleSource);
  const removeSource = useStore((s) => s.removeSource);
  const importSources = useStore((s) => s.importSources);
  const addSource = useStore((s) => s.addSource);
  const setAllSourcesEnabled = useStore((s) => s.setAllSourcesEnabled);

  const [modal, setModal] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');

  // 一键清空：删光所有书源。给个撤销入口，清空是重来用的，误点了不至于要重新导一遍。
  const clearAll = () => {
    if (!sources.length) return;
    Alert.alert(
      '清空所有书源',
      `将删除全部 ${sources.length} 个书源。\n\n书源清空后，书架里的书就读不了了（换源也搜不到），确认要清空？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: `删除全部 ${sources.length} 个`,
          style: 'destructive',
          onPress: () => {
            const snapshot = sources.slice();
            useStore.getState().removeSources(sources.map((x) => x._id!));
            setQuery('');
            setRemoved([]);
            setPending(null);
            Alert.alert('已清空', `已删除 ${snapshot.length} 个书源。`, [
              { text: '知道了' },
              {
                text: '撤销删除',
                onPress: () => {
                  importSources(snapshot);
                },
              },
            ]);
          },
        },
      ]
    );
  };

  // —— 书源检测 ——
  const [checking, setChecking] = useState(false);
  const [tally, setTally] = useState<Tally | null>(null);
  const [report, setReport] = useState<CheckItem[] | null>(null);
  const [reportStopped, setReportStopped] = useState(false);
  // 被自动删掉的书源原对象，用来「撤销删除」
  const [removed, setRemoved] = useState<BookSource[]>([]);
  // 中途停止时待确认的删除（停止不自动删，等用户看完再决定）
  const [pending, setPending] = useState<{ ids: string[]; objs: BookSource[] } | null>(
    null
  );
  const cancelRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(
    () => () => {
      // 离开页面：停掉还在跑的检测。已经判定为无效的源在开始时就会照常删除，
      // 删除动作不依赖组件存活，所以这里只是省电、不丢结果。
      aliveRef.current = false;
      cancelRef.current = true;
    },
    []
  );

  const enabledCount = useMemo(
    () => sources.reduce((n, s) => (s._enabled ? n + 1 : n), 0),
    [sources]
  );
  const offCount = sources.length - enabledCount;

  const shown = useMemo(
    () => filterSources(sources, filter, query),
    [sources, filter, query]
  );

  const enableAll = () => {
    if (sources.length === 0 || enabledCount === sources.length) return;
    Alert.alert(
      '启用全部书源',
      `将启用 ${sources.length} 个书源。\n\n启用越多，搜索时要发的网络请求就越多，会明显变慢。建议只留十几个常用的。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '仍然全部启用', onPress: () => setAllSourcesEnabled(true) },
      ]
    );
  };

  const disableAll = () => {
    if (enabledCount === 0) return;
    Alert.alert(
      '停用全部书源',
      `将停用当前 ${enabledCount} 个书源。停用只是不参与搜索/换源，书源本身不会删除，随时可以再启用。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '确定停用', style: 'destructive', onPress: () => setAllSourcesEnabled(false) },
      ]
    );
  };

  // —— 书源检测 ——
  //
  // 判定「有没有用」的唯一标准是能不能真的搜到书，不是站点活着。
  // 搜不到 / 站点报错 / 域名连不上 / 没有搜索规则 → 自动删除；只有超时的不删。
  // 完整跑完才自动删；中途停止不删，把结果列出来让用户自己决定。
  const startCheck = () => {
    if (checking) return;
    const list = shown;
    if (!list.length) {
      Alert.alert('没有可检测的书源', '当前这一栏是空的');
      return;
    }
    // 没有搜索规则的源也要真的进检测队列 —— 它们会判成 skip 并被删除。
    // 之前是把它们提前滤掉，那样根本进不了结果集，也就删不到。
    const noRule = list.length - list.filter(searchable).length;

    Alert.alert(
      '检测书源',
      `将用关键词「${CHECK_KEYWORD}」逐个检测当前列表里的 ${list.length} 个书源。\n\n` +
        '· 搜不到书、站点报错、域名连不上 → 删除\n' +
        '· 没有搜索规则（搜不了书）→ 删除' +
        (noRule ? `，本次有 ${noRule} 个` : '') +
        '\n' +
        '· 6 秒没响应（超时）→ 删除\n' +
        (noRule === list.length
          ? '\n⚠️ 当前列表里的书源全都没有搜索规则，检测后会被全部删除。\n'
          : '') +
        `\n预计 ${Math.max(5, Math.ceil((list.length / 12) * 2.5))} 秒左右，随时可停止。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '只测搜索', onPress: () => runDetection(list, false) },
        {
          text: '连目录一起测（准，但慢很多）',
          onPress: () => runDetection(list, true),
        },
      ]
    );
  };

  const runDetection = async (list: BookSource[], deep: boolean) => {
    cancelRef.current = false;
    setChecking(true);
    setReport(null);
    setRemoved([]);
    setPending(null);
    setTally(emptyTally(list.length));

    // 存原对象而不是 id：撤销时要把 _enabled 等状态原样放回去
    const snapshot = list.slice();
    let results: CheckItem[] = [];
    try {
      results = await runCheck(list, {
        keyword: CHECK_KEYWORD,
        deep,
        isCancelled: () => cancelRef.current,
        onProgress: (t) => {
          if (aliveRef.current) setTally(t);
        },
      });
    } catch (e: any) {
      if (aliveRef.current) setChecking(false);
      Alert.alert('检测中断', e?.message || String(e));
      return;
    }

    const dead = results.filter((r) => REMOVABLE.includes(r.verdict));
    const deadSet = new Set(dead.map((r) => r.id));
    const objs = snapshot.filter((s) => deadSet.has(s._id!));
    const stopped = cancelRef.current;

    // 走 store 直接删，不依赖组件是否还挂载
    if (!stopped && dead.length) useStore.getState().removeSources(dead.map((r) => r.id));

    if (!aliveRef.current) return;
    setChecking(false);
    setReportStopped(stopped);
    if (stopped) {
      // 中途停止：不删，等用户看完再决定
      setPending(dead.length ? { ids: dead.map((r) => r.id), objs } : null);
    } else {
      setRemoved(objs);
      setPending(null);
    }
    setReport(results);
  };

  const stopCheck = () => {
    cancelRef.current = true;
  };

  // 停止后手动确认删除
  const deletePending = () => {
    if (!pending) return;
    useStore.getState().removeSources(pending.ids);
    setRemoved(pending.objs);
    setPending(null);
  };

  const undoRemove = () => {
    if (!removed.length) return;
    // importSources 内部按 bookSourceUrl 去重，且保留 _enabled，原样放回
    importSources(removed);
    setRemoved([]);
  };

  // 统一走 parseSourceText：标准 JSON、二次转义、每行一条、夹着杂字都能认
  const doImport = async (raw: string, fromUrl = false) => {
    setLoading(true);
    try {
      let content = raw.trim();
      if (fromUrl) {
        if (!/^https?:\/\//.test(content)) throw new Error('请输入合法的 http(s) 链接');
        const resp = await fetch(content);
        if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
        content = await resp.text();
      }
      const { list, mode } = parseSourceText(content);
      const invalid = list.filter((s) => !s.bookSourceUrl).length;
      const added = importSources(list);
      Keyboard.dismiss();
      setModal(false);
      setText('');
      Alert.alert(
        '导入完成',
        `识别为 ${mode}\n新增 ${added} 个书源（已存在的自动跳过）` +
          (invalid ? `\n其中 ${invalid} 个缺书源地址，已忽略` : '')
      );
    } catch (e: any) {
      Alert.alert('解析失败', e?.message || '不是合法的 JSON 书源');
    } finally {
      setLoading(false);
    }
  };

  const addSample = () => {
    addSource(SAMPLE_SOURCE);
    Alert.alert('已添加', '示例书源已加入，可在搜索页试用');
  };

  const closeModal = () => {
    Keyboard.dismiss();
    setModal(false);
  };

  // 从「文件」里挑 .json 书源文件导入。
  // 用 readLocalText（内部 utf-8 优先、失败退回 gbk）读，社区书源里 GBK 编码的不少。
  const pickFromFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', 'public.data'],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (res.canceled || !res.assets?.length) return;

      setLoading(true);
      let total = 0;
      const fails: string[] = [];
      const modes: string[] = [];
      for (const asset of res.assets) {
        try {
          const raw = await readLocalText(asset.uri);
          const { list, mode } = parseSourceText(raw);
          modes.push(mode);
          total += importSources(list);
        } catch (e: any) {
          fails.push(`${asset.name}：${e?.message || '不是合法的 JSON'}`);
        }
      }
      setLoading(false);

      if (total > 0) {
        Keyboard.dismiss();
        setModal(false);
      }
      Alert.alert(
        total > 0 ? '导入完成' : '没能导入',
        `新增 ${total} 个书源（已存在的自动跳过）` +
          (modes.length ? `\n识别方式：${Array.from(new Set(modes)).join('、')}` : '') +
          (fails.length ? `\n\n失败 ${fails.length} 个：\n${fails.join('\n')}` : '')
      );
    } catch (e: any) {
      setLoading(false);
      Alert.alert('选择文件失败', e?.message || String(e));
    }
  };

  const renderItem = ({ item }: { item: BookSource }) => (
    <View style={styles.item}>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {item.bookSourceName}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {item.bookSourceGroup || '未分组'} · {item.bookSourceUrl}
        </Text>
      </View>
      <Switch
        value={!!item._enabled}
        onValueChange={() => toggleSource(item._id!)}
        trackColor={{ false: APP.card2, true: APP.accent }}
        thumbColor="#fff"
        ios_backgroundColor={APP.card2}
        style={styles.switch}
      />
      <TouchableOpacity
        style={styles.del}
        onPress={() =>
          Alert.alert('删除书源', `删除《${item.bookSourceName}》？`, [
            { text: '取消', style: 'cancel' },
            { text: '删除', style: 'destructive', onPress: () => removeSource(item._id!) },
          ])
        }
      >
        <Text style={styles.delText}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* 顶部栏负责吃 top inset，否则内容会画到状态栏/灵动岛下面 */}
      <TopBar title="书源" />

      <View style={styles.head}>
        <Text style={styles.stat} numberOfLines={1}>
          {query.trim() ? `找到 ${shown.length} 个` : `${sources.length} 个 · 启用 ${enabledCount}`}
        </Text>
        <View style={styles.headBtns}>
          <TouchableOpacity
            style={[styles.miniBtn, checking && styles.miniDim]}
            onPress={startCheck}
            disabled={checking}
          >
            <Text style={styles.miniText}>{checking ? '检测中' : '检测'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.miniBtn} onPress={enableAll}>
            <Text style={styles.miniText}>全开</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.miniBtn} onPress={disableAll}>
            <Text style={styles.miniText}>全关</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.miniPrimary} onPress={() => setModal(true)}>
            <Text style={styles.miniPrimaryText}>导入</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.miniDanger} onPress={clearAll}>
            <Text style={styles.miniDangerText}>清空</Text>
          </TouchableOpacity>
        </View>
      </View>

      {checking && tally && (
        <View style={styles.progWrap}>
          <View style={styles.progTrack}>
            <View
              style={[
                styles.progFill,
                { width: `${Math.round((tally.done / Math.max(1, tally.total)) * 100)}%` },
              ]}
            />
          </View>
          <View style={styles.progRow}>
            <Text style={styles.progText} numberOfLines={1}>
              已检测 {tally.done}/{tally.total} · 有效 {tally.ok} · 无效 {tally.dead}
              {tally.timeout ? ` · 超时 ${tally.timeout}` : ''}
            </Text>
            <TouchableOpacity onPress={stopCheck} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.progStop}>停止</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="搜索书源：名称 / 网址 / 分组"
          placeholderTextColor={APP.sub}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          clearButtonMode="never"
          returnKeyType="search"
        />
        {query ? (
          <TouchableOpacity
            style={styles.searchClear}
            onPress={() => {
              setQuery('');
              Keyboard.dismiss();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.searchClearText}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.filterRow}>
        {(
          [
            ['all', `全部 ${sources.length}`],
            ['on', `已启用 ${enabledCount}`],
            ['off', `已停用 ${offCount}`],
          ] as [FilterKey, string][]
        ).map(([k, label]) => (
          <TouchableOpacity
            key={k}
            style={[styles.chip, filter === k && styles.chipOn]}
            onPress={() => setFilter(k)}
          >
            <Text style={[styles.chipText, filter === k && styles.chipTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.note}>
        开关打开（已启用）的书源才参与搜索和换源。「检测」会把当前列表试一遍：
        搜不到书、站点报错、连不上、超时、没有搜索规则的书源都会删除（可撤销）。
      </Text>

      <FlatList
        data={shown}
        keyExtractor={(i) => i._id!}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        windowSize={8}
        removeClippedSubviews
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {query.trim()
                ? `没有匹配「${query.trim()}」的书源`
                : sources.length === 0
                ? '还没有书源'
                : '这一栏是空的'}
            </Text>
            <Text style={styles.emptySub}>
              {query.trim()
                ? '换个关键词试试，或清空搜索框'
                : sources.length === 0
                ? '点右上「导入」可以粘贴 JSON、粘链接，或从「文件」里选 .json'
                : '切换到「全部」看看其它书源'}
            </Text>
            {sources.length === 0 && (
              <TouchableOpacity style={styles.sampleBtn} onPress={addSample}>
                <Text style={styles.sampleText}>先加一个示例书源试试</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      <Modal visible={modal} transparent animationType="slide" onRequestClose={closeModal}>
        {/*
          键盘处理：
          - KeyboardAvoidingView 让面板整体抬到键盘上方，输入框不会被挡住
          - 点面板外的暗色区域收起键盘（Pressable 在面板下方，不挡输入）
          - iOS 额外给一条键盘上方的「完成」工具条，多点保险
        */}
        <KeyboardAvoidingView
          style={styles.kavWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.modalMask} onPress={Keyboard.dismiss} />

          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.modalTitle}>导入书源</Text>
              <TouchableOpacity
                onPress={closeModal}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.closeText}>关闭</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHint}>
              粘贴书源 JSON（单个或数组）、粘贴 .json 链接，或直接从「文件」里选
            </Text>
            <TextInput
              style={styles.input}
              placeholder="https://.../source.json  或  { ... }"
              placeholderTextColor={APP.sub}
              value={text}
              onChangeText={setText}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              inputAccessoryViewID={Platform.OS === 'ios' ? KEYBOARD_DONE_ID : undefined}
            />

            <View style={styles.quickRow}>
              <TouchableOpacity
                style={[styles.quickBtn, loading && styles.quickBtnDim]}
                onPress={pickFromFile}
                disabled={loading}
              >
                <Text style={styles.quickText}>📁 从文件导入</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickBtn} onPress={Keyboard.dismiss}>
                <Text style={styles.quickText}>⌨ 收起键盘</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalBtns}>
              <TouchableOpacity style={[styles.mbtn, styles.mcancel]} onPress={closeModal}>
                <Text style={styles.btnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mbtn, styles.mok]}
                onPress={() => doImport(text, /^https?:\/\//.test(text.trim()))}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.okText}>导入</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>

        {Platform.OS === 'ios' && (
          <InputAccessoryView nativeID={KEYBOARD_DONE_ID}>
            <View style={styles.accessory}>
              <TouchableOpacity onPress={Keyboard.dismiss}>
                <Text style={styles.accessoryText}>完成</Text>
              </TouchableOpacity>
            </View>
          </InputAccessoryView>
        )}
      </Modal>

      {/* 检测结果面板。比 Alert 好用：能列出被删掉的源，还能一键撤销 */}
      <Modal
        visible={!!report}
        transparent
        animationType="fade"
        onRequestClose={() => setReport(null)}
      >
        <View style={styles.repMask}>
          <View style={styles.repCard}>
            <Text style={styles.repTitle}>
              {reportStopped ? '检测已停止' : '检测完成'}
            </Text>

            {(() => {
              const all = report || [];
              const ok = all.filter((r) => r.verdict === 'ok').length;
              const dead = all.filter((r) => REMOVABLE.includes(r.verdict));
              const timeout = all.filter((r) => r.verdict === 'timeout').length;
              const skip = all.filter((r) => r.verdict === 'skip').length;
              return (
                <>
                  <Text style={styles.repSummary}>
                    共检测 {all.length} 个 · 有效 {ok} 个
                    {dead.length ? ` · 无效 ${dead.length} 个` : ''}
                    {timeout ? ` · 超时 ${timeout} 个` : ''}
                    {skip ? ` · 无搜索规则 ${skip} 个` : ''}
                  </Text>

                  {dead.length > 0 ? (
                    <>
                      <Text style={styles.repSub}>
                        {pending
                          ? `这 ${dead.length} 个书源搜不到书或站点不通，还没删除：`
                          : removed.length
                          ? `已删除这 ${removed.length} 个书源：`
                          : `这次没有删除书源，下面 ${dead.length} 个是判定为无效的：`}
                      </Text>
                      <ScrollView style={styles.repList} contentContainerStyle={{ paddingBottom: 4 }}>
                        {dead.slice(0, 300).map((r) => (
                          <View key={r.id} style={styles.repItem}>
                            <Text style={styles.repName} numberOfLines={1}>
                              {r.name}
                            </Text>
                            <Text style={styles.repMeta} numberOfLines={1}>
                              {VERDICT_LABEL[r.verdict]} · {r.host}
                            </Text>
                          </View>
                        ))}
                        {dead.length > 300 && (
                          <Text style={styles.repMore}>…还有 {dead.length - 300} 个</Text>
                        )}
                      </ScrollView>
                    </>
                  ) : (
                    <Text style={styles.repSub}>
                      {all.length
                        ? '没有发现失效的书源，一个都没删。'
                        : '没有检测到任何书源。'}
                    </Text>
                  )}

                  {timeout > 0 && (
                    <Text style={styles.repHint}>
                      其中 {timeout} 个是 6 秒没响应被判为超时。如果当时网络不好，可以撤销后重测一次。
                    </Text>
                  )}
                </>
              );
            })()}

            <View style={styles.repBtns}>
              {pending ? (
                <>
                  <TouchableOpacity
                    style={[styles.repBtn, styles.repGhost]}
                    onPress={() => {
                      setPending(null);
                      setReport(null);
                    }}
                  >
                    <Text style={styles.repGhostText}>保留全部</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.repBtn, styles.repDanger]}
                    onPress={deletePending}
                  >
                    <Text style={styles.repDangerText}>删除这 {pending.ids.length} 个</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {removed.length > 0 && (
                    <TouchableOpacity
                      style={[styles.repBtn, styles.repGhost]}
                      onPress={undoRemove}
                    >
                      <Text style={styles.repGhostText}>撤销删除</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.repBtn, styles.repPrimary]}
                    onPress={() => setReport(null)}
                  >
                    <Text style={styles.repPrimaryText}>完成</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: APP.bg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  stat: { flex: 1, color: APP.text, fontSize: 14 },
  headBtns: { flexDirection: 'row', alignItems: 'center' },
  miniBtn: {
    backgroundColor: APP.card,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 8,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: APP.border,
  },
  miniText: { color: APP.text, fontSize: 13 },
  miniPrimary: {
    backgroundColor: APP.accent,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    marginLeft: 6,
  },
  miniPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  miniDanger: {
    backgroundColor: APP.card,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 8,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: APP.danger,
  },
  miniDangerText: { color: APP.danger, fontSize: 13, fontWeight: '600' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 10,
    backgroundColor: APP.card,
    borderWidth: 1,
    borderColor: APP.border,
  },
  searchInput: { flex: 1, color: APP.text, fontSize: 14, padding: 0 },
  searchClear: { paddingLeft: 8 },
  searchClearText: { color: APP.sub, fontSize: 15 },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: APP.card,
    marginRight: 8,
    borderWidth: 1,
    borderColor: APP.border,
  },
  chipOn: { backgroundColor: APP.accent, borderColor: APP.accent },
  chipText: { color: APP.sub, fontSize: 12 },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  note: {
    color: APP.sub,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderColor: APP.border,
  },
  // —— 检测进度 ——
  miniDim: { opacity: 0.55 },
  progWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  progTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: APP.card2,
    overflow: 'hidden',
  },
  progFill: { height: 4, borderRadius: 2, backgroundColor: APP.accent },
  progRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 7,
  },
  progText: { flex: 1, color: APP.sub, fontSize: 12 },
  progStop: { color: APP.danger, fontSize: 13, fontWeight: '600', marginLeft: 10 },
  // —— 检测结果面板 ——
  repMask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  repCard: {
    width: '100%',
    maxHeight: '82%',
    backgroundColor: APP.card,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: APP.border,
  },
  repTitle: { color: APP.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  repSummary: { color: APP.text, fontSize: 14, lineHeight: 20 },
  repSub: { color: APP.sub, fontSize: 13, lineHeight: 19, marginTop: 10 },
  repList: {
    marginTop: 8,
    maxHeight: 260,
    borderTopWidth: 1,
    borderColor: APP.border,
  },
  repItem: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: APP.border,
  },
  repName: { color: APP.text, fontSize: 14 },
  repMeta: { color: APP.sub, fontSize: 11, marginTop: 3 },
  repMore: { color: APP.sub, fontSize: 12, paddingVertical: 8 },
  repHint: {
    color: APP.sub,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
    backgroundColor: APP.card2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  repBtns: { flexDirection: 'row', marginTop: 14 },
  repBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  repGhost: { backgroundColor: APP.card2, borderWidth: 1, borderColor: APP.border },
  repGhostText: { color: APP.text, fontSize: 15, fontWeight: '600' },
  repPrimary: { backgroundColor: APP.accent },
  repPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  repDanger: { backgroundColor: APP.danger },
  repDangerText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnText: { color: APP.text, fontSize: 14 },
  list: { padding: 16 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: APP.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: APP.border,
  },
  info: { flex: 1 },
  name: { color: APP.text, fontSize: 16, fontWeight: '700' },
  sub: { color: APP.sub, fontSize: 12, marginTop: 4 },
  switch: { marginLeft: 8, transform: [{ scaleX: 0.82 }, { scaleY: 0.82 }] },
  del: { padding: 6, marginLeft: 4 },
  delText: { color: APP.danger, fontSize: 16 },
  empty: { alignItems: 'center', marginTop: 70 },
  emptyText: { color: APP.text, fontSize: 17 },
  emptySub: {
    color: APP.sub,
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 30,
    lineHeight: 19,
  },
  sampleBtn: {
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 9,
    backgroundColor: APP.card,
    borderWidth: 1,
    borderColor: APP.border,
  },
  sampleText: { color: APP.accent, fontSize: 14, fontWeight: '600' },
  kavWrap: { flex: 1, justifyContent: 'flex-end' },
  // 面板外的暗色区域：铺满整屏，点一下收键盘
  modalMask: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: APP.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 26,
    borderTopWidth: 1,
    borderColor: APP.border,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  closeText: { color: APP.sub, fontSize: 15 },
  modalTitle: { color: APP.text, fontSize: 18, fontWeight: '700' },
  modalHint: { color: APP.sub, fontSize: 13, marginBottom: 12, lineHeight: 19 },
  input: {
    backgroundColor: APP.bg,
    color: APP.text,
    borderRadius: 10,
    padding: 12,
    minHeight: 92,
    maxHeight: 150,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: APP.border,
    fontSize: 13,
  },
  quickRow: { flexDirection: 'row', marginTop: 12 },
  quickBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 9,
    alignItems: 'center',
    backgroundColor: APP.card2,
    borderWidth: 1,
    borderColor: APP.border,
    marginHorizontal: 5,
  },
  quickBtnDim: { opacity: 0.5 },
  quickText: { color: APP.text, fontSize: 14 },
  accessory: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: APP.card2,
    borderTopWidth: 1,
    borderColor: APP.border,
  },
  accessoryText: { color: APP.accent, fontSize: 16, fontWeight: '700' },
  modalBtns: { flexDirection: 'row', marginTop: 14 },
  mbtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginHorizontal: 6,
  },
  mcancel: { backgroundColor: APP.card2 },
  mok: { backgroundColor: APP.accent },
  okText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
