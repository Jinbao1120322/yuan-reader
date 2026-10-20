import React, { useState } from 'react';
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
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useStore } from '../store/useStore';
import { BookSource } from '../engine/types';
import { SAMPLE_SOURCE } from '../sources/sampleSource';
import { APP } from '../theme/theme';
import { TopBar } from '../components/TopBar';
import { readLocalText } from '../utils/localBook';

// iOS 键盘上方那条「完成」工具条的 id
const KEYBOARD_DONE_ID = 'sources-import-done';

export function SourcesScreen() {
  const sources = useStore((s) => s.sources);
  const toggleSource = useStore((s) => s.toggleSource);
  const removeSource = useStore((s) => s.removeSource);
  const importSources = useStore((s) => s.importSources);
  const addSource = useStore((s) => s.addSource);

  const [modal, setModal] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const enabledCount = sources.filter((s) => s._enabled).length;

  const doImport = async (raw: string, fromUrl = false) => {
    setLoading(true);
    try {
      let content = raw.trim();
      if (fromUrl) {
        if (!/^https?:\/\//.test(content)) throw new Error('请输入合法的 http(s) 链接');
        const resp = await fetch(content);
        content = await resp.text();
      }
      const parsed = JSON.parse(content);
      const list: BookSource[] = Array.isArray(parsed) ? parsed : [parsed];
      const added = importSources(list);
      Alert.alert('导入完成', `新增 ${added} 个书源（已存在的自动跳过）`);
      Keyboard.dismiss();
      setModal(false);
      setText('');
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
        type: ['application/json', 'text/plain'],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (res.canceled || !res.assets?.length) return;

      setLoading(true);
      let total = 0;
      const fails: string[] = [];
      for (const asset of res.assets) {
        try {
          const raw = await readLocalText(asset.uri);
          const parsed = JSON.parse(raw);
          const list: BookSource[] = Array.isArray(parsed) ? parsed : [parsed];
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
      <TouchableOpacity
        style={[styles.toggle, item._enabled ? styles.on : styles.off]}
        onPress={() => toggleSource(item._id!)}
      >
        <Text style={styles.toggleText}>{item._enabled ? '启用' : '停用'}</Text>
      </TouchableOpacity>
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
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          共 {sources.length} 个 · 启用 {enabledCount} 个
        </Text>
        <View style={styles.btns}>
          <TouchableOpacity style={styles.btn} onPress={() => setModal(true)}>
            <Text style={styles.btnText}>导入</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={addSample}>
            <Text style={styles.btnText}>示例源</Text>
          </TouchableOpacity>
        </View>
      </View>
      <FlatList
        data={sources}
        keyExtractor={(i) => i._id!}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>还没有书源</Text>
            <Text style={styles.emptySub}>
              点「导入」可以粘贴 JSON、粘链接，或从「文件」里选 .json
            </Text>
          </View>
        }
      />

      <Modal
        visible={modal}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
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
              <TouchableOpacity onPress={closeModal} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
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
              <TouchableOpacity
                style={[styles.mbtn, styles.mcancel]}
                onPress={closeModal}
              >
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
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: APP.border,
  },
  summaryText: { color: APP.text, fontSize: 14 },
  btns: { flexDirection: 'row' },
  btn: {
    backgroundColor: APP.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: APP.border,
  },
  btnText: { color: APP.text, fontSize: 14 },
  list: { padding: 16 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: APP.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: APP.border,
  },
  info: { flex: 1 },
  name: { color: APP.text, fontSize: 16, fontWeight: '700' },
  sub: { color: APP.sub, fontSize: 12, marginTop: 4 },
  toggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8,
  },
  on: { backgroundColor: APP.accent },
  off: { backgroundColor: APP.card2 },
  toggleText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  del: { padding: 6 },
  delText: { color: APP.danger, fontSize: 16 },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { color: APP.text, fontSize: 17 },
  emptySub: { color: APP.sub, fontSize: 13, marginTop: 8, textAlign: 'center', paddingHorizontal: 30 },
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
