# 图片转可编辑 PPTX 全链路方案

本文基于本地代码重新梳理两个参考项目：

- `/Users/lzj/proj/notebook/slide-alchemy`
- `/Users/lzj/proj/notebook/image-to-editable-ppt-skill`

目标不是直接把某个 skill 塞进 AIPPT，而是提炼出可在 AIPPT 内部实现、可测试、可验收的图片转可编辑 PPTX 方案。

## 1. 结论

建议 AIPPT 采用 `image-to-editable-ppt-skill` 的工程骨架和验收契约，吸收 `slide-alchemy` 的轻量分层思路与 asset sheet 生成/切分策略。

具体判断：

- `image-to-editable-ppt-skill` 更适合作为主参考：它有完整 CLI 状态机、页面级 manifest、OCR text hints、asset provenance、PPTX 结构校验、禁止整页截图叠文本等硬规则。
- `slide-alchemy` 更适合作为 prompt/workflow 参考：它的 clean base、元素分类、PNG asset sheet、composition 顺序很清楚，但整体更依赖 agent 执行纪律，确定性状态机较弱。
- AIPPT 不应依赖 Codex skill 运行时或 page worker 作为产品能力。应把参考项目里的确定性逻辑改造成 AIPPT 内部模块，把模型调用通过现有 `config.yaml` 的 `prompt_model/image_model/edit_model/ocr_model` 接入。
- 当前没有 Qwen layered model 时，纯模型路径本质是：OCR + 视觉理解/结构分析 + 图像编辑生成 clean base/asset sheet + 本地切图 + PPTX 原生对象重建。

## 2. slide-alchemy 是如何做的

代码入口和关键文件：

- `skill/slide-alchemy/SKILL.md`
- `skill/slide-alchemy/references/workflow.md`
- `skill/slide-alchemy/references/element-classification.md`
- `skill/slide-alchemy/references/icon-slicing-qa.md`
- `skill/slide-alchemy/references/text-extraction.md`
- `skill/slide-alchemy/references/compose-spec.md`
- `skill/slide-alchemy/scripts/compose_component_pptx.py`
- `skill/slide-alchemy/scripts/slice_asset_sheet.py`

### 2.1 全链路

slide-alchemy 的固定顺序是：

1. 渲染或取得每页源图。
2. 做 base grouping，判断哪些页共享底图。
3. 调用图像编辑/生成模型生成 clean base，去掉文字、图标、卡片、中心内容，保留背景主题。
4. 用视觉模型分析非文本视觉元素，产出 `element_analysis.json`。
5. 分类元素：
   - `simple_geometry_svg_ooxml`：线条、矩形、圆角矩形、圆、星形、卡片底、标题条等结构几何。
   - `icon_png`：语义图标、设备、人物、建筑、badge 等。
   - `complex_png_whole`：复杂组合视觉、强渐变/发光/阴影装饰。
6. 对 PNG 类元素调用图像编辑/生成模型生成 asset sheet，要求高对比纯色背景和大间距。
7. 本地脚本对 asset sheet 做 chroma key/裁切，生成透明 PNG 资产和 contact sheet。
8. 用视觉模型提取文本布局，产出 `texts_layout.json`。
9. 用 `compose_component_pptx.py` 组合 PPTX，层级顺序固定为：
   - clean base PNG
   - editable geometry
   - PNG assets
   - editable text boxes
10. 导出 preview，做视觉 QA。

### 2.2 模型调用点

slide-alchemy 明确要求图像模型参与这些环节：

- clean base generation/editing。
- icon PNG asset sheet generation/editing。
- complex PNG whole asset generation/editing。
- 需要重生成的视觉资产。

文本提取默认依赖视觉模型。它没有把 OCR 作为强状态机入口，但 AIPPT 可以替换为 OCR 优先、视觉模型补漏。

### 2.3 PPTX 是如何组装的

`compose_component_pptx.py` 使用 `python-pptx`：

- `base` 用 `slide.shapes.add_picture(...)` 铺满整页。
- `geometry` 用 `add_shape(...)` 转为 PPT 原生形状，支持 `rect/round_rect/oval/star/line`。
- `images` 用 `add_picture(...)` 按 bbox 放置透明 PNG。
- `texts` 用 `add_textbox(...)` 写入 PPT 原生文本框。

因此 slide-alchemy 中的线框、卡片、分割线不是图像模型“生成成 PPT 线条”。实际过程是：模型/agent 识别出几何元素的位置、颜色和类型，确定性 composer 再创建 PPT 原生 shape。

## 3. image-to-editable-ppt-skill 是如何做的

代码入口和关键文件：

- `skills/image-to-editable-ppt/SKILL.md`
- `skills/image-to-editable-ppt/references/page-decision-tree.md`
- `skills/image-to-editable-ppt/references/manifest-schema.md`
- `skills/image-to-editable-ppt/references/cli-helper.md`
- `skills/image-to-editable-ppt/cli/editppt/runtime/main.py`
- `skills/image-to-editable-ppt/cli/editppt/runtime/build_pptx_from_manifest.py`
- `skills/image-to-editable-ppt/cli/editppt/runtime/validate_pptx.py`
- `skills/image-to-editable-ppt/cli/editppt/runtime/image_gen.py`
- `skills/image-to-editable-ppt/cli/editppt/runtime/process_asset_sheet.py`
- `skills/image-to-editable-ppt/cli/editppt/runtime/split_alpha_components.py`
- `skills/image-to-editable-ppt/cli/editppt/runtime/paddle_text_hints.py`

### 3.1 全链路

image-to-editable-ppt-skill 的固定流程是：

1. `editppt prepare <input...>`
   - 把图片、PDF、图片型 PPTX 归一化成逐页 `pages/page_NNN/source.png`。
   - 写入 `deck_manifest.json`、`page_jobs.json`、`page_request.json`。
   - 生成 `text_hints.json/text_hints.png`。
2. OCR/text hints
   - 有 PaddleOCR token 时走 PaddleOCR-VL。
   - 没有 token 时退化为本地 ink geometry detector，但这只测位置和大小，不识别内容。
3. `editppt run next`
   - 单页走 local page reconstructor。
   - 多页分发 page worker。
4. 每页按 `page-decision-tree.md` 重建：
   - 先判断背景是否需要 image edit repair。
   - 再做 foreground asset separation。
   - 最后重建文本、形状、公式等 PPT native elements。
5. 图像模型调用：
   - `editppt image edit --image source.png` 做 clean base。
   - `editppt image edit --image source.png` 做 source-faithful asset sheet。
   - `editppt image generate` 只用于不需要严格保留源图对象的新支持图。
6. asset sheet 处理：
   - `process_asset_sheet.py` 先调用 chroma helper 去背景。
   - `split_alpha_components.py` 用 alpha 连通域拆分透明 PNG 资产。
   - 产出 split manifest/contact sheet。
7. 页面 reconstructor 写 `manifest.json`。
8. `editppt page build` 或 `run record` 用 manifest 构建 `page.pptx`、preview、validation。
9. `editppt run finalize` 按页读取已 record 的 manifest，生成最终 `.pptx`。

### 3.2 manifest 是核心契约

`manifest-schema.md` 要求页面 manifest 至少包含：

- `slide`
- `content_box`
- `source`
- `text_inventory`
- `visual_inventory`
- `background_strategy`
- `quality_checks`
- `text_boxes`
- `shapes`
- `images`
- `asset_provenance`

所有对象坐标必须是源图像素坐标：

- 文本和图片：`box_px: [x, y, width, height]`
- 线条：`points_px: [x1, y1, x2, y2]`

这点对 AIPPT 很关键：模型只需要输出源图坐标，确定性 builder 负责映射到 PPT canvas/content box。

### 3.3 PPTX 是如何组装的

`build_pptx_from_manifest.py` 不主要依赖 `python-pptx`，而是直接写 OOXML zip 包：

- `normalize_manifest()` 把源图像素坐标映射到 slide inch/EMU 坐标。
- `text_box_xml()` 生成 PPT 原生 text box。
- `shape_xml()` 生成 PPT 原生 shape，支持 line、rect、roundRect、ellipse、custom polygon 等。
- `image_xml()` 生成图片对象。
- `slide_xml()` 按 `z_index` 排序写入对象。
- `write_deck()` 按页面 manifest 生成最终多页 PPTX。

这个 builder 比 slide-alchemy 的 `python-pptx` composer 更适合作为 AIPPT 的长期基础，因为它能控制：

- roundRect radius。
- measured text fitting。
- z-index。
- notes。
- 直接结构校验。
- 不依赖 PowerPoint/WPS 交互。

### 3.4 校验机制

`validate_pptx.py` 做了几类关键检查：

- PPTX zip/package 是否有效。
- manifest 是否缺坐标。
- text/images/shapes 是否有可定位对象。
- `asset_provenance.source_type` 是否在允许列表内。
- 是否存在 full-slide `source.png` + editable text overlay 的假可编辑结果。
- foreground visual object 是否违规使用 crop/fallback/approximation/emoji/native approximation。
- `quality_checks` 是否完整。
- roundRect 是否记录真实 source corner radius。

这是 AIPPT 当前必须补齐的部分。否则“能打开 PPTX”会误判为“转换成功”。

## 4. 两个方案的关键差异

| 维度 | slide-alchemy | image-to-editable-ppt-skill | AIPPT 建议 |
| --- | --- | --- | --- |
| 主体形态 | Codex skill + 线性流程 | Codex skill + editppt CLI 状态机 | AIPPT 内部服务模块 |
| 输入归一化 | 依赖 workflow 约定 | `editppt prepare` 强制生成 run/page 结构 | 实现 AIPPT job/page artifact |
| OCR | 视觉文本提取为主 | PaddleOCR-VL hints 优先 | OCR provider 优先，视觉模型补漏 |
| 图像分离 | clean base + asset sheet | clean base + source-faithful asset sheet | 采用 asset sheet，不允许 source crop fallback |
| PPTX 生成 | `python-pptx` composer | 直接 OOXML builder | 优先参考 OOXML builder |
| 校验 | preview/diff 为主 | manifest/provenance/package 结构 gate | 两者都要：结构 gate + preview/diff |
| 多页并发 | clean base 后可分发 subagent | page worker 状态机 | 后端 worker/async queue，不依赖 Codex subagent |

## 5. AIPPT 落地全链路

### 5.1 输入与任务目录

新增或改造 AIPPT 的 editable PPTX job 目录：

```text
run/
  deck_manifest.json
  provider_logs.jsonl
  pages/
    page_001/
      source.png
      page_request.json
      ocr_hints.json
      ocr_hints_overlay.png
      page_analysis.json
      clean_base.png
      asset_sheet_001.png
      asset_sheet_001_alpha.png
      split_assets.json
      assets/
      manifest.json
      page.pptx
      preview.png
      validation.json
  final/
    editable.pptx
    report.json
```

输入可以先只支持图片列表和现有图片版 PPTX 渲染后的逐页 PNG。后续再扩 PDF/PPTX 渲染。

### 5.2 Provider gate

全链路前必须先跑 gate：

1. config check：确认 `prompt_model/image_model/edit_model/ocr_model` 都有 `model/base_url/api_key`。
2. OCR JSON contract：必须返回可解析结构化 OCR 结果。
3. image edit clean-base probe。
4. image edit asset-sheet probe。
5. image generation probe：只作为可选支持，不作为 foreground separation 主路径。

如果 OCR 不是结构化 JSON，直接 fail fast。不能静默 fallback 到假 OCR 或本地临时 OCR。

### 5.3 OCR 与文本 hints

AIPPT 应把 OCR 结果标准化成类似 image-to-editable-ppt-skill 的 hints：

```json
{
  "backend": "configured-ocr-model",
  "source": {"width_px": 1672, "height_px": 941},
  "lines": [
    {
      "id": "T01",
      "text": "核心架构设计：增程、底盘与智能域",
      "box_px": [360, 70, 950, 70],
      "font_pt": 32,
      "font_pt_if_cjk": 32,
      "size_group": "title"
    }
  ]
}
```

文本重建规则：

- 主标题、正文、数字、标签默认生成 PPT 原生文本框。
- OCR 漏字、错字必须进入 page failure 或 human review，不允许默默生成错字。
- 同级文本统一字号，避免同一层级字体忽大忽小。
- 字体名称不强求完全一致，优先保证文字内容、位置、字号、粗细、颜色接近；可默认 `PingFang SC` 或项目配置字体。

### 5.4 页面分析

调用 `prompt_model` 或视觉理解模型，输入：

- `source.png`
- `ocr_hints.json`
- 可选 `ocr_hints_overlay.png`

输出 `page_analysis.json`：

- background strategy。
- visual inventory。
- foreground asset list。
- native shape candidates。
- text mapping：OCR line -> text box。
- asset sheet prompt plan。

重点：模型只负责“识别、分类、规划、给坐标”，不直接生成 PPTX。

### 5.5 背景处理

根据 analysis：

- 简单纯色/渐变/规则背景：用 PPT native background 或本地生成背景。
- 复杂背景但无前景遮挡：可保留局部/全底图作为 clean base，但不能包含后续会重建的文字和前景对象。
- 有遮挡/文字/图标污染的复杂背景：调用 `edit_model` 对 `source.png` 生成 clean base。

clean base prompt 必须约束：

- 保持原图 composition、perspective、object positions、colors、lighting。
- 只移除将被重建的文字、图标、标签、前景视觉元素。
- 禁止新对象、新布局、伪文字、模糊补丁、水印。

### 5.6 前景图片资产分离

采用 image-to-editable-ppt-skill 的强规则：

- 所有非文本 foreground visual objects 必须通过 image edit asset-sheet workflow 分离。
- 不允许直接从 source.png 裁剪后当作资产。
- 不允许把语义 icon 用 native shape 近似替代。
- 不允许失败后降级成 warning 并继续交付。

流程：

1. 根据 `visual_inventory` 生成 asset sheet prompt。
2. 调用 `edit_model`：

```text
Input: source.png
Task: separate exact existing foreground visual objects into a sparse chroma-key asset sheet.
Preserve shape, stroke, color, proportions, texture, shadow, internal spacing.
No text, no watermarks, no replacements, no simplified icons.
```

3. 本地去 chroma/alpha。
4. 用连通域切分资产。
5. 生成 contact sheet。
6. asset count/name/order 与 `visual_inventory` reconciliation。
7. 资产 provenance 标记为 `asset-sheet-separated`。

### 5.7 原生形状重建

简单几何转 PPT 原生对象：

- 线条、虚线、分割线。
- 矩形、圆角矩形、圆、椭圆。
- 卡片、容器、表格线、普通箭头、流程框。

这些对象不需要图像模型重新生成。模型只输出：

```json
{
  "type": "roundRect",
  "box_px": [120, 200, 460, 160],
  "fill": "#102A44",
  "stroke": "#1677FF",
  "stroke_width": 1.2,
  "source_corner_radius_px": 12,
  "z_index": 20
}
```

然后由 AIPPT builder 生成 PPT 原生 `AUTO_SHAPE/LINE`。

### 5.8 页面 manifest

AIPPT 的 page manifest 应收敛到 image-to-editable-ppt-skill 风格，但字段可按现有 `generative_editable_manifest.py` 适配：

```json
{
  "slide": {"width": 13.333, "height": 7.5},
  "source": {"width_px": 1672, "height_px": 941, "path": "source.png"},
  "background_strategy": {},
  "text_inventory": [],
  "visual_inventory": [],
  "quality_checks": {},
  "images": [],
  "shapes": [],
  "text_boxes": [],
  "asset_provenance": []
}
```

硬性要求：

- 所有 positioned object 必须有 `box_px` 或 `points_px`。
- 所有 `images[]` 必须有 `asset_provenance`。
- forbidden provenance：`source_crop`、`fallback`、`approximation`、`direct source crop`。
- full-slide `source.png` + editable text overlay 必须 fail。

### 5.9 PPTX builder

建议优先迁移/改造 image-to-editable-ppt-skill 的 OOXML builder 思路，而不是继续扩大 `python-pptx` composer：

- 直接写 OOXML 能更精确控制 z-index、roundRect radius、text body、notes 和 package relationships。
- WPS/PowerPoint 都能看到对象结构。
- 可以通过解析 `ppt/slides/slideN.xml` 直接统计 `p:sp`、`p:pic`、`p:txBody`，判断是否真实可编辑。

组装层级：

1. clean base/background。
2. native shapes。
3. separated bitmap assets。
4. native text boxes。
5. 必要时覆盖层，例如标注/手绘圈。

### 5.10 验收与重试

每页必须生成结构化 validation：

- PPTX zip/package 可打开。
- slide count 正确。
- 每页不允许只有 1 张 full-slide picture。
- 每页 text coverage 达标，OCR 失败必须明确记录。
- simple geometry 尽量是 native shape。
- foreground visual image 必须来自 asset-sheet-separated。
- preview 与 source 无明显错位、漏块、重复文字、脏背景。
- 所有 provider 错误脱敏记录。

重试策略：

- OCR JSON 不合格：调整 OCR prompt/adapter 后重试，仍失败则 fail fast。
- clean base 有残字/鬼影：重试 clean base。
- asset sheet 数量不对/切坏/粘连：重试 asset sheet，换 chroma color 或拆小批次。
- 文本错字：重新 OCR 或视觉模型校正，不能用猜测覆盖。
- PPTX 结构异常：先修 builder/manifest validator，不能靠人工打开后判断。

## 6. 模型用量预估

单页典型调用：

- OCR：1 次。
- 页面分析/manifest draft：1 次。
- clean base edit：0-1 次，复杂页通常 1 次。
- foreground asset sheet edit：1-N 次，复杂页可能 2-4 次。
- repair/retry：按 QA 结果触发。

所以成本确实会高于图片版 PPT 生成。合理预估：

- 简单页：约 2-3 次模型调用。
- 中等页：约 4-6 次模型调用。
- 复杂汽车架构/信息图页：约 6+ 次模型调用，主要花在 clean base、asset sheet 和重试。

优化方向：

- 多页共享 clean base。
- 一个 asset sheet 承载多个前景对象。
- OCR 批量化。
- 只对复杂背景调用 clean base edit。
- native geometry 不走图像模型。

## 7. AIPPT 开发拆分建议

### 阶段 1：结构 gate 先修好

先保证不能再出现“整张图拖动但报告 passed”的情况。

任务：

- PPTX object inspector：解析 slide XML，统计 full-slide picture、non-full picture、native shape、text box。
- manifest provenance validator：禁止 source crop/fallback。
- preview validation report：报告对象统计和失败原因。
- 测试：给一个只有整页图的 PPTX，必须失败。

### 阶段 2：OCR hints 接入

任务：

- 用当前 `ocr_model` 生成结构化 text hints。
- 标准化 OCR 输出。
- 将 text hints 注入 page analysis prompt。
- 测试：非 JSON OCR 响应必须失败；真实 OCR canary 必须产出 text boxes。

### 阶段 3：asset sheet 分离

任务：

- asset sheet prompt builder。
- image edit provider 调用。
- chroma/alpha 去背景。
- connected components 切分。
- contact sheet。
- asset provenance。
- 测试：asset sheet 尺寸和源图 bbox 不一致时，仍按 sheet 连通域切图，不允许拿源图 bbox 去切 asset sheet。

### 阶段 4：manifest -> PPTX builder

任务：

- 将 native text/shape/image 映射成 PPTX。
- 优先增强现有 composer，或迁移 OOXML builder。
- 支持 roundRect radius、z-index、measured text fitting。
- 测试：解析生成 PPTX，确认 shape/text/picture 数量和 manifest 一致。

### 阶段 5：真实 1/2/6 页验收

任务：

- 先 slide 3 canary。
- 再 2 页混合。
- 最后 6 页 replay-assets。
- 每轮输出 report、preview、diff、object stats、provider logs。
- 根据实测迭代 prompt、切图、builder、validator。

## 8. 不能接受的降级

这些情况应直接 fail，不应标记 passed：

- 最终页只有整页图片。
- 整页 source 图片作为底图，上面叠 OCR 文本。
- foreground asset 直接从 source.png 裁剪。
- OCR 明显错字、漏主要标题或正文。
- asset sheet 失败后回退 source crop。
- 语义图标被 native shape 粗糙近似。
- preview 有明显残字、重影、漏块、错位。

## 9. 推荐最终方案

最终方案：

1. 主流程采用 image-to-editable-ppt-skill 的状态机思想、manifest schema、PPTX OOXML builder、validator/provenance gate。
2. clean base、元素分类、asset sheet prompt 采用 slide-alchemy 的轻量工作流和分类规则。
3. AIPPT 内部实现，不依赖 Codex skill、`editppt` 命令或 page worker；可以借鉴代码结构，但要改造成服务端模块和测试。
4. OCR 使用 AIPPT 配置中的真实 `ocr_model`，不要保留 `.env` fallback。
5. 图像资产分离在没有 Qwen layered model 时使用 image edit asset sheet；后续有 layered model 后，可以把 `foreground asset separation` 这一层替换为 layered decomposition，但 manifest、builder、validator 不需要推倒重来。

## 10. AIPPT 当前问题根因与修复结论

基于真实 `output/replay-assets/slide_1.png` 到 `slide_6.png` 回归，旧问题不是模型完全不可用，而是 AIPPT 自己的重建链路存在三个问题：

1. OCR 结果被过度过滤。
   - page 5 的 OCR provider 实际返回过 22 项文本。
   - 旧过滤逻辑只保留 4 项，导致背景清掉文本后没有足够 text box 重建。
   - 修复后会保留尺寸和文本量足够可信的 approximate OCR，并记录 warning。
   - focused OCR recovery 还会把已经被大标题覆盖的局部候选恢复成重复文本，例如 `落地建议：`；当前已增加重复片段抑制，并把该 visual candidate 标记为 non-blocking。

2. source-preserving fast path 错误地清理所有粗糙 OCR 框。
   - 对 approximate OCR 框直接清底再重绘，会把视觉差异从约 9.9% 拉到 15.3%。
   - 当前修复为保真优先：复杂/粗糙 OCR 页使用源视觉背景，叠加低透明度原生 text box，并明确标记 `source_preserving_low_opacity_text_overlay` warning。
   - 该模式不能标记为普通 `passed`，runner 必须返回 `degraded`，避免把“整页源图 + 低透明文本层”误报为完整元素分离成功。
   - 这是降级策略，不等同于高质量元素分层；它解决“文字 OCR 没做/只有整图”的问题，但复杂视觉仍保留在背景图里。

3. runner 报告把 warning 当失败，且没有暴露 OCR 全过滤情况。
   - 修复后只有 `severity=error` 的 reconstruction issue 才使 run failed。
   - 当 OCR 返回内容但全部被过滤为幻觉/噪声时，报告 `no_editable_text_after_ocr_filtering` warning，避免 page 6 这种情况静默通过。

## 11. 真实回归结果

最近一次 6 页真实回归：

```bash
python scripts/run_real_generative_editable_pptx.py run \
  --isolate-pages \
  --page-wall-timeout 300 \
  --input-glob 'output/replay-assets/slide_[0-9]*.png' \
  --slides 6 \
  --output-dir /private/tmp/aippt-real-replay6-lowopacity-timeout300-20260704-071603 \
  --job-id replay6-lowopacity-timeout300 \
  --provider-timeout 90
```

按当前状态语义复算，结果应为 `status=degraded`：没有 error 级失败，但 page 2/3/5 使用低透明 OCR overlay，page 6 有 OCR 全过滤 warning。

每页摘要：

| Page | PPTX objects | Preview changed ratio | 说明 |
| --- | --- | ---: | --- |
| 1 | `AUTO_SHAPE=15`, `LINE=11`, `PICTURE=1`, `TEXT_BOX=2` | `0.054813` | 原生形状/线条拆分有效 |
| 2 | `PICTURE=1`, `TEXT_BOX=10` | `0.041215` | 低透明 OCR overlay 降级 |
| 3 | `PICTURE=1`, `TEXT_BOX=11` | `0.047467` | 低透明 OCR overlay 降级 |
| 4 | `PICTURE=3`, `TEXT_BOX=9` | `0.059219` | 多图片对象 + 文本框 |
| 5 | `PICTURE=1`, `TEXT_BOX=22` | `0.079666` | 低透明 OCR overlay 降级，接近阈值 |
| 6 | `AUTO_SHAPE=21`, `LINE=6`, `PICTURE=1`, `TEXT_BOX=0` | `0.049679` | OCR 输出为幻觉/重复文本，报告 warning |

注意：

- `--page-wall-timeout 180` 下 page 4 会超时；实际 stage 显示 text clean 和 base clean 两次 image edit 已占约 143s，加上 OCR 约 30s 后剩余时间不足。
- `--page-wall-timeout 300` 可以通过 6 页全量真实回归。
- 当前效果已经不再是“每页只有整张图”。但 page 2/3/5 属于明确降级，不是完整视觉元素分离；下一步要继续迁移参考项目里的 asset sheet/page-decision-tree，减少 full-slide background 占比。

后续 page 5 局部修复：

- 去掉 focused OCR 重复恢复后，page 5 为 `TEXT_BOX=11`。
- 真实 canary：`/private/tmp/aippt-real-page5-dedupe-nonblocking-20260704-075418`。
- 结果：`status=degraded`，preview changed ratio `0.075914`，无 `visual_text_candidate_missing_ocr_text`。
- 进一步补齐同轮 focused OCR recovery 的去重：两个重叠 visual candidates 如果恢复出同一文本，只保留第一个，后者标为 non-blocking。
- 修复非 isolated 多页 runner warning 聚合：`warning_pages` 优先使用 issue 自带页码，避免多页非 isolated 模式全部误报为 page 1。
