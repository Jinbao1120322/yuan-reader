import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Switch,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useStore, ReplaceRule } from '../store/useStore';
import { APP } from '../theme/theme';
import { TopBar } from '../components/TopBar';
import appJson from '../../app.json';
import { Text } from '../components/AppText';
import { deleteFontFile, importFontFile } from '../utils/customFonts';

// 版本号以 app.json 为准，避免与构建/CI 产生的版本不一致
const VERSION = (appJson as any).expo?.version || '1.0.0';

export function SettingsScreen() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const fonts = useStore((s) => s.fonts);
  const addFont = useStore((s) => s.addFont);
  const removeFont = useStore((s) => s.removeFont);
  const [fontBusy, setFontBusy] = useState(false);

  // 从「文件」导入 ttf / otf / ttc，复制进沙盒并立刻注册
  const pickFont = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['font/*', 'application/octet-stream', 'public.data'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      if (!/\.(ttf|otf|ttc|otc)$/i.test(asset.name || '')) {
        Alert.alert('这个文件不是字体', '支持 .ttf / .otf / .ttc');
        return;
      }
      setFontBusy(true);
      const f = await importFontFile(asset.uri, asset.name || '字体.ttf');
      addFont(f);
      // 导入后直接切过去，省一次点击
      updateSettings({ fontId: f.id });
      setFontBusy(false);
    } catch (e: any) {
      setFontBusy(false);
      Alert.alert('导入失败', e?.message || String(e));
    }
  };

  const useFont = (id: string | null) => updateSettings({ fontId: id });

  const askDeleteFont = (f: { id: string; label: string }) => {
    if (settings.fontId === f.id) {
      Alert.alert('无法删除', '正在使用中的字体无法删除，请先切换到其他字体。');
      return;
    }
    Alert.alert('删除字体', `确定删除「${f.label}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const target = fonts.find((x) => x.id === f.id);
          removeFont(f.id);
          if (target) await deleteFontFile(target);
        },
      },
    ]);
  };

  const [showReplace, setShowReplace] = useState(false);
  const [pat, setPat] = useState('');
  const [rpl, setRpl] = useState('');

  const addReplace = () => {
    if (!pat.trim()) return;
    const rule: ReplaceRule = {
      pattern: pat.trim(),
      replacement: rpl,
      isRegex: true,
    };
    updateSettings({ replaceRules: [...settings.replaceRules, rule] });
    setPat('');
    setRpl('');
  };

  const removeReplace = (i: number) => {
    updateSettings({
      replaceRules: settings.replaceRules.filter((_, idx) => idx !== i),
    });
  };

  return (
    <View style={styles.container}>
      <TopBar title="设置" />
      <View style={styles.body}>
        <Text style={styles.section}>阅读</Text>
        <View style={styles.row}>
          <Text style={styles.label}>默认主题</Text>
          <Text style={styles.val}>{themeLabel(settings.theme)}</Text>
        </View>
        <TouchableOpacity
          style={styles.rowBtn}
          onPress={() => {
            const opts: { text: string; mode: any }[] = [
              { text: '滚动', mode: 'scroll' },
              { text: '仿真', mode: 'simulate' },
              { text: '滑动', mode: 'slide' },
            ];
            Alert.alert(
              '翻页模式',
              '仿真 = 书页卷曲翻页；滑动 = 整页左右切换；滚动 = 连续滚动。',
              [
                ...opts.map((o) => ({
                  text:
                    settings.pageMode === o.mode ? `✓ ${o.text}` : o.text,
                  onPress: () => updateSettings({ pageMode: o.mode }),
                })),
                { text: '取消', style: 'cancel' as const },
              ]
            );
          }}
        >
          <Text style={styles.label}>翻页模式</Text>
          <Text style={styles.val}>{pageLabel(settings.pageMode)} ›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.rowBtn}
          onPress={() => setShowReplace((v) => !v)}
        >
          <Text style={styles.label}>全局替换净化</Text>
          <Text style={styles.val}>
            {settings.replaceRules.length} 条 ›
          </Text>
        </TouchableOpacity>

        {showReplace && (
          <View style={styles.replaceBox}>
            <Text style={styles.hint}>
              对正文按正则替换，去除广告/错别字。留空替换为删除。
            </Text>
            <TextInput
              style={styles.input}
              placeholder="正则，如：广告.*?字样"
              placeholderTextColor={APP.sub}
              value={pat}
              onChangeText={setPat}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="替换为（可空）"
              placeholderTextColor={APP.sub}
              value={rpl}
              onChangeText={setRpl}
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.addBtn} onPress={addReplace}>
              <Text style={styles.addText}>添加规则</Text>
            </TouchableOpacity>
            {settings.replaceRules.map((r, i) => (
              <View style={styles.ruleItem} key={i}>
                <Text style={styles.ruleText} numberOfLines={1}>
                  /{r.pattern}/ → {r.replacement || '（删除）'}
                </Text>
                <TouchableOpacity onPress={() => removeReplace(i)}>
                  <Text style={{ color: APP.danger }}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.section}>字体</Text>
        <Text style={styles.fontHint}>
          导入 .ttf / .otf / .ttc 后替换整个 App 的字体（含阅读正文）
        </Text>

        <TouchableOpacity
          style={[styles.rowBtn, settings.fontId ? null : styles.rowOn]}
          onPress={() => useFont(null)}
        >
          <Text style={styles.label}>系统默认</Text>
          <Text style={styles.val}>{settings.fontId ? '' : '使用中'}</Text>
        </TouchableOpacity>

        {fonts.map((f) => {
          const on = settings.fontId === f.id;
          return (
            <View key={f.id} style={[styles.fontRow, on && styles.rowOn]}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => useFont(f.id)}>
                <Text style={styles.label} numberOfLines={1}>
                  {f.label}
                </Text>
                <Text style={styles.fontSub}>{on ? '使用中' : '点击使用'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => askDeleteFont(f)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={[styles.fontDel, on && { opacity: 0.35 }]}>✕</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        <TouchableOpacity
          style={[styles.rowBtn, fontBusy && { opacity: 0.6 }]}
          onPress={pickFont}
          disabled={fontBusy}
        >
          {fontBusy ? (
            <ActivityIndicator color={APP.accent} />
          ) : (
            <Text style={styles.addText}>＋ 导入字体文件</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.section}>关于</Text>
        <View style={styles.row}>
          <Text style={styles.label}>版本</Text>
          <Text style={styles.val}>v{VERSION}</Text>
        </View>
        <Text style={styles.about}>
          源阅读 · 兼容 Legado 书源规则的 iOS 书源阅读器。{'\n'}
          软件本身不提供任何内容，所有书籍来自你导入的书源所访问的网站。
        </Text>
      </View>
    </View>
  );
}

function themeLabel(k: string) {
  return { day: '日间', night: '夜间', green: '护眼', paper: '羊皮纸' }[k] || k;
}
function pageLabel(k: string) {
  return { scroll: '滚动', cover: '覆盖', simulate: '仿真', slide: '滑动' }[k] || k;
}

const styles = StyleSheet.create({
  fontHint: {
    color: APP.sub,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
  },
  fontRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: APP.card,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: APP.border,
  },
  fontSub: { color: APP.sub, fontSize: 11, marginTop: 3 },
  fontDel: { color: APP.danger, fontSize: 16, marginLeft: 12 },
  rowOn: { borderColor: APP.accent },
  container: { flex: 1, backgroundColor: APP.bg },
  body: { padding: 16 },
  section: {
    color: APP.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: APP.border,
  },
  rowBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: APP.border,
  },
  label: { color: APP.text, fontSize: 15 },
  val: { color: APP.sub, fontSize: 14 },
  replaceBox: {
    backgroundColor: APP.card,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  hint: { color: APP.sub, fontSize: 12, marginBottom: 8 },
  input: {
    backgroundColor: APP.bg,
    color: APP.text,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: APP.border,
    fontSize: 14,
  },
  addBtn: {
    backgroundColor: APP.accent,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  addText: { color: '#fff', fontWeight: '700' },
  ruleItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderColor: APP.border,
  },
  ruleText: { color: APP.text, fontSize: 13, flex: 1, marginRight: 8 },
  about: { color: APP.sub, fontSize: 13, lineHeight: 20, marginTop: 8 },
});
