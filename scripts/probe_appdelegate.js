#!/usr/bin/env node
/**
 * 在 prebuild 生成的 AppDelegate.swift 里注入一个纯原生诊断探针。
 *
 * 为什么要这么做：
 *   现在只有「打开纯白屏」这一个现象，真机日志拿不到（用户没 Mac）。
 *   而这个探针完全不依赖 JS，能一次性区分三种可能：
 *     a) 看得到黄色横幅            → 窗口确实上屏了，白屏不是启动图/场景问题
 *     b) 横幅变红 + "JS 未挂载"     → 窗口正常、JS 一根手指都没渲染
 *     c) 横幅变绿 + "JS 已挂载"     → JS 挂上了，问题在 JS 渲染内容
 *   同时接管 RCTFatal 处理器，把 JS 致命错误原文直接画在横幅上。
 *
 * 任何一步不符合预期都 exit 1 —— 让构建在 1 分钟内失败，而不是 10 分钟后才发现。
 *
 * 用法: node scripts/probe_appdelegate.js ios/app/AppDelegate.swift
 */

const fs = require('fs');

const path = process.argv[2];
if (!path) {
  console.error('ERROR: 用法: node scripts/probe_appdelegate.js <AppDelegate 路径>');
  process.exit(1);
}
if (!fs.existsSync(path)) {
  console.error('ERROR: 文件不存在: ' + path);
  process.exit(1);
}

let src = fs.readFileSync(path, 'utf8');

if (src.includes('YRProbe')) {
  console.log('PROBE: 已存在，跳过注入');
  process.exit(0);
}

// 注入点：didFinishLaunching 里 startReactNative 调用的收尾行。
// 该行在文件里只出现一次（另一个 application 方法没有 launchOptions 参数）。
const ANCHOR = '      launchOptions: launchOptions)\n';
const hits = src.split(ANCHOR).length - 1;
if (hits !== 1) {
  console.error('ERROR: 锚点出现 ' + hits + ' 次（期望 1 次），AppDelegate 结构与预期不符');
  console.error('----- AppDelegate 全文 -----');
  console.error(src);
  process.exit(1);
}

const INJECT =
  ANCHOR +
  '\n' +
  '    // ---- 原生诊断探针注入点（构建时由 scripts/probe_appdelegate.js 写入）----\n' +
  '    if let w = window {\n' +
  '      YRProbe.install(on: w)\n' +
  '    }\n';

src = src.replace(ANCHOR, () => INJECT);

// 注意：用 String.raw，避免 Swift 字符串里的 \n 被 JS 提前转义成真实换行。
const PROBE_CLASS = String.raw`

// ===========================================================================
// YRProbe：纯原生诊断探针（与 JS 是否正常运行无关）
// 构建时由 scripts/probe_appdelegate.js 注入，用于定位「打开纯白屏」卡在哪一层。
// ===========================================================================
import UIKit

final class YRProbe: NSObject {
  private static var band: UIView?
  private static var label: UILabel?
  // 不用 weak：static 存储属性上挂 weak 的合法性在旧版 Swift 上不稳，窗口本身
  // 与 App 同生命周期，强引用没有任何副作用。
  private static var hostWindow: UIWindow?

  static func install(on window: UIWindow) {
    hostWindow = window
    let width = window.bounds.width

    let container = UIView(frame: CGRect(x: 0, y: 130, width: width, height: 116))
    container.backgroundColor = UIColor(red: 1.0, green: 0.85, blue: 0.0, alpha: 1.0)
    container.isUserInteractionEnabled = false
    container.tag = 9901

    let l = UILabel(frame: CGRect(x: 10, y: 6, width: width - 20, height: 104))
    l.numberOfLines = 0
    l.font = UIFont.monospacedSystemFont(ofSize: 10, weight: .regular)
    l.textColor = UIColor.black
    l.text = "NATIVE OK  v1.0.4\n" + bundleInfo()
    container.addSubview(l)

    window.addSubview(container)
    window.bringSubviewToFront(container)
    band = container
    label = l

    NotificationCenter.default.addObserver(
      forName: Notification.Name("RCTJavaScriptDidLoadNotification"),
      object: nil,
      queue: OperationQueue.main
    ) { _ in
      YRProbe.appendNote("bundle 已加载")
    }

    NotificationCenter.default.addObserver(
      forName: Notification.Name("RCTJavaScriptDidFailToLoadNotification"),
      object: nil,
      queue: OperationQueue.main
    ) { note in
      YRProbe.show("JS 加载失败\n" + String(describing: note.userInfo))
    }

    RCTSetFatalHandler { error in
      YRProbe.show("RCTFatal\n" + String(describing: error))
    }
    RCTSetFatalExceptionHandler { exception in
      YRProbe.show("FatalException\n" + String(describing: exception))
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 6.0) {
      guard let win = hostWindow else { return }
      let root = win.rootViewController?.view
      let total = YRProbe.countSubviews(root)
      let kind = root == nil ? "nil" : String(describing: type(of: root!))
      if total <= 0 {
        YRProbe.band?.backgroundColor = UIColor(red: 1.0, green: 0.28, blue: 0.18, alpha: 0.96)
        YRProbe.show("JS 未挂载（6s）\nrootView = " + kind
          + "\n子视图(递归) = " + String(total) + "\n" + YRProbe.bundleInfo())
      } else {
        YRProbe.band?.backgroundColor = UIColor(red: 0.15, green: 0.8, blue: 0.35, alpha: 0.96)
        YRProbe.show("JS 已挂载\nrootView = " + kind + "\n子视图(递归) = " + String(total))
        // 已确认 JS 正常挂载：亮 2 秒给个信号，然后自动撤掉，不挡界面
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
          YRProbe.band?.isHidden = true
        }
      }
      if let b = YRProbe.band {
        win.bringSubviewToFront(b)
      }
    }
  }

  static func show(_ text: String) {
    label?.text = text
    if let b = band {
      b.superview?.bringSubviewToFront(b)
    }
  }

  static func appendNote(_ note: String) {
    guard let l = label else { return }
    l.text = (l.text ?? "") + "\n" + note
  }

  static func countSubviews(_ view: UIView?) -> Int {
    guard let v = view else { return -1 }
    var n = 0
    for sub in v.subviews {
      n += 1 + countSubviews(sub)
    }
    return n
  }

  static func bundleInfo() -> String {
    guard let url = Bundle.main.url(forResource: "main", withExtension: "jsbundle") else {
      return "main.jsbundle = 缺失"
    }
    guard let data = try? Data(contentsOf: url) else {
      return "main.jsbundle = 读不到"
    }
    let head = [UInt8](data.prefix(6)).map { String(format: "%02x", $0) }.joined()
    let isHermes = head.hasPrefix("c61fbc03") ? "YES" : "NO"
    return "bundle " + String(data.count) + "B magic=" + head + " hermes=" + isHermes
  }
}
`;

src = src + PROBE_CLASS;
fs.writeFileSync(path, src);

const okInstall = src.includes('YRProbe.install(on: w)');
const okClass = src.includes('final class YRProbe');
const okFatal = src.includes('RCTSetFatalHandler');
const okCount = src.includes('countSubviews');
console.log(
  'PROBE: install_call=' + okInstall + ' class=' + okClass + ' fatal_handler=' + okFatal + ' count=' + okCount
);

if (!okInstall || !okClass || !okFatal || !okCount) {
  console.error('ERROR: 探针注入结果不完整');
  process.exit(1);
}

// 自证：注入后的文件里，Swift 单行字符串中的换行必须是字面 \n 而不是真实换行
const badLiteral = /l\.text = "NATIVE OK  v1\.0\.4\n/.test(src);
if (badLiteral) {
  console.error('ERROR: Swift 字符串被错误转义（出现真实换行）');
  process.exit(1);
}

console.log('PROBE: applied');
