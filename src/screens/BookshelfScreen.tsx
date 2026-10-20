import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { useStore, ShelfBook } from '../store/useStore';
import { BookCover } from '../components/BookCover';
import { APP } from '../theme/theme';
import { importLocalTxt } from '../utils/localBook';

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

  const onLongPress = (b: ShelfBook) => {
    Alert.alert('移除书架', `确定把《${b.name}》移出书架？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => removeFromShelf(b.bookUrl, b.sourceId),
      },
    ]);
  };

  const renderItem = ({ item }: { item: ShelfBook }) => (
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
          chapterIndex: item.lastChapterIndex,
          pageIndex: item.lastReadPos,
        })
      }
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
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
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
  name: { color: APP.text, fontSize: 17, fontWeight: '700' },
  author: { color: APP.sub, fontSize: 13, marginTop: 4 },
  progress: { color: APP.sub, fontSize: 12, marginTop: 8 },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { color: APP.text, fontSize: 17 },
  emptySub: { color: APP.sub, fontSize: 13, marginTop: 8 },
});
