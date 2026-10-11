// KeyDriver 桌面外壳主进程（Electron / CommonJS）。
// 职责：仅作为原生窗口外壳，承载现有 Web 构建产物（dist/）。
// 不实现任何业务/协议逻辑，不引用任何具体设备特征词。
//
// IPC 面（T06-3/T06-10）：唯一 bridge 是 electron/preload.cjs 经 contextBridge 暴露的
// `window.keydriver`，通道一律 `keydriver:` 前缀：
//   - keydriver:setDirtyCount      渲染进程 → 主进程，未保存改动数（关窗拦截门控）
//   - keydriver:setBackgroundColor 渲染进程 → 主进程，主题切换时同步窗口底色
'use strict';

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');

// ⚠️ 关键：Chromium 自带一份 HID 屏蔽名单（默认会拦掉某些 HID 设备，**其中包含不少键盘**，
// 目的是防键盘记录）。被拦的设备在 navigator.hid.requestDevice() 里**根本不会出现**，
// 表现就是「官方 VIA 能识别、我们的应用读不到设备」。Electron 官方文档给出的解法就是关掉它。
app.commandLine.appendSwitch('disable-hid-blocklist');

// 单实例锁（BugFix B）：WebHID 设备同一时刻只能被一个实例独占，双实例会互相抢占——
// 第二实例连接失败或两个实例写入全挂（QA 观察到用户机器上双 KeyDriver 进程并存）。
// 标准桌面实践：抢锁失败直接退出（第二进程秒退，用户落回已有窗口）；再次启动时聚焦已有窗口。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let mainWindow = null;
/** 渲染进程推送的未保存改动数（keydriver:setDirtyCount）；关窗门控依据。 */
let dirtyCount = 0;
/** 关窗拦截状态：用户确认放弃更改后置位，放行下一次 close。 */
let forceClose = false;

/** 首帧底色 = --color-bg 令牌基值（src/styles/index.css @theme 暗色基值），消除白闪。 */
const BG_DARK = '#0f1115';

/** 校验渲染进程传来的颜色串，只接受 #rrggbb 形态（防任意字符串注入 Chromium）。 */
function safeColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

ipcMain.on('keydriver:setDirtyCount', (_event, value) => {
  const n = Number(value);
  dirtyCount = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
});

ipcMain.on('keydriver:setBackgroundColor', (event, value) => {
  const color = safeColor(value);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (color && win) win.setBackgroundColor(color);
});

/**
 * 关窗拦截（T06-3）：存在未保存改动时弹原生确认框。
 *  - 无脏值 / 已确认放弃：直接放行；
 *  - 有脏值且未确认：preventDefault + showMessageBox（含改动计数与保存建议）。
 */
function setupCloseGuard(win) {
  win.on('close', (event) => {
    if (forceClose || dirtyCount <= 0) return;
    event.preventDefault();
    dialog
      .showMessageBox(win, {
        type: 'warning',
        message: `有 ${dirtyCount} 项未保存的改动`,
        detail: '关闭窗口会丢失这些改动。建议先「保存全部」（⌘/Ctrl+S）再退出。',
        buttons: ['取消', '放弃更改并关闭'],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (response === 1) {
          forceClose = true;
          win.close();
        }
      })
      .catch(() => undefined);
  });
  // 窗口销毁后复位守卫，避免影响下一个窗口
  win.on('closed', () => {
    forceClose = false;
    dirtyCount = 0;
  });
}

/**
 * WebHID 授权钩子（关键，缺一不可）。
 *
 * ⚠️ 浏览器（Chrome）里 navigator.hid.requestDevice() 由浏览器自己弹选择器，
 * 但 **Electron 不会**——必须由主进程接管，否则点了「授权设备」也是静默无反应。
 * 三个钩子缺一不可（钩子挂在窗口自己的 session 上，官方推荐写法）：
 *   1. select-hid-device         —— requestDevice() 被调用时，由主进程决定选哪个设备
 *   2. setPermissionCheckHandler —— 允许 'hid' 权限查询
 *   3. setDevicePermissionHandler —— 给渲染进程授予该 HID 设备的访问权
 */
function setupWebHidPermissions(ses) {
  // 1. 设备选择：单个直接选；多个弹原生对话框让用户挑（避免误选鼠标等其他 HID）
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const list = (details && details.deviceList) || [];
    // 排查用日志：从终端运行（npm run dev:app）时可见；打包应用可在「控制台.app」里看
    console.log(`[KeyDriver] select-hid-device 触发，候选设备 ${list.length} 台`);
    for (const d of list) {
      console.log(`  · ${d.name || '未命名'} VID=${d.vendorId} PID=${d.productId}`);
    }
    if (list.length === 0) {
      callback(undefined);
      return;
    }
    if (list.length === 1) {
      callback(list[0].deviceId);
      return;
    }
    dialog
      .showMessageBox(mainWindow, {
        type: 'question',
        message: '选择要连接的 HID 设备',
        detail: list
          .map((d, i) => `${i + 1}. ${d.name || '未命名设备'}  [VID ${d.vendorId} / PID ${d.productId}]`)
          .join('\n'),
        buttons: list.map((d) => d.name || '未命名设备'),
        cancelId: -1,
      })
      .then(({ response }) => {
        callback(response >= 0 && response < list.length ? list[response].deviceId : undefined);
      })
      .catch(() => callback(undefined));
  });

  // 2. 权限查询：允许 hid（file:// 生产模式与 http://localhost 开发模式都放行）
  ses.setPermissionCheckHandler((_webContents, permission) => permission === 'hid');

  // 3. 设备授权：授予 HID 设备访问权（作用域是用户选中的那台）
  ses.setDevicePermissionHandler((details) => details.deviceType === 'hid');
}

/**
 * 创建并配置原生应用窗口。
 * 开发模式加载 localhost（Vite dev server）；生产模式加载打包后的本地 HTML。
 */
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    // T06-1：最小窗口 960×640 —— 布局按 960 宽画布设计（窄窗时侧栏收图标、键码面板折叠）
    minWidth: 960,
    minHeight: 640,
    // T06-1：首帧底色 = --color-bg 令牌基值（暗色），消除窗口创建到 React 首绘之间的白闪
    backgroundColor: BG_DARK,
    title: 'KeyDriver',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // T06-3：唯一 IPC bridge（contextBridge 暴露 window.keydriver）
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow = win;

  setupCloseGuard(win);
  // 钩子必须挂在**这个窗口**的 session 上（官方推荐；默认 partition 下即 defaultSession）
  setupWebHidPermissions(win.webContents.session);

  const isDev = process.argv.includes('--dev');
  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
}

// 标准应用生命周期。
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
