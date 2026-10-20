#!/usr/bin/env ruby
# 规避 Xcode 26 / clang 对 RN 0.79 内置 fmt 11.x 的 consteval 编译错误。
# 关键：必须插在 post_install 块的「末尾」（即 react_native_post_install 调用之后），
# 否则 RN 自身的 post_install 会把 CLANG_CXX_LANGUAGE_STANDARD 重新设回 c++20，覆盖我们的修复。
path = ARGV[0] || 'Podfile'
abort "Podfile not found: #{path}" unless File.exist?(path)
s = File.read(path)
marker = '[yuan-reader] fmt-cxx17-fix'
if s.include?(marker)
  puts "fmt-cxx17-fix 已存在，跳过"
  exit 0
end

block = <<~RUBY

  # [yuan-reader] fmt-cxx17-fix: 规避 Xcode 26 clang consteval bug (RN 0.79 内置 fmt 11.x)
  # 插在 post_install 块末尾，确保在 react_native_post_install 之后执行
  installer.pods_project.build_configurations.each do |c|
    c.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
  end
  installer.pods_project.targets.each do |t|
    t.build_configurations.each do |c|
      c.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
    end
  end
RUBY

lines = s.split("\n")
start_i = lines.index { |l| l =~ /post_install do \|installer\|/ }
abort "post_install block not found in #{path}" unless start_i

# 配对 post_install 的闭合 end（按 do/end 嵌套深度匹配，兼容多行 react_native_post_install 调用）
depth = 0
end_i = nil
(start_i...lines.length).each do |i|
  depth += lines[i].scan(/\bdo\b/).length
  depth -= lines[i].scan(/\bend\b/).length
  if i > start_i && depth == 0
    end_i = i
    break
  end
end
abort "找不到 post_install 的闭合 end" unless end_i

indent = lines[start_i][/^\s*/]
block_lines = block.strip.split("\n").map { |l| indent + l }
lines.insert(end_i, *block_lines)
s = lines.join("\n")
File.write(path, s)
puts "已在 post_install 块末尾注入 fmt c++17 修复 (插入位置行 #{end_i})"
