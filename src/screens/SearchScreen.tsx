import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useStore } from '../store/useStore';
import { search } from '../engine/SourceEngine';
import { SearchBook } from '../engine/types';
import { BookCover } from '../components/BookCover';
import { APP } from '../theme/theme';
import { TopBar } from '../components/TopBar';

export function SearchScreen() {
  const navigation = useNavigation<any>();
  const sources = useStore((s) => s.sources);
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchBook[]>([]);
  const [done, setDone] = useState(false);

  const onSearch = async () => {
    const kw = key.trim();
    if (!kw) return;
    const enabled = sources.filter((s) => s._enabled);
    if (enabled.length === 0) {
      setResults([]);
      setDone(true);
      return;
    }
    setLoading(true);
    setDone(false);
    try {
      const all = await Promise.all(
        enabled.map((s) =>
          search(s, kw).catch(() => [] as SearchBook[])
        )
      );
      const merged = all.flat();
      setResults(merged);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
      setDone(true);
    }
  };

  const renderItem = ({ item }: { item: SearchBook }) => (
    <TouchableOpacity
      style={styles.item}
      onPress={() =>
        navigation.navigate('BookDetail', {
          bookUrl: item.bookUrl,
          sourceId: item.sourceId,
          name: item.name,
          author: item.author,
          coverUrl: item.coverUrl,
          intro: item.intro,
          lastChapter: item.lastChapter,
        })
      }
    >
      <BookCover uri={item.coverUrl} name={item.name} width={64} height={88} />
      <View style={styles.meta}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.author} numberOfLines={1}>
          {item.author || '未知'}
        </Text>
        <Text style={styles.src} numberOfLines={1}>
          {item.sourceName}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* 搜索页是从书架推进来的独立页，带返回；TopBar 负责吃 top inset */}
      <TopBar title="搜索" onBack={() => navigation.goBack()} />
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          placeholder="输入书名 / 作者"
          placeholderTextColor={APP.sub}
          value={key}
          onChangeText={setKey}
          onSubmitEditing={onSearch}
          returnKeyType="search"
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.go} onPress={onSearch}>
          <Text style={styles.goText}>搜索</Text>
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={APP.accent} />
          <Text style={styles.hint}>正在跨书源搜索…</Text>
        </View>
      )}

      {!loading && done && results.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.hint}>没有结果，换个关键词或检查书源</Text>
        </View>
      )}

      <FlatList
        data={results}
        keyExtractor={(i, idx) => i.bookUrl + i.sourceId + idx}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: APP.bg },
  searchBar: {
    flexDirection: 'row',
    padding: 16,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: APP.card,
    color: APP.text,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: APP.border,
  },
  go: {
    marginLeft: 10,
    backgroundColor: APP.accent,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  goText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  center: { alignItems: 'center', marginTop: 60 },
  hint: { color: APP.sub, fontSize: 14, marginTop: 12 },
  list: { paddingHorizontal: 16 },
  item: {
    flexDirection: 'row',
    backgroundColor: APP.card,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: APP.border,
  },
  meta: { flex: 1, marginLeft: 12, justifyContent: 'center' },
  name: { color: APP.text, fontSize: 16, fontWeight: '700' },
  author: { color: APP.sub, fontSize: 13, marginTop: 4 },
  src: { color: APP.sub, fontSize: 12, marginTop: 6 },
});
