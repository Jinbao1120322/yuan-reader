#!/usr/bin/env ruby
# 在 Expo 生成的 Podfile 的单个 post_install 块内注入 fmt 的 C++ 标准降级，
# 规避 Xcode 26 / clang 对 RN 0.79 内置 fmt 11.x 的 consteval 编译错误。
# 用法：ruby fix_podfile.rb <path-to-Podfile>
path = ARGV[0] || 'Podfile'
abort "Podfile not found: #{path}" unless File.exist?(path)

s = File.read(path)
needle = /post_install do \|installer\|/
abort "post_install block not found in #{path}" unless s =~ needle

block = <<~RUBY
  # [yuan-reader] fmt-cxx17-fix: 规避 Xcode 26 clang consteval bug (RN 0.79 内置 fmt 11.x 编译失败)
  installer.pods_project.targets.each do |t|
    if t.name == "fmt"
      t.build_configurations.each do |c|
        c.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
      end
    end
  end
RUBY

# 只注入一次：若已存在标记则跳过
if s.include?('[yuan-reader] fmt-cxx17-fix')
  puts "fmt-cxx17-fix 已存在，跳过注入"
else
  s.sub!(needle) { |m| m + "\n" + block }
  File.write(path, s)
  puts "已为 #{path} 注入 fmt c++17 修复"
end
