/**
 * 修复 Xcode 26 新 clang 收紧 consteval 校验导致 RN 0.79 内置 fmt 11.0.2
 * 编译失败（Pods/fmt/include/fmt/format-inl.h:59 consteval 非常量表达式）。
 *
 * 根因：fmt 11.0.2 的 FMT_USE_CONSTEVAL 在 C++20 下依赖 consteval，而 Xcode 26
 * 的 clang 对 consteval 调用点校验更严格，导致其 FMT_STRING(...) 宏在编译期不通过。
 * 修复：仅把 fmt 这唯一一个 Pod target 的 C++ 标准降到 c++17（consteval 不存在，
 * 自动跳过问题代码路径），其余 pod 仍保持 C++20（RN 自身需要），最小且可逆。
 *
 * 放在 config plugin 里，使 expo prebuild 每次重生成 ios/ 后该修复都能存活。
 */
const { withPodfile } = require('@expo/config-plugins');

const MARKER = '# [yuan-reader] fmt-cxx17-fix';

module.exports = function withFmtCxx17(config) {
  return withPodfile(config, (cfg) => {
    if (cfg.modResults.contents.includes(MARKER)) {
      return cfg;
    }
    const block = `
${MARKER}
post_install do |installer|
  installer.pods_project.targets.each do |target|
    if target.name == 'fmt'
      target.build_configurations.each do |config|
        config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
      end
    end
  end
end
`;
    cfg.modResults.contents += block;
    return cfg;
  });
};
