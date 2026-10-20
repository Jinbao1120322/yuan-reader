import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  InputAccessoryView,
  Switch,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useStore } from '../store/useStore';
import { BookSource } from '../engine/types';
import { SAMPLE_SOURCE } from '../sources/sampleSource';
import { APP } from '../theme/theme';
import { TopBar } from '../components/TopBar';
import { readLocalText } from '../utils/localBook';
import { parseSourceText } from '../utils/parseSources';

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

  const enabledCount = useMemo(
    () => sources.reduce((n, s) => (s._enabled ? n + 1 : n), 0),
    [sources]
  );
  const offCount = sources.length - enabledCount;

  const shown = useMemo(() => {
    if (filter === 'on') return sources.filter((s) => s._enabled);
    if (filter === 'off') return sources.filter((s) => !s._enabled);
    return sources;
  }, [sources, filter]);

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
          共 {sources.length} 个 · 已启用 {enabledCount} 个
        </Text>
        <View style={styles.headBtns}>
          <TouchableOpacity style={styles.miniBtn} onPress={enableAll}>
            <Text style={styles.miniText}>全开</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.miniBtn} onPress={disableAll}>
            <Text style={styles.miniText}>全关</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.miniPrimary} onPress={() => setModal(true)}>
            <Text style={styles.miniPrimaryText}>导入</Text>
          </TouchableOpacity>
        </View>
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
        开关打开（已启用）的书源才会参与搜索和换源；关掉只是暂时不用，不会删除。
      </Text>

      <FlatList
        data={shown}
        keyExtractor={(i) => i._id!}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        windowSize={8}
        removeClippedSubviews
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {sources.length === 0 ? '还没有书源' : '这一栏是空的'}
            </Text>
            <Text style={styles.emptySub}>
              {sources.length === 0
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
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 8,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: APP.border,
  },
  miniText: { color: APP.text, fontSize: 13 },
  miniPrimary: {
    backgroundColor: APP.accent,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    marginLeft: 6,
  },
  miniPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
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
