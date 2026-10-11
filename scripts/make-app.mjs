#!/usr/bin/env node
// 把 Electron 二进制 + Web 构建产物组装成可双击运行的 macOS .app。
//
// 为什么手工组装而不是 electron-builder：
//   electron-builder 需要从 GitHub 下载自己的工具链（app-builder / dmg 工具等），
//   在 GitHub 不可达的环境里必然失败。这里直接复用 node_modules/electron/dist/Electron.app
//   ——它本身就是一个完整的 Electron 宿主应用——只需把我们的应用资源注入
//   Contents/Resources 即可，全程零额外下载。
//
// 产物布局（与 electron/main.cjs 的生产加载路径严格对应）：
//   KeyDriver Lite.app/Contents/Resources/app/main.cjs   ← 主进程
//   KeyDriver Lite.app/Contents/Resources/dist/index.html ← 渲染进程（main.cjs 用 '../dist' 取）
//   main.cjs 中 __dirname = .../Resources/app，故 '../dist' = .../Resources/dist ✓
//
// Lite 裁剪（KeyDriver Lite 专属，对应 docs/SIZE-REDUCTION-EVAL.md §5 阶段 A 账目）：
//   第 3.5 步在注入资源之后、codesign 之前删除非中英 locale / swiftshader / ffmpeg /
//   default_app.asar。**顺序必须先裁后签**——签名后再删文件会破坏签名，应用启动即退出。
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const ELECTRON_APP = path.join(ROOT, 'node_modules/electron/dist/Electron.app');
const OUT_DIR = path.join(ROOT, 'release');

// 应用身份从 package.json 读取（Lite 与主版共用同一份脚本逻辑，只随 package.json 改变）。
// 产物名 "KeyDriver Lite.app" 含空格：所有子进程调用走 execFileSync 参数数组，
// 路径空格由 Node 自动处理，无 shell 注入/截断风险。
const PKG = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const APP_ID = PKG.build?.appId ?? 'com.keydriver.lite';
const APP_NAME = PKG.build?.productName ?? 'KeyDriver Lite';
const OUT_APP = path.join(OUT_DIR, `${APP_NAME}.app`);
const PLIST = path.join(OUT_APP, 'Contents/Info.plist');

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/** 目录/文件实际占用（du -sk，单位 KB）；目标不存在返回 0。用于裁剪账目实测。 */
function diskKb(p) {
  try {
    return Number.parseInt(execFileSync('du', ['-sk', p]).toString(), 10) || 0;
  } catch {
    return 0;
  }
}

function mb(kb) {
  return (kb / 1024).toFixed(1);
}

/**
 * 删除单个文件（防御式）：先常规 rm；失败时退化为改名移入系统临时目录。
 * 背景：某些受限环境（沙箱/EDR）禁止删除带 com.apple.provenance 扩展属性的文件，
 * 但允许 rename——移入 tmpdir 由系统按临时文件回收，效果等同删除。
 * 返回是否成功移除（目标不存在视为 true）。
 */
async function removeFileRobust(p) {
  try {
    await access(p);
  } catch {
    return true; // 目标本就不存在（Electron 版本结构变化），裁剪项自然缺席
  }
  try {
    await rm(p, { force: true });
    return true;
  } catch {
    try {
      const trashName = `keydriver-lite-trash-${process.pid}-${path.basename(p)}`;
      await rename(p, path.join(os.tmpdir(), trashName));
      return true;
    } catch {
      return false;
    }
  }
}

async function main() {
  // 1. 前置检查
  if (!(await exists(ELECTRON_APP))) {
    fail(
      '未找到 Electron 二进制：node_modules/electron/dist/Electron.app\n' +
        '  请先安装：ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ npm install electron\n' +
        '  若二进制下载失败，可手动下载 zip 后解压到 node_modules/electron/dist/，' +
        '并写入 path.txt = "Electron.app/Contents/MacOS/Electron"',
    );
  }
  const distIndex = path.join(ROOT, 'dist/index.html');
  if (!(await exists(distIndex))) {
    fail('未找到构建产物 dist/index.html，请先运行 npm run build');
  }

  // 2. 清旧产物并复制 Electron 宿主
  //
  // ⚠️ 必须带 -X（不复制扩展属性）：npm 重新下载 Electron 后，bundle 内文件会带上
  // com.apple.provenance 扩展属性，该属性是系统保护的（xattr -cr 删不掉），
  // 普通 cp -R 尝试读取它时会被拒绝，报
  //   "cp: .../Resources/default_app.asar: Operation not permitted"
  // 从而让整个打包失败。-X 让 cp 跳过扩展属性即可绕开。
  await rm(OUT_APP, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  try {
    execFileSync('cp', ['-RX', ELECTRON_APP, OUT_APP]);
  } catch (e) {
    // 兜底：极少数环境（非 macOS 的 cp）仍可能失败，退化为逐目录 rsync 语义的 ditto
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`⚠️ cp -RX 失败（${msg.split('\n')[0]}），改用 ditto --noextattr 重试`);
    execFileSync('ditto', ['--noextattr', ELECTRON_APP, OUT_APP]);
  }
  console.log('✓ 已复制 Electron 宿主');

  // 3. 注入应用资源
  const resApp = path.join(OUT_APP, 'Contents/Resources/app');
  await mkdir(resApp, { recursive: true });

  const pkg = PKG;
  await writeFile(
    path.join(resApp, 'package.json'),
    JSON.stringify(
      { name: pkg.name ?? 'keydriver-lite', productName: APP_NAME, version: pkg.version ?? '0.1.0', main: 'main.cjs' },
      null,
      2,
    ),
  );
  execFileSync('cp', [path.join(ROOT, 'electron/main.cjs'), path.join(resApp, 'main.cjs')]);
  // T06-3：preload.cjs 是唯一 IPC bridge，必须随主进程一并注入（main.cjs 以 __dirname 定位它）
  execFileSync('cp', [path.join(ROOT, 'electron/preload.cjs'), path.join(resApp, 'preload.cjs')]);

  // dist 放 Resources/dist（与 main.cjs 的 '../dist' 对应）
  await rm(path.join(OUT_APP, 'Contents/Resources/dist'), { recursive: true, force: true });
  execFileSync('cp', ['-R', path.join(ROOT, 'dist'), path.join(OUT_APP, 'Contents/Resources/dist')]);
  console.log('✓ 已注入主进程与构建产物');

  // 3.5 阶段 A 裁剪（Lite 专属）：删除不影响本应用运行的 Electron 运行时外围文件。
  //
  // 依据：docs/SIZE-REDUCTION-EVAL.md §1 体积解剖 + §5 阶段 A 账目。
  // ⚠️ 顺序约束：必须在第 5 步 codesign **之前**执行——签名后再删文件会破坏
  //    CodeSignature，应用启动即退出。
  // ⚠️ 不可删项（本步骤全部用精确路径删除，glob 只匹配 *.lproj，不会误伤）：
  //    - icudtl.dat（10M，国际化字符集，删了 Chromium 崩）
  //    - resources.pak（12M，Chromium 资源清单，删了崩）
  //    - chrome_200_percent.pak（1.2M，Retina 缩放资源，评估结论建议保留）
  const sizeBeforeTrim = diskKb(OUT_APP);
  const fwRes = path.join(OUT_APP, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources');
  const fwLib = path.join(OUT_APP, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries');
  const appRes = path.join(OUT_APP, 'Contents/Resources');

  // 账目记录：[{ label, savedKb }]
  const trimLog = [];

  // ① 非中英语言包（账目：~659 文件 / ~47M）：只保留 en.lproj 与 zh_CN.lproj。
  //    本应用 UI 语言为中文/英文，其余 200+ 种 .lproj 纯属 Electron 全量分发。
  //    electron-builder 路径已由 package.json 的 electronLanguages: ["en","zh"] 声明，
  //    这里把同一口径固化进手工打包。
  let localeSaved = 0;
  let localeDirs = 0;
  const KEEP_LOCALES = new Set(['en.lproj', 'zh_CN.lproj']);
  for (const dir of [fwRes, appRes]) {
    let entries = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue; // 目录不存在（结构变化）则跳过，防御式不失败
    }
    for (const name of entries) {
      if (!name.endsWith('.lproj') || KEEP_LOCALES.has(name)) continue;
      const target = path.join(dir, name);
      localeSaved += diskKb(target);
      localeDirs += 1;
      await rm(target, { recursive: true, force: true });
    }
  }
  trimLog.push({ label: `非中英语言包（${localeDirs} 个 .lproj 目录）`, savedKb: localeSaved });

  // ② libvk_swiftshader.dylib + vk_swiftshader_icd.json（账目：~16M）：软件渲染回退
  //    （SwiftShader WebGL）。本应用是纯 2D DOM 界面，GPU 回退用不到。
  //    链接证据（otool 全 bundle 扫描，QA 回归轮 2 修正）：bundle 内没有任何 Mach-O 的
  //    LC_LOAD_DYLIB 引用它（Electron Framework 只硬链 libffmpeg），它是经
  //    vk_swiftshader_icd.json 按需动态加载的 Vulkan ICD —— 可删；icd 清单必须随删，
  //    否则 Vulkan loader 扫到悬空 manifest。
  const swiftshader = path.join(fwLib, 'libvk_swiftshader.dylib');
  const swiftshaderKb = diskKb(swiftshader);
  trimLog.push({ label: 'libvk_swiftshader.dylib', savedKb: (await removeFileRobust(swiftshader)) ? swiftshaderKb : 0 });
  const swiftshaderIcd = path.join(fwLib, 'vk_swiftshader_icd.json');
  const swiftshaderIcdKb = diskKb(swiftshaderIcd);
  trimLog.push({ label: 'vk_swiftshader_icd.json', savedKb: (await removeFileRobust(swiftshaderIcd)) ? swiftshaderIcdKb : 0 });

  // ③ libffmpeg.dylib —— **不可删，已回退**（QA 回归轮 2）。
  //    otool -L 证据：Electron Framework 的 LC_LOAD_DYLIB 硬依赖 @rpath/libffmpeg.dylib，
  //    删除后 dyld 解析失败 → SIGABRT 启动即崩。即使应用无音视频播放需求也无法裁剪。

  // ④ default_app.asar（账目：~112K）：Electron 自带示例应用，被我们的 app/ 完全取代。
  //    非 Mach-O、无链接依赖，可安全删除。
  const defaultApp = path.join(appRes, 'default_app.asar');
  const defaultAppKb = diskKb(defaultApp);
  trimLog.push({ label: 'default_app.asar', savedKb: (await removeFileRobust(defaultApp)) ? defaultAppKb : 0 });

  const sizeAfterTrim = diskKb(OUT_APP);
  const totalSaved = sizeBeforeTrim - sizeAfterTrim;
  console.log('✓ 阶段 A 裁剪完成（先裁后签）：');
  for (const { label, savedKb } of trimLog) {
    console.log(`    - ${label}：省 ${mb(savedKb)}M`);
  }
  console.log(`    裁剪前 ${mb(sizeBeforeTrim)}M → 裁剪后 ${mb(sizeAfterTrim)}M（共省 ${mb(totalSaved)}M，-${Math.round((totalSaved / Math.max(1, sizeBeforeTrim)) * 100)}%）`);

  // 4. 改写应用身份信息
  for (const [key, value] of [
    ['CFBundleDisplayName', APP_NAME],
    ['CFBundleName', APP_NAME],
    ['CFBundleIdentifier', APP_ID],
    ['CFBundleShortVersionString', String(pkg.version ?? '0.1.0')],
  ]) {
    execFileSync('plutil', ['-replace', key, '-string', value, PLIST]);
  }
  console.log('✓ 已设置应用名称与标识');

  // 5. 重新签名（ad-hoc）：我们改写了 Info.plist 并向 bundle 内塞入了自己的资源，
  //    这会**破坏 Electron.app 原有的代码签名**。Electron 启动时会校验自身签名
  //    （shell/common/mac/codesign_util.cc），签名失效会导致进程直接退出、窗口不出现。
  //    因此必须用「-」做一次 ad-hoc 重签——这是手工打包 Electron 的必要步骤。
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', OUT_APP]);
    console.log('✓ 已重新签名（ad-hoc，修复「改包后启动即退出」）');
  } catch (e) {
    console.log(`· 重新签名失败（codesign 不可用或受限）：${e instanceof Error ? e.message : String(e)}`);
  }

  // 6. 去掉隔离属性：否则 Gatekeeper 会把从网络下载的应用拦为「已损坏」
  try {
    execFileSync('xattr', ['-cr', OUT_APP]);
    console.log('✓ 已清除隔离属性（避免「应用已损坏」）');
  } catch {
    console.log('· 跳过清除隔离属性（xattr 不可用，不影响打包结果）');
  }

  // 7. 附带定义文件，方便用户首次导入
  const defSrc = path.join(ROOT, 'definitions');
  if (await exists(defSrc)) {
    await rm(path.join(OUT_DIR, 'definitions'), { recursive: true, force: true });
    execFileSync('cp', ['-R', defSrc, path.join(OUT_DIR, 'definitions')]);
    console.log('✓ 已附带 definitions/（首次启动可拖拽导入）');
  }

  const size = execFileSync('du', ['-sh', OUT_APP]).toString().trim().split('\t')[0];
  console.log(`\n✓ 封装完成：${OUT_APP}（${size}）`);
  console.log('  双击即可运行；首次启动需导入一份键盘定义文件（release/definitions/ 里已备好）。');
}

main().catch((e) => {
  console.error('✗ 封装失败：', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
