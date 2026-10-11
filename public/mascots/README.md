# 官方素材替换位（吉伊卡哇主题）

把手绘版换成官方素材：把图片放进本目录，再把 `src/ui/brand/mascots.tsx` 里的
`MASCOT_USE_ASSETS` 改成 `true`，无需改任何组件代码。

## 文件命名

`<角色>-<情绪>.png`，例如：

```
chiikawa-idle.png     吉伊 · 平常
chiikawa-peek.png     吉伊 · 探头（空态用它）
chiikawa-worry.png    吉伊 · 担心（出错 Toast 用它）
hachiware-idle.png    哈奇 · 平常（提示 Toast）
hachiware-wait.png    哈奇 · 等待（加载态）
hachiware-peek.png    哈奇 · 台词气泡
usagi-happy.png       乌萨奇 · 开心（成功 Toast）
usagi-wait.png        乌萨奇 · 等待（加载态排队）
```

角色：`chiikawa` / `hachiware` / `usagi`
情绪：`idle` / `happy` / `wait` / `peek` / `worry`

## 图片要求

- 格式：PNG（透明底最佳）；SVG 亦可，但需改 `mascotAssetUrl()` 的扩展名
- 构图：**正方形、角色居中、四周留少量空白**，主体占画面 80% 左右
- 尺寸：建议 ≥ 256×256（界面最大用到 96px，2x 屏下 192px）
- 背景：透明优先；白底也行（浅色主题下不违和，深色主题会有白框）

## 缺失怎么办

任一文件缺失或加载失败 → 该处自动回退到手绘 SVG，界面不会开天窗。
所以可以先放一部分，缺的用手绘顶着。
