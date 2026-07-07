# slide-alchemy 与 image-to-editable-ppt-skill 转 PPT 全链路溯源

项目：

- `slide-alchemy`
- `image-to-editable-ppt-skill`

---

## 1. slide-alchemy 全链路

### 1.1 项目形态

`slide-alchemy` 是一个 Codex skill 风格项目，不是一个标准 Python package。它的核心在：

- workflow 文档约束每一步必须做什么；
- prompt 模板约束模型如何生成 clean base 和 asset sheet；
- Python scripts 负责切图、校验、组合 PPTX。

关键文件：

- `slide-alchemy/skill/slide-alchemy/SKILL.md`
- `slide-alchemy/skill/slide-alchemy/references/workflow.md`
- `slide-alchemy/skill/slide-alchemy/references/element-classification.md`
- `slide-alchemy/skill/slide-alchemy/references/base-prompt-template.md`
- `slide-alchemy/skill/slide-alchemy/references/icon-sheet-prompt-template.md`
- `slide-alchemy/skill/slide-alchemy/references/compose-spec.md`
- `slide-alchemy/skill/slide-alchemy/scripts/slice_asset_sheet.py`
- `slide-alchemy/skill/slide-alchemy/scripts/compose_component_pptx.py`

### 1.2 总流程

`slide-alchemy` 明确要求完整流程，不允许直接把源图塞进 PPT：

```text
输入 PPT/PDF/截图/图片
  -> 渲染为 source/slide_001.png
  -> base grouping
  -> 图像模型生成 clean base
  -> element_analysis.json
  -> 简单几何转 SVG/OOXML 或 PPT shape
  -> 图像模型生成 PNG asset sheet
  -> 切分 asset sheet 为透明 PNG
  -> OCR/视觉模型提取文本布局
  -> compose_spec.json
  -> compose_component_pptx.py 组合 PPTX
  -> 预览图和视觉 QA
```

### 1.3 目录产物

它期望的 run 目录大致是：

```text
run/
  source/
    slide_001.png
  base/
    slide_001_base.png
  analysis/
    element_analysis.json
    texts_layout.json
    compose_spec.json
  assets/
    svg/
    png/
    contact_sheets/
  out/
    editable.pptx
    preview/
```

### 1.4 第一步：source page rendering

输入可以是图片、PPTX、PDF、扫描页。无论原始格式是什么，先得到每页的源图：

```text
source/slide_001.png
source/slide_002.png
...
```

后续所有坐标都以 source image 的像素坐标为准。

### 1.5 第二步：base grouping

先判断哪些页面共享同一类背景，例如：

- 封面 base；
- 内容页 base；
- 结束页 base；
- 每页独立 base。

这是为了减少 clean base 生成次数，也避免每页背景风格飘。

`workflow.md` 要求默认在这里停一次给用户确认，除非用户明确要求 unattended/full automatic。

### 1.6 第三步：clean base 生成

clean base 是用图像编辑/生成模型生成的，不是本地抹除，也不是源图裁剪。

参考模板在：

`slide-alchemy/skill/slide-alchemy/references/base-prompt-template.md`

要求模型：

- 保留背景氛围、边缘装饰、渐变、纹理、光效；
- 移除所有文字、页码、标签、图标、徽章、卡片、框、标题栏、图表、中央内容；
- 自然补全被移除区域；
- 不留下 ghost text、模糊块、水印、伪文字。

输出：

```text
base/slide_001_base.png
```

这个 clean base 会作为最终 PPT 的底层全页图片。

### 1.7 第四步：元素分析

在生成前景资产前，先做 `element_analysis.json`。

它包含：

- `components`：可复用组件定义；
- `instances`：每页每个组件的位置；
- `png_asset_sheet_plan`：哪些组件需要生成 PNG asset sheet。

分类规则在：

`slide-alchemy/skill/slide-alchemy/references/element-classification.md`

核心分类：

| 分类 | 含义 | 处理方式 |
|---|---|---|
| `simple_geometry_svg_ooxml` | 线、分割线、圆、圆角矩形、卡片、边框等非语义布局几何 | 转 PPT 原生形状/OOXML |
| `icon_png` | 图标、徽章、设备、小插画、语义 pictogram | 用图像模型生成 PNG asset sheet，再切图 |
| `complex_png_whole` | 复杂插画、发光组合、复杂装饰、拆开会变差的视觉块 | 整体作为 PNG 资产 |

重点：语义图标即使看起来由简单线条组成，也默认不转 PPT shape，而是走 PNG。因为目标是视觉保真，不是拆到每根线可编辑。

### 1.8 第五步：PNG asset sheet 生成

需要 PNG 的组件会通过图像模型生成 asset sheet。

模板在：

`slide-alchemy/skill/slide-alchemy/references/icon-sheet-prompt-template.md`

要求模型：

- 以源图为视觉参考或编辑目标；
- 重新生成要拆出的 icon/complex visual；
- 用纯色 key-color 背景；
- 每个元素之间留足空白；
- 不包含普通文字、标签、网格线、卡片、框、标题栏；
- 不直接复制裁剪源图像素。

典型输出：

```text
assets/sheets/domain_sheet.png
assets/sheets/hardware_sheet.png
```

### 1.9 第六步：asset sheet 切分

切图脚本：

`slide-alchemy/skill/slide-alchemy/scripts/slice_asset_sheet.py`

它做的事情：

1. 读取 sheet PNG；
2. 根据 key color 把背景转透明；
3. 根据 JSON crop spec 裁剪每个资产；
4. 默认保留 padding；
5. 输出透明 PNG。

脚本核心输入：

```text
sheet_png
crops_json: [{ "id": "...", "bbox": [x, y, w, h] }]
output_dir
--key-color
--pad
```

输出示例：

```text
assets/png/smart_icon.png
assets/png/display_screen.png
assets/png/speaker_cluster.png
```

然后用 contact sheet 和 edge inspection 检查：

- 是否切掉边缘；
- 是否混入邻近元素；
- 是否有 key color 残留；
- 是否缺失元素；
- 是否把简单线框误切进 PNG。

### 1.10 第七步：文本提取

文本不放进 PNG，普通可读文本要变成 PPT 原生 text box。

`slide-alchemy` 的 text extraction 目标是生成：

```text
analysis/texts_layout.json
```

里面应包含：

- 文本内容；
- bbox；
- 字号；
- 颜色；
- 粗细；
- 对齐；
- 换行；
- 近似字体。

它强调“visual extraction by default”，也就是主要看页面视觉结果，而不是只信 PPT XML 或简单 OCR。

### 1.11 第八步：compose spec

组合规范在：

`slide-alchemy/skill/slide-alchemy/references/compose-spec.md`

最小结构：

```json
{
  "ref_width": 1920,
  "ref_height": 1080,
  "slide_width_in": 13.333333,
  "slide_height_in": 7.5,
  "slides": [
    {
      "base": "base/slide_001_base.png",
      "geometry": [],
      "images": [],
      "texts": []
    }
  ]
}
```

其中：

- `base` 是 clean base；
- `geometry` 是可编辑几何；
- `images` 是切出来的透明 PNG；
- `texts` 是可编辑文本框。

### 1.12 第九步：PPTX 组合

组合脚本：

`slide-alchemy/skill/slide-alchemy/scripts/compose_component_pptx.py`

它使用 `python-pptx`。

图层顺序固定：

```text
1. base PNG
2. geometry
3. images
4. texts
```

支持的 geometry：

- `rect`
- `round_rect`
- `oval`
- `star`
- `line`

注意：它的 `line` 实现不是 PowerPoint connector，而是用很薄的 rectangle 模拟线。圆角矩形、椭圆、星形等是 PPT native auto shape。

### 1.13 第十步：预览与 QA

最后导出 preview，并用脚本比较：

- `slide-alchemy/skill/slide-alchemy/scripts/compare_preview.py`
- `slide-alchemy/skill/slide-alchemy/scripts/build_contact_sheet.py`
- `slide-alchemy/skill/slide-alchemy/scripts/inspect_edges.py`

检查点：

- clean base 是否过度保留了原文字/元素；
- asset 是否缺失/切边/污染；
- 文本是否溢出；
- 元素是否重复出现；
- 预览是否明显偏移；
- 是否还存在整页截图伪装成可编辑。

### 1.14 slide-alchemy 的本质

`slide-alchemy` 的本质是：

```text
图像模型生成干净背景
+ 图像模型生成前景资产 sheet
+ 程序切成透明 PNG
+ 程序把简单几何转 PPT shape
+ OCR/视觉提取文本后转 PPT text box
+ python-pptx 按 compose spec 叠起来
```

它不是图像分层模型。它的前景元素不是从原图数学分离出来的，而是通过图像编辑/生成模型“重建/再生成”出来，再切图使用。

---

## 2. image-to-editable-ppt-skill 全链路

### 2.1 项目形态

`image-to-editable-ppt-skill` 也是 skill，但它比 `slide-alchemy` 多了一个完整 CLI runtime：`editppt`。

它不是简单脚本拼 PPT，而是有：

- run directory；
- page state machine；
- worker prompt；
- page manifest；
- validation；
- finalize；
- PPTX package builder。

关键文件：

- `image-to-editable-ppt-skill/skills/image-to-editable-ppt/SKILL.md`
- `image-to-editable-ppt-skill/skills/image-to-editable-ppt/prompts/page-worker.md`
- `image-to-editable-ppt-skill/skills/image-to-editable-ppt/references/cli-helper.md`
- `image-to-editable-ppt-skill/skills/image-to-editable-ppt/references/page-decision-tree.md`
- `image-to-editable-ppt-skill/skills/image-to-editable-ppt/references/manifest-schema.md`
- `image-to-editable-ppt-skill/skills/image-to-editable-ppt/cli/editppt/runtime/prepare_deck_run.py`
- `image-to-editable-ppt-skill/skills/image-to-editable-ppt/cli/editppt/runtime/deck_run_state.py`
- `image-to-editable-ppt-skill/skills/image-to-editable-ppt/cli/editppt/runtime/image_gen.py`
- `image-to-editable-ppt-skill/skills/image-to-editable-ppt/cli/editppt/runtime/process_asset_sheet.py`
- `image-to-editable-ppt-skill/skills/image-to-editable-ppt/cli/editppt/runtime/build_pptx_from_manifest.py`
- `image-to-editable-ppt-skill/skills/image-to-editable-ppt/cli/editppt/runtime/validate_pptx.py`

### 2.2 总流程

完整流程：

```text
editppt prepare <input>
  -> run dir
  -> deck_manifest.json
  -> page_jobs.json
  -> notes_manifest.json
  -> pages/page_001/source.png
  -> pages/page_001/page_request.json
  -> pages/page_001/text_hints.json

editppt run next
  -> rebuild_page_locally 或 dispatch_pages

page reconstructor
  -> 读 page-decision-tree / manifest-schema / cli-helper
  -> 背景识别与 clean base
  -> 前景 asset sheet 分离
  -> native text / shapes / formulas
  -> manifest.json
  -> editppt page build
  -> editppt page contact-sheet
  -> editppt page validate
  -> validation.json
  -> page_result.json

editppt run record
  -> 校验 page 输出并记录

editppt run finalize
  -> 从 page manifest 重建最终 deck
  -> deck validation
```

### 2.3 prepare 阶段

命令：

```bash
editppt prepare input.png
editppt prepare input.pdf
editppt prepare input1.png input2.png
```

实现文件：

`image-to-editable-ppt-skill/skills/image-to-editable-ppt/cli/editppt/runtime/prepare_deck_run.py`

它会：

1. 标准化输入；
2. 生成 run 目录；
3. 为每页生成 `source.png`；
4. 计算 slide size；
5. 计算 `content_box`；
6. 写 `page_request.json`；
7. 写 `deck_manifest.json`；
8. 写 `page_jobs.json`；
9. 写 `notes_manifest.json`；
10. 初始化每页 `imagegen-jobs.json`。

典型目录：

```text
run/
  deck_manifest.json
  page_jobs.json
  run_state.json
  notes_manifest.json
  input/
  pages/
    page_001/
      source.png
      page_request.json
      text_hints.json
      text_hints.png
      imagegen-jobs.json
```

`page_request.json` 是页面 worker 的任务边界，包含：

- page id；
- source image；
- source size；
- slide size；
- content box；
- allowed write scope；
- required outputs；
- image backend contract。

### 2.4 page state machine

实现文件：

`image-to-editable-ppt-skill/skills/image-to-editable-ppt/cli/editppt/runtime/deck_run_state.py`

核心状态：

- `pending`
- `dispatched`
- `recorded`
- `accepted`
- `complete`

`page_jobs.json` 是状态源，不允许手写跳状态。

关键原则：

- `dispatched` 是活跃租约，不能因为慢就 reset；
- `record` 只能记录通过校验的 page；
- `finalize` 只从 recorded page manifests 重建最终 deck；
- failed page 需要明确 reset 后重新跑。

### 2.5 page worker 决策流程

模板：

`image-to-editable-ppt-skill/skills/image-to-editable-ppt/prompts/page-worker.md`

worker 必须先完整读：

- `page-decision-tree.md`
- `manifest-schema.md`
- `cli-helper.md`

然后按固定顺序：

```text
1. page inventory
2. background recognition and repair
3. foreground asset separation
4. native text / shapes / tables / formulas
5. manifest.json
6. editppt page build
7. editppt page contact-sheet
8. editppt page validate
9. validation.json + page_result.json
```

### 2.6 背景处理

规则文件：

`image-to-editable-ppt-skill/skills/image-to-editable-ppt/references/page-decision-tree.md`

背景分三类：

1. 不需要图像工具的背景
   例如纯色、简单渐变、普通卡片、线、表格框等，直接用 PPT shape/script 重建。

2. 可复用背景区域
   必须不包含要重建的文字/图标/前景，否则会重复。

3. 需要图像工具修复的背景
   如果复杂背景被文字/图标/前景遮挡，就用：

```bash
editppt image edit --image pages/page_001/source.png \
  --prompt-file clean-base.prompt.txt \
  --out pages/page_001/assets/clean-base.png
```

clean base 要求保留：

- composition；
- perspective；
- object positions；
- colors；
- lighting；
- textures；
- background identity。

移除：

- readable text；
- labels；
- icons；
- stickers；
- badges；
- hand-drawn marks；
- decorative objects that will be rebuilt。

### 2.7 前景资产分离

`image-to-editable-ppt-skill` 在这点比 `slide-alchemy` 更强硬：

所有非文本前景视觉对象都必须走 asset-sheet workflow。

包括：

- foreground photos；
- screenshots；
- icons；
- pictograms；
- logo-like marks；
- badges；
- stickers；
- hand-drawn marks；
- complex arrows；
- devices；
- illustrations。

禁止：

- 用 native shape 近似语义图标；
- 用 emoji 或文本符号替代；
- 直接裁剪 source.png；
- 失败后降级成 warning。

命令形态：

```bash
editppt image edit \
  --image pages/page_001/source.png \
  --prompt-file asset-sheet.prompt.txt \
  --out pages/page_001/assets/asset-sheet.png
```

prompt 要求：

- separate existing objects from source；
- preserve original shapes, strokes, colors, proportions, internal spacing, texture, visual identity；
- flat chroma-key background；
- object count and order match visual inventory；
- no readable text；
- no full cards/panels/charts/page fragments；
- no redraw/beautify/synonym replacement。

### 2.8 图像后端实现

实现文件：

`image-to-editable-ppt-skill/skills/image-to-editable-ppt/cli/editppt/runtime/image_gen.py`

它有两条后端路径：

1. Codex OAuth 优先：

```text
~/.codex/auth.json
chatgpt.com/backend-api/codex/images/generations
chatgpt.com/backend-api/codex/images/edits
```

2. OpenAI-compatible API fallback：

```text
OPENAI_API_KEY
OPENAI_BASE_URL
/v1/images/generations
/v1/images/edits
```

也就是说，`image-to-editable-ppt-skill` 默认不是调用 `chat/completions` 生图，而是走 Codex image endpoint 或 OpenAI Images API endpoint。

### 2.9 asset sheet 处理

命令：

```bash
editppt image process-sheet pages/page_001 \
  --job-id icon-sheet \
  --asset-sheet-source assets/asset-sheet.png \
  --assets-dir assets/foreground \
  --asset-names smart_icon,display_screen,speaker_cluster
```

实现文件：

- `image-to-editable-ppt-skill/skills/image-to-editable-ppt/cli/editppt/runtime/process_asset_sheet.py`
- `image-to-editable-ppt-skill/skills/image-to-editable-ppt/cli/editppt/runtime/_page_artifacts.py`

处理链：

```text
asset-sheet.png
  -> remove_chroma_key.py
  -> imagegen_asset_sheet_alpha.png
  -> split_alpha_components.py
  -> assets/foreground/*.png
  -> split_assets.json
```

它支持：

- 自动从边缘采样 key color；
- soft matte；
- despill；
- connected component splitting；
- min area；
- merge gap；
- square asset padding；
- asset names。

### 2.10 文本与 text hints

`editppt prepare` 会生成：

```text
text_hints.json
text_hints.png
```

`page-decision-tree.md` 要求：

- 普通可读文本默认变成 native PPT text boxes；
- 不能用隐藏文字、透明文字、1pt 字来冒充；
- 不能把主标题、正文、表格、图例、数字等留在图片里；
- text box 使用 source-pixel `box_px`；
- 字号优先从 text hints 取；
- 同层级文本字号保持一致；
- 公式另走 LaTeX rendering，不用普通文本框硬拼。

### 2.11 manifest.json

规则文件：

`image-to-editable-ppt-skill/skills/image-to-editable-ppt/references/manifest-schema.md`

`manifest.json` 是页面构建的唯一权威来源。

必须包含：

```json
{
  "slide": {},
  "content_box": {},
  "source": {},
  "text_inventory": [],
  "visual_inventory": [],
  "background_strategy": {},
  "quality_checks": {},
  "text_boxes": [],
  "shapes": [],
  "images": [],
  "asset_provenance": []
}
```

坐标规则：

- `text_boxes[].box_px`
- `images[].box_px`
- 非 line 的 `shapes[].box_px`
- line 的 `shapes[].points_px`

所有坐标都是 `source.png` 像素坐标，runtime 再映射到 `content_box`。

`asset_provenance` 对每个图片资产说明来源：

- `asset-sheet-separated`
- `imagegen`
- `latex-rendered-formula`
- `user-provided`
- `user-approved-rasterization`

前景视觉对象不允许出现 crop、fallback、approximation 等来源描述。

### 2.12 page build

命令：

```bash
editppt page build pages/page_001
```

实现文件：

`image-to-editable-ppt-skill/skills/image-to-editable-ppt/cli/editppt/runtime/build_pptx_from_manifest.py`

它不是简单调用 `python-pptx`，而是直接写 PPTX zip 包里的 XML。

它做的事：

- 将 `box_px` / `points_px` 映射到 slide inch/EMU；
- 写 `ppt/slides/slide1.xml`；
- 写 relationships；
- 写 media；
- 写 content types；
- 写 theme/layout/master；
- 写 notes；
- 支持 page-level PPTX 和 final deck。

支持对象：

- images；
- text boxes；
- lines；
- rectangles；
- rounded rectangles；
- ellipses；
- polygons；
- SVG/image media；
- z-index layering。

图层排序：

```text
shapes/images/text_boxes 根据 z_index 排序
```

与 `slide-alchemy` 不同，它不是只靠 `python-pptx` API，而是更底层地控制 OOXML。

### 2.13 page validate

命令：

```bash
editppt page validate pages/page_001
```

校验文件：

`image-to-editable-ppt-skill/skills/image-to-editable-ppt/cli/editppt/runtime/validate_pptx.py`

它检查：

- PPTX zip 是否正常；
- slide 数量；
- media 数量；
- relationship targets；
- required text 是否出现在 PPTX；
- manifest images 是否都进了 media；
- media hash 是否匹配；
- asset provenance 是否完整；
- positioned objects 是否有坐标；
- full-slide `source.png` + editable text 是否违规；
- foreground asset 是否用了 crop/fallback/approximation；
- quality checks 是否都为 true。

这是它比 `slide-alchemy` 更工程化的地方。

### 2.14 page_result 与 record

page reconstructor 需要输出：

```text
manifest.json
imagegen-jobs.json
page.pptx
preview.png
split_assets_contact.png
validation.json
page_result.json
```

`validation.json` 必须有顶层：

```json
{ "passed": true }
```

然后 parent 跑：

```bash
editppt run record <run> --page page_001 --agent-id <id>
```

record 会再次校验 page.pptx 和 manifest。失败就不能进入 final assembly。

### 2.15 finalize

命令：

```bash
editppt run finalize <run>
```

finalize 不拿 page.pptx 拼接，而是重新读取每页 `manifest.json`，从 manifest 重新构建最终 deck。

最终输出：

```text
final/<origin>_edited.pptx
```

final deck validation 会检查：

- slide count；
- notes；
- media relationships；
- media hashes；
- page validations；
- full-slide source raster + editable text 违规模式。

### 2.16 image-to-editable-ppt-skill 的本质

它的本质是：

```text
editppt prepare 建 run/page 状态
+ page worker 按三阶段决策
+ 图像后端生成 clean base
+ 图像后端生成 foreground asset sheet
+ runtime 切透明 PNG
+ OCR/text hints 生成 native text boxes
+ native shapes 重建结构几何
+ manifest 作为唯一构建源
+ build_pptx_from_manifest 写 OOXML PPTX
+ validate_pptx 严格拒绝伪可编辑结果
+ finalize 从 manifest 重建最终 deck
```

它同样不是图像分层模型。前景资产仍然来自图像编辑/生成模型生成的 asset sheet，然后程序切分。它比 `slide-alchemy` 多的不是“更先进的视觉模型”，而是更完整的状态机、manifest schema、PPTX builder 和 validation contract。

---

## 3. 两者核心差异

| 项目 | 主要特点 | PPTX 构建方式 | 图像模型用途 | 强项 | 弱项 |
|---|---|---|---|---|---|
| `slide-alchemy` | 轻量 workflow + scripts | `python-pptx` 读 compose spec | clean base、asset sheet | 直观、prompt/workflow 清晰、容易理解 | 缺少强状态机和严格 deck validation |
| `image-to-editable-ppt-skill` | `editppt` runtime + state machine | 直接写 PPTX OOXML package | clean base、asset sheet、可选 generation | 状态、manifest、validation、finalize 很完整 | 依赖 skill/CLI 运行形态，默认图像后端优先 Codex OAuth |

## 4. 两者共同点

它们共同的真实路线都是：

```text
不是直接图像分层
不是把原图裁剪成元素
不是 OCRPDF 那种原图背景叠文字

而是：
图像编辑/生成模型生成 clean base
+ 图像编辑/生成模型生成前景 asset sheet
+ 程序切出透明 PNG
+ 程序生成 native text / native shapes
+ 按坐标叠成 PPTX
```

因此，页面里可编辑的粒度是：

- 文本：PPT 原生 text box，可改字；
- 简单结构：PPT 原生 shape，可改线条、颜色、尺寸；
- 复杂视觉/图标/产品图：透明 PNG，可移动、缩放、裁剪、隐藏，但不能改内部线条；
- clean base：全页背景图，不可编辑内部元素。
