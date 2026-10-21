import React from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { useStore, ShelfBook } from '../store/useStore';
import { BookCover } from '../components/BookCover';
import { TopBar } from '../components/TopBar';
import { APP } from '../theme/theme';
import { importLocalTxt } from '../utils/localBook';
import { Text } from '../components/AppText';

export function BookshelfScreen() {
  const navigation = useNavigation<any>();
  const shelf = useStore((s) => s.shelf);
  const removeFromShelf = useStore((s) => s.removeFromShelf);
  const addToShelfLocal = useStore((s) => s.addToShelf);

  const onImportTxt = async () => {
    try {
      const doc = await DocumentPicker.getDocumentAsync({
        type: 'text/plain',
        copyToCacheDirectory: true,
      });
      if (doc.canceled || !doc.assets?.[0]) return;
      const asset = doc.assets[0];
      const book = await importLocalTxt(asset.uri, asset.name);
      addToShelfLocal({
        bookUrl: book.bookUrl,
        sourceId: book.sourceId,
        name: book.name,
        author: book.author,
        intro: book.intro,
        lastChapter: '本地书', addedAt: Date.now(), lastReadAt: Date.now(),
        lastChapterIndex: 0, lastReadPos: 0,
      });
      navigation.navigate('Reader', {
        bookUrl: book.bookUrl,
        sourceId: book.sourceId,
        name: book.name,
        author: book.author,
        local: true,
      });
    } catch (e: any) {
      Alert.alert('导入失败', e?.message || String(e));
    }
  };

  const openDetail = (b: ShelfBook) =>
    navigation.navigate('BookDetail', {
      bookUrl: b.bookUrl,
      sourceId: b.sourceId,
      name: b.name,
      author: b.author,
      coverUrl: b.coverUrl,
      intro: b.intro,
      lastChapter: b.lastChapter,
      chapterIndex: b.lastChapterIndex,
      pageIndex: b.lastReadPos,
    });

  const openReader = (b: ShelfBook) =>
    navigation.navigate('Reader', {
      bookUrl: b.bookUrl,
      sourceId: b.sourceId,
      name: b.name,
      author: b.author,
      chapterIndex: b.lastChapterIndex,
      pageIndex: b.lastReadPos,
    });

  // 删除/管理等操作入口：卡片右侧「⋮」+ 长按，两条路都能到
  const askRemove = (b: ShelfBook) => {
    Alert.alert(
      '移出书架',
      `确定把《${b.name}》移出书架？\n\n只是从书架移除，书源和本地文件都不会被删除，随时能再搜回来。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '移出书架',
          style: 'destructive',
          onPress: () => removeFromShelf(b.bookUrl, b.sourceId),
        },
      ]
    );
  };

  const onLongPress = (b: ShelfBook) => {
    Alert.alert(b.name, b.author || '', [
      { text: '继续阅读', onPress: () => openReader(b) },
      { text: '移出书架', style: 'destructive', onPress: () => askRemove(b) },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const onMore = (b: ShelfBook) => {
    Alert.alert(b.name, '要做什么？', [
      { text: '继续阅读', onPress: () => openReader(b) },
      { text: '书籍详情', onPress: () => openDetail(b) },
      { text: '移出书架', style: 'destructive', onPress: () => askRemove(b) },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const renderItem = ({ item }: { item: ShelfBook }) => (
    <TouchableOpacity
      style={styles.item}
      onPress={() => openReader(item)}
      onLongPress={() => onLongPress(item)}
    >
      <BookCover uri={item.coverUrl} name={item.name} />
      <View style={styles.meta}>
        <Text style={styles.name} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.author} numberOfLines={1}>
          {item.author}
        </Text>
        <Text style={styles.progress} numberOfLines={1}>
          {item.lastChapter}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.more}
        onPress={() => onMore(item)}
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
      >
        <Text style={styles.moreText}>⋮</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* 顶部栏负责吃 top inset（灵动岛/状态栏），否则列表会画到状态栏底下 */}
      <TopBar
        title="书架"
        right={
          <TouchableOpacity onPress={() => navigation.navigate('Search')}>
            <Text style={styles.topAction}>搜索</Text>
          </TouchableOpacity>
        }
      />
      <FlatList
        data={shelf}
        keyExtractor={(i) => i.bookUrl + i.sourceId}
        renderItem={renderItem}
        numColumns={1}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>书架还是空的</Text>
            <Text style={styles.emptySub}>
              去「书源」里搜索，或导入本地 TXT
            </Text>
          </View>
        }
        ListHeaderComponent={
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => navigation.navigate('Search')}
            >
              <Text style={styles.actionText}>🔍 搜书</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={onImportTxt}>
              <Text style={styles.actionText}>📄 导入TXT</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: APP.bg },
  topAction: { color: APP.accent, fontSize: 16 },
  list: { padding: 16 },
  actions: { flexDirection: 'row', marginBottom: 12 },
  actionBtn: {
    flex: 1,
    marginRight: 10,
    backgroundColor: APP.card,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: APP.border,
  },
  actionText: { color: APP.text, fontSize: 15, fontWeight: '600' },
  item: {
    flexDirection: 'row',
    backgroundColor: APP.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: APP.border,
  },
  meta: { flex: 1, marginLeft: 12, justifyContent: 'center' },
  more: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 2,
  },
  moreText: { color: APP.sub, fontSize: 22, lineHeight: 24, fontWeight: '700' },
  name: { color: APP.text, fontSize: 17, fontWeight: '700' },
  author: { color: APP.sub, fontSize: 13, marginTop: 4 },
  progress: { color: APP.sub, fontSize: 12, marginTop: 8 },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { color: APP.text, fontSize: 17 },
  emptySub: { color: APP.sub, fontSize: 13, marginTop: 8 },
});
