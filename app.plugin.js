const { withPodfile } = require('@expo/config-plugins');

// 把 fmt 的 C++ 标准降级逻辑合并进 Expo 已有的 post_install 块内部（CocoaPods 不支持多个 post_install 钩子）。
function applyFmtFix(podfile) {
  const marker = /post_install do \|(\w+)\|/;
  const m = podfile.match(marker);

  if (!m) {
    // 兜底：完全没有 post_install（极少见），新增一个
    const installer = 'installer';
    const hook = `
  # [yuan-reader] fmt-cxx17-fix: 规避 Xcode 26 clang consteval bug (RN 0.79 内置 fmt 11.0.2 编译失败)
  ${installer}.pods_project.targets.each do |target|
    if target.name == 'fmt'
      target.build_configurations.each do |config|
        config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
      end
    end
  end`;
    return podfile + `\npost_install do |${installer}|${hook}\nend\n`;
  }

  const installer = m[1];
  const hook = `
  # [yuan-reader] fmt-cxx17-fix: 规避 Xcode 26 clang consteval bug (RN 0.79 内置 fmt 11.0.2 编译失败)
  ${installer}.pods_project.targets.each do |target|
    if target.name == 'fmt'
      target.build_configurations.each do |config|
        config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
      end
    end
  end`;

  const start = m.index + m[0].length;
  const tail = podfile.slice(start);
  const lines = tail.split('\n');

  // 从 post_install 的 do 开始做 Ruby 块深度匹配（do/{/if/unless/case/begin/def 开 +1，end/} 闭 -1）
  let depth = 1;
  let insertAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(/\bdo\b|\{|\bif\b|\bunless\b|\bcase\b|\bbegin\b|\bdef\b/g) || []).length;
    const closes = (line.match(/\bend\b|\}/g) || []).length;
    depth += opens - closes;
    if (depth === 0) {
      insertAt = i; // 这一行的 end 是 post_install 块的闭合
      break;
    }
  }

  if (insertAt === -1) {
    // 兜底：没找到闭合 end，直接追加到文件尾
    return podfile + hook + '\n';
  }

  lines.splice(insertAt, 0, hook);
  return podfile.slice(0, start) + lines.join('\n');
}

module.exports = function (config) {
  return withPodfile(config, (cfg) => {
    cfg.modResults.contents = applyFmtFix(cfg.modResults.contents);
    return cfg;
  });
};

// 仅用于本地测试
module.exports.applyFmtFix = applyFmtFix;
