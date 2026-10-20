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
} from 'react-native';
import { useStore } from '../store/useStore';
import { BookSource } from '../engine/types';
import { SAMPLE_SOURCE } from '../sources/sampleSource';
import { APP } from '../theme/theme';

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
              点「导入」粘贴社区书源 JSON，或加「示例源」体验
            </Text>
          </View>
        }
      />

      <Modal visible={modal} transparent animationType="slide">
        <View style={styles.modalMask}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>导入书源</Text>
            <Text style={styles.modalHint}>
              粘贴书源 JSON（单个或数组），或粘贴一个 .json 链接
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
              numberOfLines={8}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={[styles.mbtn, styles.mcancel]}
                onPress={() => setModal(false)}
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
        </View>
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
  modalMask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: APP.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 30,
  },
  modalTitle: { color: APP.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  modalHint: { color: APP.sub, fontSize: 13, marginBottom: 12 },
  input: {
    backgroundColor: APP.bg,
    color: APP.text,
    borderRadius: 10,
    padding: 12,
    height: 140,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: APP.border,
  },
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
