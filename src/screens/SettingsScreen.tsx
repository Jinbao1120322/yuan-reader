import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  TextInput,
  Alert,
} from 'react-native';
import { useStore, ReplaceRule } from '../store/useStore';
import { APP } from '../theme/theme';
import { TopBar } from '../components/TopBar';
import appJson from '../../app.json';

// 版本号以 app.json 为准，避免与构建/CI 产生的版本不一致
const VERSION = (appJson as any).expo?.version || '1.0.0';

export function SettingsScreen() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

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
