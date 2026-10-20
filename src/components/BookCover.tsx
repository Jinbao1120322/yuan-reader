import React from 'react';
import { View, Text, Image, StyleSheet, ImageStyle } from 'react-native';
import { APP } from '../theme/theme';

interface Props {
  uri?: string;
  name: string;
  width?: number;
  height?: number;
  style?: ImageStyle;
}

// 书封：有图加载，无图/加载失败显示首字占位
export function BookCover({ uri, name, width = 92, height = 128, style }: Props) {
  const [err, setErr] = React.useState(false);
  const showImg = uri && !err;
  return (
    <View
      style={[
        styles.box,
        { width, height, backgroundColor: APP.card2 },
        style,
      ]}
    >
      {showImg ? (
        <Image
          source={{ uri }}
          style={styles.img}
          onError={() => setErr(true)}
        />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.phText} numberOfLines={2}>
            {name.slice(0, 4)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: APP.border,
  },
  img: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: APP.accent,
  },
  phText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
});
