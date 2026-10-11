#!/usr/bin/env python3
"""生成带自定义界面的 DMG 安装器（无需 Finder 自动化授权）。

dmgbuild 直接写 .DS_Store，规避 macOS「自动化」权限弹窗与失败。
用法：python3 scripts/dmg/make-dmg.py [版本号]
"""
import os
import sys

import dmgbuild

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
APP = os.path.join(ROOT, "src-tauri/target/release/bundle/macos/KeyDriver Lite.app")
BG = os.path.join(HERE, "dmg-background.png")
VERSION = sys.argv[1] if len(sys.argv) > 1 else "0.1.0"
OUT = os.path.join(ROOT, f"src-tauri/target/release/bundle/dmg/KeyDriver Lite_{VERSION}_aarch64.dmg")

if not os.path.isdir(APP):
    sys.exit(f"未找到应用包：{APP}（先跑 npx tauri build）")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
if os.path.exists(OUT):
    os.remove(OUT)

# 660×400 窗口（bounds 含标题栏余量），左 App / 右 Applications，箭头背景
settings = {
    "format": "UDZO",
    "files": [APP],
    "symlinks": {"Applications": "/Applications"},
    "icon_locations": {
        "KeyDriver Lite.app": (175, 235),
        "Applications": (490, 235),
    },
    "background": BG,
    "window_rect": ((200, 120), (860, 520)),
    "icon_size": 110,
    "text_size": 14,
    "show_icon_preview": True,
    "show_item_info": False,
    "arrange_by": None,
    "grid_offset": (0, 0),
    "grid_spacing": 100,
    "scroll_position": (0, 0),
    "label_pos": "bottom",
    "license": None,
}

dmgbuild.build_dmg(
    filename=OUT,
    volume_name="KeyDriver Lite",
    settings=settings,
)

size_mb = os.path.getsize(OUT) / 1024 / 1024
print(f"✅ {OUT}")
print(f"   体积：{size_mb:.1f} MB")
