---
name: pm-spec-doc-mode
version: "0.3.0"
description: 给HTML原型页面注入文档模式系统（悬浮按钮 + iframe预览 + 标注编辑 + 智能Tab + 移动端适配）。支持弹窗/视图/Tab三级上下文自动检测、Tab动态显隐、手机端页面自动50%布局。PC端和APP端通用。触发词：给页面加文档模式、注入悬浮球。
---

# 悬浮球文档模式（标注 + 页面说明）

> **引擎文件**：`scripts/doc-mode.js`（独立 JS 文件，部署时写入目标项目的 `shared/doc-mode.js`）  
> **作用**：注入「📄 文档」悬浮按钮 → 文档模式（左侧iframe预览 + 右侧智能Tab + 页面标注编辑 + 移动端自动布局）

给HTML原型页面注入「文档模式」系统，支持左侧页面预览 + 右侧面板（页面说明 + 内联标注标签） + 页面标注编辑功能。

标注功能**无需密码**，直接点击「标注」即可进入编辑模式。

## 注入方式

所有页面共享同一个文件 `shared/doc-mode.js`，包含完整的 CSS 和 JS 逻辑。  
在每个 HTML 文件的 `</body>` 标签前加两行：

```html
<!-- ======PROD_IGNORE_START 文档模式系统 ====== -->
<script>window._dm_md_file = '页面名.md';</script>
<script src="../shared/doc-mode.js?v=3"></script>
<!-- ======PROD_IGNORE_END====== -->
```

**`window._dm_md_file` 必须在 `<script src>` 之前声明**，告诉引擎加载哪个 MD 文件。如果省略，引擎会尝试从 URL 自动猜测文件名，可能找不到或找错。

**标注数据以 `[页面名]标注.json` 文件形式存放在 HTML 所在目录。标注引用直接写在页面说明 MD 中，用 `*（标注N）*` 格式。**

## 文件结构

```
模块目录/
  页面名.html                 # 页面文件
  页面名.md                   # 产品说明文档（右侧面板展示，含内联标注引用）
  页面名标注.json             # 标注数据（自动保存/加载，带缓存绕过）
shared/
  doc-mode.js                 # 统一文档模式系统（所有页面共享）
```

## 功能特性

| 特性 | 说明 |
|------|------|
| 📄 文档悬浮按钮 | 右下角按钮（📄 文档 ×），点击打开文档模式后变浅绿色；× 关闭按钮关闭后同Tab内不再出现，刷新页面恢复 |
| 📖 文档模式 | 左侧页面预览（iframe）+ 右侧面板（页面说明，标注引用渲染为绿色标签） |
| 📐 展开侧栏 | 点击分隔条（左/右面板之间的8px竖线），右侧面板展开到50vw宽度，左侧页面压缩；再次点击恢复 |
| ✏️ 标注编辑 | hover 高亮元素 → 点击自动创建标注框，8向handle拖动拉伸 |
| 🔢 编号改名 | 编辑模式下点击方形编号 → 输入任意正整数（可重复、改/删不影响其他标注，新增默认 max+1） |
| 📍 XPath锚点 | 标注绑定元素XPath + 文本兜底 + scaleW/scaleH比例，缩放不丢 |
| 💾 自动保存 | 点「✓ 完成」：已授权直接保存 / 未授权弹文件夹选择器 / 不支持则下载 |
| 💬 标注引用 | `*（标注N）*` 内联写在页面说明MD中，渲染为绿色标签，hover整框弹出tooltip |
| 🏷️ 视图上下文 | 自动识别标注所属容器（主页面/弹窗）+ Tab，弹窗关闭或Tab切换时自动隐藏无效标注 |
| 📊 无角标 | 悬浮按钮不显示数量角标 |
| 🔗 跨Tab独立 | 标注按 `容器ID|Tab标识` 独立分组，切换Tab时只显示当前Tab绑定标注，每个Tab视为独立页面 |
| 🚫 防重复标注 | 同一元素（相同XPath）只允许标注一次，重复点击不创建新标注 |
| 💨 防闪烁 | hover时不隐藏标注框DOM，仅预检查鼠标位置是否在框内，避免反复show/hide导致闪烁 |
| 🧠 智能Tab | 根据MD文件存在情况自动决定：双MD→显示双Tab（标注优先）；单MD→隐藏Tab直接展示内容 |
| 💻 围栏代码块 | 支持 ``` 代码块渲染，自动HTML转义、语言标识符隐藏、浅灰背景+圆角边框样式 |
| 📱 移动端适配 | 自动检测手机端页面（`.mobile-app`元素）→ 强制左右各50%布局，不依赖浏览器视口宽度 |

## 工具栏按钮

| 按钮 | 显示条件 | 功能 |
|------|----------|------|
| 标注 | 非编辑 | 进入标注编辑模式 |
| ✓ 完成 | 编辑中 | 保存标注数据并退出编辑 |
| 退出编辑 | 编辑中 | 放弃当前编辑，恢复进入前的快照 |

## 标注浏览（非编辑）

- 右下角「📄 文档」悬浮按钮，打开后变浅绿色 `#e6f7ee`
- 标注框：橙色边框 + 方形编号（左上角）+ "说明"标签（有说明时显示）
- **hover 整框**自动弹出说明 tooltip：JS 动态计算最佳位置（上方/下方），约束宽度不超出 iframe 视口，箭头指向框中心
- 标注框有 `pointer-events:auto`，hover 任意区域都触发 tooltip
- 标注数据**优先**从同目录 `页面名标注.json` 加载（fetch + `?v=timestamp` 绕过缓存），加载成功后同步写入 localStorage
- JSON 文件不存在时回退读 localStorage（用户编辑中未保存到文件的场景）


## 标注编辑模式

### 进入编辑
点击「标注」→ 进入编辑模式，不重建已有标注框

### hover 高亮
- 鼠标移到页面元素上自动显示绿色虚线高亮框
- `requestAnimationFrame` 节流 + 原地更新样式（不删除DOM，不触发回流）
- 鼠标在已有标注框上时高亮自动隐藏（display:none，不删DOM）
- `withoutDmElements` 排除 `_dm_box_*` 元素，避免标注框被临时隐藏闪烁

### 点击创建
- 点击 hover 元素 → 标注框自动匹配元素 `getBoundingClientRect`
- 锚点数据：XPath + keyTexts（文本兜底）+ scaleW/scaleH（跟随锚点缩放）
- 标注框动画 `_dm_box_pop` 内联设置，只在创建时播放一次

### 拖动拉伸
- 8向 handle 可拖动/拉伸扩大标注范围
- 拖动后更新 `anchorOffsetX/Y` + `anchorW/H` + `scaleW/H`
- 宽高跟随锚点元素等比缩放（不是文档全宽百分比）
- `repositionAllBoxes()` 编辑模式下 resize 不删DOM只更新位置

### 点击编号改名
- 点击左上角方形编号 → `prompt` 输入新序号
- 重新排序标注数组，重分配连续 ID 并保存

### 防闪烁机制
1. hover 高亮原地更新（不删除重建）→ 不触发回流
2. `findHoverTarget` 预检查鼠标是否在标注框内 → 不隐藏框DOM，不触发 `display:none` 闪烁
3. `findHoverTarget` 只临时隐藏单个 hover 高亮元素（`position:absolute`，不触发回流）
4. `_dm_box_pop` 动画内联 → 编辑模式不重播
5. `hideHoverHighlight` 只设 display:none 不删DOM
6. `repositionAllBoxes` 拖动/缩放时跳过，避免与用户操作冲突

### XPath锚点关键规则
1. **class匹配**：使用 `contains(concat(" ", @class, " "), " classname ")` 而非 `@class="classname"`。因为元素可能有 `active`、`show` 等状态类导致精确匹配失败 → 标注错位到下一个同名元素
2. **下标索引**：同名同类兄弟元素自动加 `[N]`（1-based），统计时用基础class（排除 `active` 等状态类）
3. **唯一性验证**：XPath 生成后通过 `doc.evaluate` 验证唯一性，非唯一则继续扩展路径直到唯一
4. **文本兜底**：XPath 失效时通过 `keyTexts` 文本匹配定位元素

## 标注数据存储

### JSON 格式
```json
{
  "annotations": [
    {
      "id": 1, "x": 449, "y": 791, "w": 568, "h": 44,
      "xpath": "//tr[15]/td[2]",
      "keyTexts": ["示例标签文字"],
      "anchorOffsetX": 0, "anchorOffsetY": 0,
      "anchorW": 270, "anchorH": 45,
      "scaleW": 1, "scaleH": 1,
      "xPct": 0.38, "yPct": 0.93, "wPct": 0.32, "hPct": 0.05,
      "context": "main"
    },
    {
      "id": 2, "x": 500, "y": 300, "w": 200, "h": 40,
      "xpath": "//*[@id=\"configOverlay\"]/div[contains(concat(\" \", @class, \" \"), \" config-tab \")][4]",
      "keyTexts": ["配置项标签文字"],
      "anchorOffsetX": 0, "anchorOffsetY": 0,
      "anchorW": 175, "anchorH": 40,
      "scaleW": 1, "scaleH": 1,
      "xPct": 0.39, "yPct": 0.18, "wPct": 0.2, "hPct": 0.05,
      "context": "configOverlay|tab1"
    }
  ],
  "scrollY": 0
}
```

**context 字段说明：**
- `"main"` — 主页面标注，始终显示
- `"configOverlay"` — 弹窗标注（无Tab），仅弹窗打开时显示
- `"configOverlay|tab1"` — 弹窗 + 特定Tab标注，仅该Tab激活时显示
- `"unboundView"` / `"boundView"` — 页面内视图切换标注（如未绑定/已绑定态通过 display:none/block 切换），仅对应视图可见时显示
- 系统三级自动检测：
  1. 弹窗/遮罩层（`position:fixed` 或 id 含 `overlay/modal`）
  2. 页面内可切换视图（有 `id` 且 `style.display` 被JS切换的容器）
  3. 活跃Tab（`.config-tab.active` 等）
- 弹窗开闭、Tab切换、视图切换均由 MutationObserver 监听（属性变化 + 子节点增删），标注自动显隐

**xpath 格式说明：**
- 使用 `contains(concat(" ", @class, " "), " classname ")` 做CSS-class级别匹配（非精确匹配），兼容 `class="active other"` 等多class元素
- 同名同类兄弟元素自动加位置下标 `[N]`（1-based），确保XPath唯一
- 基础class统计排除 `active`、`show` 等状态类，只按元素类型class计数

### 保存流程
1. 已授权 → File System Access API 直接写入同目录 `页面名标注.json`
2. 未授权 → 弹出文件夹选择器授权 → 写入
3. 不支持 FS API → `fallbackDownload()` 自动下载 JSON

### 加载优先级
加载时只读取同目录 `页面名标注.json`（fetch + cache绕过），不依赖 localStorage。

## 标注位置标记（写在页面说明 MD 中）

标注说明不再使用独立的 `页面名标注.md` 文件，而是**直接写在页面说明 MD 文档中**，用 `*（标注N）*` 格式在文中插入绿色标注位置标签。

### 格式规范

在页面说明 MD 的描述文字中，用斜体包裹中文全角括号的标注位置标记：

```markdown
# 单个标注
「适用模块」更名为「**适用场景**」*（标注1）*，筛选条件和列表表头同步更名

# 多个标注组合（同一变更点涉及多个标注时）
「适用模块」更名为「**适用场景**」*（标注1、3）*，筛选条件和列表表头同步更名

# 表格中使用
| 3 | 适用场景*（标注3）* | 该模板适用的业务场景 |

# ** 和 * 之间必须加空格，避免渲染异常
**适用场景新增选项** *（标注1）*：在原有选项基础上新增...
```

**渲染效果**：`*（标注N）*` → 绿色背景标签 <span style="color:#18A55D;font-weight:600;background:#e8f8ef;padding:1px 6px;">（标注N）</span>

### 规则

- 格式必须是 `*（标注N）*`：星号 + 中文全角括号 + "标注" + 数字 + 中文全角括号 + 星号
- 多个标注组合：`*（标注1、3）*`，用顿号分隔，不加空格
- 写在页面说明 MD 的文字流中，不要单独成行
- `**` 和 `*` 相邻时必须加空格（如 `**选项** *（标注1）*`），否则 Markdown 渲染异常
- 标注位置标签仅作为视觉引导，标注框的实际位置由 JSON 中的 xpath/坐标决定
- 右侧面板展示页面说明时，`*（标注N）*` 自动渲染为绿色标签

### 标注与文档的对应关系

每个标注指向页面上的一个具体元素（筛选标签、表头、按钮等），在 MD 文档中应在**描述该元素的文字旁边**插入对应的标注引用。当一个变更同时涉及多个位置（如筛选标签 + 列表表头同步更名），用组合标注 `*（标注1、3）*` 表达。

### 标准工作流

1. 用户在页面中完成标注（进入文档模式 → 标注 → 完成）
2. 标注数据自动保存到 `[页面名]标注.json`
3. AI 读取标注 JSON，识别每个标注指向的元素（通过 xpath、keyTexts）
4. AI 在页面说明 MD 的对应位置插入 `*（标注N）*` 引用
5. 保存 MD 文件，重新打开文档模式即可看到绿色标签

### 更新方式
- 直接编辑 `[页面名].md` 或让 AI 更新
- 修改后保存，重新打开文档模式即可看到更新（fetch 带时间戳不被缓存）

## MD文档渲染规则

doc-mode.js 内置轻量级 Markdown→HTML 渲染器（`mdToHtml` 函数），支持以下语法：

| 语法 | 渲染效果 |
|------|----------|
| `# 标题` / `## 标题` / `### 标题` | h1 / h2 / h3 标题，黑色字体 |
| `**加粗**` | `<strong>` 加粗，黑色字体 |
| `*斜体*` | `<span class="_dm_mark">` 绿色高亮标签 |
| `` `行内代码` `` | `<code>` 行内代码块 |
| ```代码块``` | `<pre><code>` 围栏代码块，浅灰背景+圆角边框 |
| `[text](url)` | `<a>` 可点击链接，蓝色下划线 |
| `| 表格 |` | `<table>` 表格，自动处理分隔行 |
| 纯URL | 自动转为可点击链接 |

### 围栏代码块渲染

MD文档中使用 ``` 包裹的代码块会被渲染为带样式的代码区域：

- **提取时机**：在 HTML 转义之前提取，保护代码内容不被后续处理破坏
- **HTML转义**：代码内容自动转义 `<` `>` `&`，防止被当成 HTML 标签渲染
- **语言标识符**：```json、```javascript 等语言标记被自动隐藏，不显示在页面上
- **样式**：浅灰背景 `#f6f8fa`、边框 `#e1e4e8`、圆角 8px、12px 等宽字体、自动换行
- **`<p>` 包裹排除**：`<pre>` 块不会被误包进 `<p>` 标签

**渲染流程**：

```
原始MD → 提取```代码块（占位符保护）→ 链接保护 → HTML转义 → 还原代码块（<pre><code>）→ 标题/加粗/斜体/行内代码 → 表格处理 → <p>包裹（排除<pre>）→ URL自动链接
```

## 智能Tab动态显隐

右侧面板的Tab栏根据MD文件存在情况自动调整：

| 场景 | Tab栏 | 默认展示 |
|------|--------|----------|
| 有页面说明MD | 展示页面说明内容（标注引用渲染为绿色标签） |
| 没有页面说明MD | 显示空状态提示 |

**实现逻辑：** `enterDocMode()` 中 `loadMdDoc()` 加载页面说明MD完成后，右侧面板直接展示内容，`*（标注N）*` 自动渲染为绿色标签。

## 移动端页面自动布局

对于手机端页面，文档模式自动应用移动端布局：

- **检测机制：** 页面加载时检测是否存在 `.mobile-app` 元素（`max-width:375px` 容器），或同时满足 viewport meta 含 `maximum-scale` 且 URL 在手机端页面目录
- **布局效果：** 强制左右各 50% 并排（`flex-direction: row`），左侧iframe预览 + 右侧说明面板
- **不依赖视口宽度：** 即使在桌面浏览器上查看手机页面，也能正确呈现50/50布局
- **PC端不受影响：** PC端页面保持原有布局（左侧自适应 + 右侧 420px）

**实现逻辑：** `createDOM()` 末尾调用 `detectMobilePage()`，检测到手机端页面时注入 `_dm_mobile_force` 样式表（使用 `!important` 强制覆盖）。

## 缓存控制

HTML 引用 `doc-mode.js` 时应加版本号参数，避免浏览器缓存旧版 JS：

```html
<script src="../shared/doc-mode.js?v=3"></script>
```

每次修改 `doc-mode.js` 后，递增版本号（`?v=4`、`?v=5`...）强制刷新缓存。

---

## 快速上手：给新页面搭文档体系

另一个 AI 拿到这份说明后，按以下步骤即可为任意 HTML 页面建立文档体系：

### 第 0 步：复制引擎文件（仅首次）

**需要将 `scripts/doc-mode.js` 引擎文件复制到目标项目的 `shared/doc-mode.js`。** 该文件包含完整逻辑（悬浮按钮、iframe预览、标注系统、视图上下文检测），所有页面共享，不要修改。

```
目标项目/
└── shared/
    └── doc-mode.js    ← 从本技能的 scripts/doc-mode.js 复制此文件
```

### 第 1 步：确认页面文件结构

```
目标目录/
├── 页面.html               # 已有页面
├── 页面.md                 # 需创建：产品说明文档（含内联标注引用）
└── 页面标注.json           # 自动生成：标注数据
```

> `shared/` 目录放在项目根目录或与页面同级的父目录均可，只需确保 HTML 中的引用路径正确。

### 第 2 步：HTML 中注入脚本

在页面 `</body>` 前加两行（**`_dm_md_file` 必须在 `src` 之前**）：

```html
<!-- ======PROD_IGNORE_START 文档模式系统====== -->
<script>window._dm_md_file = '页面名.md';</script>
<script src="../shared/doc-mode.js?v=3"></script>
<!-- ======PROD_IGNORE_END====== -->
```

- 如果 `shared/` 在项目根目录，页面在子目录中 → `../shared/doc-mode.js?v=3`
- 如果 `shared/` 与页面同级 → `shared/doc-mode.js?v=3`
- **只需引用 `doc-mode.js` 一个文件**，它已包含所有功能（悬浮按钮 + 标注 + 文档预览 + 智能Tab + 移动端适配）
- **版本号 `?v=3`** 用于缓存控制，每次修改 doc-mode.js 后递增

### 第 3 步：创建产品说明 MD

在同目录创建 `页面名.md`。

#### MD文档格式规范

**头部字段（必填）**：

```markdown
# 页面名页面说明

所属端：xxx

所属页面：xxx.html

是否为新页面：是 / 否
```

- 所属端、所属页面、是否为新页面 分三行
- 是否为新页面：标识本次需求是新建页面还是已有页面改造，研发据此判断影响范围

**章节结构**（两种模式共享 6 章，仅第三章名称不同）：

| 章节 | 新页面 | 迭代页面 |
|------|--------|----------|
| 一、需求背景与目标 | 必填 | 必填 |
| 二、用户角色与适用场景 | 必填 | 必填 |
| 三、本次新增内容 / 本次修改内容 | 必填 | 必填 |
| 四、功能详细说明 | 必填 | 必填 |
| 五、异常处理（四列表格） | 必填 | 必填 |
| 六、验收标准 | 必填 | 必填 |

**格式要点**：

- 标题用 `# 页面名页面说明`
- 章节用中文数字（一、二、三...），子项用阿拉伯数字（1. 2. 3.）
- 子项的子项用（1）（2）（3）
- 功能标题用「功能1、功能2」不用「模块」
- ★为纯文本星号不用emoji
- 不使用---分隔线

### 第 4 步：验证

```bash
cd 项目根目录 && python3 -m http.server 8888
```
访问 `http://localhost:8888/目录/页面.html`，右下角应有「📄 文档」悬浮按钮。

### 注意事项
- 产品说明 MD 必须与 HTML **同目录、同名不同后缀**
- 标注 JSON 是同目录的 `页面名标注.json`（自动生成，无需手动创建）
- 脚本文件放在 `shared/` 目录，引用的相对路径可能因目录深度不同需调整
- 脚本引用需带版本号 `?v=N`，每次修改 doc-mode.js 后递增，避免浏览器缓存旧版
- 手机端页面（含 `.mobile-app` 容器）会自动应用50/50布局，无需额外配置
- 如果页面没有页面说明MD，右侧面板显示空状态提示
- 所有 PROD_IGNORE 代码块在正式部署时需删掉

## 已知陷阱与修复经验

### getComputedStyle 不继承 display:none

**现象**：页面内有多个视图通过 `display:none/block` 切换（如 `unboundView` / `boundView`），标注框本应只在当前视图显示，但其他视图的标注也出现在当前页面上。

**根因**：`getComputedStyle(childElement).display` **不会继承父元素的 `display:none`**。当一个元素的祖先容器设置了 `display:none` 时，该元素自身的 computedStyle.display 仍返回其自身值（如 `block`、`inline`），而非 `none`。

```javascript
// 错误写法：只检查元素自身，无法感知祖先隐藏
var cs = getComputedStyle(element);
if (cs.display === 'none') return false; // ← 不会命中

// 正确写法：遍历祖先链检查
var ancestor = element.parentElement;
while (ancestor && ancestor !== doc.body) {
  var ancCs = getComputedStyle(ancestor);
  if (ancCs.display === 'none' || ancCs.visibility === 'hidden') return false;
  ancestor = ancestor.parentElement;
}
```

**影响范围**：所有通过 `display:none` 做视图切换的页面（如未绑定/已绑定态切换）。

**修复位置**：`shouldShowAnnotation()` 函数的「步骤0：锚点元素可见性检查」中，在检查元素自身样式后，必须增加祖先链遍历。

### iframe 内页面导航后标注框残留

**现象**：iframe 加载的页面发生内部跳转（如点击列表项跳转到新页面），返回后旧标注框仍显示在新页面上。

**根因**：`iframe.onload` 触发时，旧的标注框 DOM 节点仍存在于 iframe body 中，但新页面的 DOM 结构已完全不同。

**修复方式**：在 `iframe.onload` 开头先清理所有旧的 `._dm_box` 元素，再执行正常的渲染流程。

### 浏览器缓存导致修改不生效

**现象**：修改了 `doc-mode.js` 但浏览器仍加载旧版本。

**解决**：每次修改 `doc-mode.js` 后，更新 HTML 中的引用版本号 `?v=N`（如 `doc-mode.js?v=4`），并建议用户强制刷新（Cmd+Shift+R）。

### 编辑快照丢失 context 字段导致退出编辑后标注全部显示

**现象**：进入标注编辑模式后再点击“退出编辑”，原本隐藏的标注（如 boundView/hasCustomerView 上下文中的标注）全部错误地显示出来。

**根因**：`enterAnnotateMode()` 创建快照时只保存了 `{id, x, y, w, h}` 五个字段，丢失了 `context`、`xpath`、`keyTexts` 等关键字段。`abortAnnotate()` 恢复快照后，所有标注的 context 变成 `undefined`，在 `shouldShowAnnotation()` 中被默认当作 `"main"`（始终显示），导致所有标注全部显示。

```javascript
// 错误写法：只保存部分字段，context 丢失
annoSnapshot = annotations.slice().map(function(a) {
  return { id: a.id, x: a.x, y: a.y, w: a.w, h: a.h };
});

// 正确写法：深拷贝完整标注对象
annoSnapshot = JSON.parse(JSON.stringify(annotations));
```

**影响范围**：所有包含多视图切换的页面（任何使用 context 字段控制标注显隐的场景）。

**修复位置**：`enterAnnotateMode()` 函数中的快照创建逻辑。

### 原生 prompt/alert 在 webview 沙箱中被拦截

**现象**：编辑模式下点击标注编号修改时，弹窗不弹出，无法操作。

**根因**：`changeAnnoId()` 使用了浏览器原生 `prompt()` 弹窗，Qoder 预览面板的 webview 沙箱会拦截原生对话框（`prompt`/`confirm`/`alert`）。

**解决**：用自定义 HTML 弹窗 `showPromptDialog()` 替代原生 `prompt()`。弹窗创建在 iframe 文档内，包含输入框、确定/取消按钮，支持 Enter 确认、Escape 取消、点击遮罩关闭。弹窗元素 `#_dm_prompt_overlay` 已从标注系统的 hover/点击逻辑中排除，不会被误标注。

**影响范围**：所有在 webview/沙箱环境中运行的页面。

### position: absolute 导致标注框跟随页面/弹窗滚动

**现象**：页面上下滚动或弹窗内部滚动时，标注框跟着内容一起移动，出现 1-2 秒的迟钝感才回到正确位置。

**根因**：标注框使用 `position: absolute` 定位在 iframe body 上，坐标为文档绝对坐标（`rect.top + scrollY`）。页面滚动时 body 内容整体移动，标注框自然跟随。即使加 scroll 事件 + setTimeout/rAF 重定位，也会有一帧以上的延迟。

**修复方式**：改为 `position: fixed` + 视口坐标（不加 scrollY）。

```javascript
// 错误写法：absolute + 文档绝对坐标
'._dm_box { position:absolute;... }'
y = rect.top + scrollY + offset

// 正确写法：fixed + 视口坐标
'._dm_box { position:fixed;... }'
y = rect.top + offset
```

**注意事项**：
- `getBodyDim()` 的 h 必须改为 `innerHeight`（视口高度），不能用 `scrollHeight`
- 所有涉及 `scrollY` 的地方（`setAnchorOnTarget`、`updateAnchorOffsetForAnnotation`、`showHoverHighlight` 等）都要去掉 scrollY
- hover 高亮框也要同步改为 `position: fixed`

### 标注框跟随滚动的三层监听

**现象**：文档模式下滚动页面时，标注框跟着内容移动，过 1-2 秒才回到正确位置。

**根因**：`position: fixed` 让标注框锁定在 iframe 视口位置不动，但锚点元素随页面/容器滚动而移动。如果滚动事件没有监听，标注框只在 2 秒定时器触发时才重定位，产生明显延迟。

**滚动来源有三层，必须全部监听**：

1. **iframe 主窗口滚动**（最常见）：用户滚动页面内容时，锚点元素移动。overflow 容器循环显式跳过了 `body` 和 `documentElement`，所以必须单独监听 iframe `window` 的 scroll 事件。
2. **iframe 内 overflow 容器滚动**：弹窗内部、Tab 栏等有 `overflow: auto/scroll` 的容器。
3. **外层 `._dm_left` 面板滚动**：左侧预览容器有 `overflow: auto`，iframe 随其滚动移动。

**修复代码**（`startContextWatcher()` 内）：

```javascript
// 1. iframe 主窗口滚动：position:fixed 标注框不动，但锚点元素随内容移动
doc.defaultView.addEventListener('scroll', onAnyScroll);

// 2. overflow 容器滚动（弹窗内部、Tab 栏等）
var allEls = doc.querySelectorAll('*');
for (var oi = 0; oi < allEls.length; oi++) {
  var oEl = allEls[oi];
  if (oEl === doc.body || oEl === doc.documentElement) continue;
  var oCs = doc.defaultView.getComputedStyle(oEl);
  if (/auto|scroll/.test(oCs.overflowX + '|' + oCs.overflowY + '|' + oCs.overflow)) {
    oEl.addEventListener('scroll', onAnyScroll);
  }
}

// 3. 外层左侧面板滚动
var outerLeft = document.getElementById('_dm_left');
if (outerLeft) {
  outerLeft.addEventListener('scroll', onAnyScroll);  // onAnyScroll 用外层 rAF
}
```

**注意**：`onAnyScroll` 内用 `requestAnimationFrame` 防重入，每帧最多重定位一次。

### overflow 容器查找不能只靠内联样式和硬编码 class

**现象**：弹窗内部的滚动容器（如 `.config-body` 的 `overflow-y: auto`）未被监听到，导致弹窗内滚动时标注框不跟随。

**根因**：之前的 overflow 容器查找用了 `[style*="overflow"]`（只匹配内联样式）和硬编码 class（`.platform-tabs` 等）。CSS 样式表定义的 overflow 属性完全不会被匹配到。

```javascript
// 错误写法：只能找到内联样式和特定 class
var overflowEls = doc.querySelectorAll('[style*="overflow"], .platform-tabs, .tab-bar');

// 正确写法：遍历所有元素，检查 getComputedStyle
var allEls = doc.querySelectorAll('*');
for (var i = 0; i < allEls.length; i++) {
  var cs = getComputedStyle(allEls[i]);
  if (/auto|scroll/.test(cs.overflowX + '|' + cs.overflowY + '|' + cs.overflow)) {
    allEls[i].addEventListener('scroll', onAnyScroll);
  }
}
```

**影响范围**：任何有 CSS 样式表定义 overflow 的页面（弹窗、抽屉、下拉列表等）。

---

