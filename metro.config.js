// Metro 配置：为 iconv-lite 依赖的 Node 内置模块 string_decoder 提供 RN 兼容 shim。
// Metro 无法解析 Node 内置模块（string_decoder），故映射到本地实现。
// 只影响 string_decoder，其余保持 Expo 默认解析（stream 由 iconv-lite 的 browser
// 字段 {"stream":false} 置空，buffer 由 node_modules/buffer 提供，均无需额外处理）。
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  string_decoder: path.resolve(__dirname, 'shims/string_decoder.js'),
};

module.exports = config;
