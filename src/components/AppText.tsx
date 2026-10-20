import React, { createContext, useContext } from 'react';
import { Text as RNText, TextProps } from 'react-native';

/*
 * 全局字体
 * ===========================================================================
 * RN 没有「全局默认字体」这种设置：Text 的 fontFamily 只能逐个给。
 * 所以这里做一个极薄的代理：App 根部用 FontProvider 提供当前字体的 family，
 * 项目里所有 Text 都从这个文件导入，就会自动带上字体。
 *
 * 用法上跟 react-native 的 Text 完全一致（props 原样透传），
 * 只是把 fontFamily 插到 style 数组最前面，业务里自己写的 fontFamily 仍然优先。
 */

const FontContext = createContext<string | null>(null);

export function FontProvider(props: {
  font: string | null;
  children: React.ReactNode;
}) {
  return (
    <FontContext.Provider value={props.font}>{props.children}</FontContext.Provider>
  );
}

export function useAppFont(): string | null {
  return useContext(FontContext);
}

export function Text(props: TextProps) {
  const font = useContext(FontContext);
  if (!font) return <RNText {...props} />;
  return <RNText {...props} style={[{ fontFamily: font }, props.style]} />;
}

export default Text;
