# AIReader 同类产品调研

调研日期：2026-09-23。主要范围：NotebookLM、SciSpace、Adobe Acrobat AI Assistant、ChatPDF；补充阅读工作流参考：Zotero、Readwise Reader、LiquidText。目的：为技术书与论文阅读产品的下一步功能和界面选择提供依据。

## 方法与边界

本报告查阅官方帮助文档和公开产品页面，没有登录试用这些产品，没有上传用户文件，也没有测量回答准确率、延迟或留存。下面的“支持”表示官方宣称支持，不代表我们已经验证其质量。“可借鉴”是产品判断，不是市场调查结论。不同平台、地区、账号与套餐可能有差异；不把“文档没有提到”写成“产品没有”。

时效提醒：本次打开 NotebookLM 官方帮助链接时，它们已重定向至 **Gemini Notebook**，正文也使用这一名称。为便于识别，下文写作“NotebookLM / Gemini Notebook”。其旧升级表和新额度文档仍有不一致，故不把旧每日次数当作统一现行限制。[官方聊天帮助](https://support.google.com/gemininotebook/answer/16179559?hl=en)、[新额度说明](https://support.google.com/gemininotebook/answer/17670842?hl=en)、[升级页](https://support.google.com/gemininotebook/answer/16213268?hl=en)

AIReader 已有选区附件区、截图粘贴与图片上传、可拖动侧栏、公开推理摘要、独立账号和模型选择。本轮代码核验还确认，现有笔记已经具备页码关联、原文摘录与回跳；回答当前提供复制，但没有直接保存笔记的入口。因此建议不是从零增加笔记，而是连接回答与笔记，再改善组织和导出。本报告的竞品部分独立于 AIReader 代码审计；实现范围应以当前仓库核验为准。

本地核验基线：v0.1.44 / `df995918886fa0c33645629d62cf458f0d4595fa`。检查了 `ChatMessage.tsx`、`ChatPanel.tsx`、`NotesPanel.tsx`、`PdfReader.tsx`、选区与图片功能规格，以及仓库现有的聊天/笔记界面测试截图。截图使用生成样本，不是本轮对已安装应用或用户真实阅读行为的测试。现有区域摘录用于批注，图片聊天支持用户上传；两者尚未形成直接的 PDF 框选提问入口。

## 四类产品值得借鉴什么

| 产品 | 官方资料体现的核心体验 | 对 AIReader 的启发（推论） |
| --- | --- | --- |
| NotebookLM / Gemini Notebook | 用户选择参与问答的来源；引用可悬停看原文、点击定位；回答可保留格式和引用地保存为笔记。[聊天帮助](https://support.google.com/gemininotebook/answer/16179559?hl=en) | 引用不能只是一枚页码按钮，应当让读者低成本核验；有价值的回答应能沉淀下来。 |
| SciSpace | 在 PDF 中选择公式、表格或图示区域，直接得到解释；回答可保存进 Notebook。[公式与表格](https://scispace.com/help/en/articles/10719149-how-to-explain-math-and-tables-in-chat-with-pdf)、[保存笔记](https://scispace.com/help/en/articles/10741339-how-to-save-text-directly-to-your-notebook-in-scispace) | 技术阅读的入口应当是当前难懂的段落、公式或图表，而不只是一个空聊天框。 |
| Acrobat AI Assistant | 单篇文档问答与引用回跳；PDF Spaces 把多文件、笔记和助手组织在同一空间。[问答帮助](https://helpx.adobe.com/acrobat/using/get-ai-generated-answers.html)、[PDF Spaces](https://helpx.adobe.com/acrobat/desktop/explore-pdf-spaces/pdf-spaces-faq.html) | 从“读一本书”逐步扩展到“围绕一个主题整理材料”，但原文核验仍需直接。 |
| ChatPDF | PDF 与聊天并排；文件夹可作为多文档问答范围；提供可导出的学习卡片。[产品页](https://www.chatpdf.com/)、[学习卡片](https://www.chatpdf.com/ai-flashcards) | 基础入口应该简单，输出应该能带走。多文档能力可以由可见的集合边界开始。 |

## 1. NotebookLM / Gemini Notebook

### 阅读与信息组织

官方把 Notebook 定义为某个项目的一组来源，界面概念分为 Sources、Chat 和 Studio：前者控制材料，Chat 用来提问，Studio 保存笔记及生成物。Notebook 之间不能同时互相取材。Studio 提供报告、思维导图、卡片、测验和音视频等产物。[创建 Notebook](https://support.google.com/gemininotebook/answer/16206563?hl=en)

回答可通过引用预览和原文定位验证；保存为笔记时可保留表格与可点击行内引用。聊天设置包含学习引导、通用和自定义风格，以及回答长度。[聊天帮助](https://support.google.com/gemininotebook/answer/16179559?hl=en)

笔记既可手写，也可来自回答；来自回答的已保存笔记不能编辑。笔记支持转为来源、汇总、整理大纲和生成学习指南，以及导出 Google Docs / Sheets；导出后修改不反向同步。[笔记帮助](https://support.google.com/gemininotebook/answer/16262519)

### 学习闭环

卡片和测验可以指定难度与重点，显示解释、保存练习进度、复习答错内容；卡片可下载 CSV。思维导图节点可直接发起相关问题。[卡片与测验](https://support.google.com/gemininotebook/answer/16958963?hl=en)、[思维导图](https://support.google.com/gemininotebook/answer/16212283)

### 限制与付费边界

官方 FAQ 当前给出每来源 500,000 词或本地上传 200 MB，受复制保护的 PDF 可能无法导入；当来源过短时，引用可能只指向整份文档。[FAQ](https://support.google.com/gemininotebook/answer/16269187?hl=en)

新版额度说明写明 2026-09-02 起按计算量限制，受问题复杂度、模型、功能和聊天长度影响，并包含五小时及周额度；付费方案提高额度。升级页仍保留按天次数的旧式表格，本报告不混用两套数字。[额度说明](https://support.google.com/gemininotebook/answer/17670842?hl=en)、[升级页](https://support.google.com/gemininotebook/answer/16213268?hl=en)

**可借鉴的 UI 原则（推论）：** 把“正在使用哪些材料”和“这次学习留下了什么”做成可见对象。AIReader 不必照搬常驻三栏；可以保持 PDF 居中、辅助区收起，只在需要时展开证据预览或学习产物。

## 2. SciSpace

### 从文档中的困难点出发

Chat with PDF 支持对论文内容提问、按摘要/方法/结果等结构总结，并把回答保存到 Notebook。高亮通过文本选区浮动工具条完成，支持编辑、删除，以及导出带高亮文档。[Chat with PDF](https://scispace.com/help/en/articles/10660595-how-does-chat-with-pdf-work-chat-with-pdf-interacting-with-research-papers-using-ai)、[高亮](https://scispace.com/help/en/articles/10750976-how-to-highlight-text-in-chat-with-pdf)

专门的 Explain Math and Table 入口允许框选公式、表格和图示，再生成解释；官方建议精确选择范围并继续追问。[公式与表格帮助](https://scispace.com/help/en/articles/10719149-how-to-explain-math-and-tables-in-chat-with-pdf)

### 从阅读走向整理

回答可直接存入 Notebook，之后查看、编辑、整理并导出文档。另有结构化数据提取工具，可提取方法、结果等字段、比较多篇论文，并导出 CSV、Excel 或引用格式。[保存到 Notebook](https://scispace.com/help/en/articles/10741339-how-to-save-text-directly-to-your-notebook-in-scispace)、[数据提取](https://scispace.com/help/en/articles/10673503-how-do-i-extract-key-data-from-research-papers-extracting-data-from-research-papers-with-scispace-ai)

### 限制与付费边界

Chat with PDF 帮助页注明 100 MB 文件限制，并提示扫描图像未经 OCR 不能按文字进行分析。Agent 采用计算量相关积分，而官方强调独立工具与 Agent 的积分消费有区别；不能用 Agent 积分数量直接代替普通 PDF 问答限额。[PDF 要求](https://scispace.com/help/en/articles/10660595-how-does-chat-with-pdf-work-chat-with-pdf-interacting-with-research-papers-using-ai)、[积分规则](https://scispace.com/resources/credits-pricing-guide/)

**可借鉴的 UI 原则（推论）：** “解释这张图”应能直接从 PDF 里开始，并保留图片、页码和附近文字的来源关系。AIReader 已经可以上传截图，下一阶段价值在于减少截图、粘贴、补页码的手工步骤，而非重复增加上传按钮。

## 3. Adobe Acrobat AI Assistant

### 原文核验与工作空间

AI Assistant 可对 PDF 提问，使用建议问题和后续追问；点击来源编号返回相关原文。PDF Spaces 汇集文件、链接、笔记和上下文，并提供跨文件问答、保存回答为笔记与共享。[单文档问答](https://helpx.adobe.com/acrobat/using/get-ai-generated-answers.html)、[PDF Spaces FAQ](https://helpx.adobe.com/acrobat/desktop/explore-pdf-spaces/pdf-spaces-faq.html)

官方评审文档展示了选中文字后的上下文工具条，包含批注、高亮、删除线、下划线、复制和保存笔记。它把阅读动作放在选区旁边，而不是要求读者先找到一个复杂功能页面。[PDF Spaces 阅读与批注](https://helpx.adobe.com/in/acrobat/web/explore-pdf-spaces/review.html)

### 限制与付费边界

2026-09-01 更新的技术要求页列出：文件小于 100 MB、最多 600 页；问题小于 500 字符；文字选区小于 8,000 字符且不能跨页；AI Assistant 不支持图片或复杂矢量图形。该页支持的文档语言列表没有中文。以上是这份技术文档的范围，不应推断为所有 Acrobat 新功能永远都不支持这些内容。[技术要求](https://helpx.adobe.com/acrobat/desktop/use-acrobat-ai/get-started-with-generative-ai/ai-tech-requirements.html)

PDF Spaces 的授权随 Acrobat Studio、包含 AI 功能的计划或 AI Assistant 附加订阅提供；地区和语言也有限制。[PDF Spaces FAQ](https://helpx.adobe.com/acrobat/desktop/explore-pdf-spaces/pdf-spaces-faq.html)

**可借鉴的 UI 原则（推论）：** 精确引用、阅读工具可发现性与材料组织比复杂视觉效果更重要。AIReader 的中文技术书、跨页选区与图片问答可以成为值得打磨的细分能力，不需要追齐 Acrobat 的整套 PDF 编辑功能。

## 4. ChatPDF

### 低学习成本的入口

官方产品页强调上传后即开始问答、PDF 与聊天并排、点击引用滚动到原文，以及用文件夹组织多文件问答。免费试用无需账号，但保存历史和多文档聊天需要免费账号。[产品与 FAQ](https://www.chatpdf.com/)

### 可带走的学习结果

Flashcards 页面说明可从文档生成学习卡片，导出 Anki、Quizlet、Brainscape 格式或 CSV；免费计划有每日生成限制，Plus 扩大到无限卡片生成。该页面只作为官方功能宣称，本次没有验证导出格式或复习算法。[学习卡片](https://www.chatpdf.com/ai-flashcards)

### 限制与付费边界

产品页当前写明免费每天分析两份文档，Plus 提供不限文档分析与更多功能。本次没有登录查看结算价，也没有把“无限文档”扩展解释为所有功能、所有文件大小和所有模型均无限。[产品与 FAQ](https://www.chatpdf.com/)

**可借鉴的 UI 原则（推论）：** 核心入口应少而清楚；“比较两篇材料”需要一个明确、可见、可移除的来源集合；学习成果应可以导出，而不是只能在历史聊天中寻找。

## 5. 补充：成熟阅读工具如何处理“读完之后”

### Zotero：笔记保留原文关系

Zotero 可将批注拖入笔记、把选中批注添加到笔记，或从全部批注建立笔记；加入时携带引用与 PDF 页链接。笔记中的 Show on Page 能返回来源上下文。[PDF Reader 与笔记编辑器](https://www.zotero.org/support/pdf_reader)

Zotero 8 的外观面板集中提供滚动、双页、分屏和主题入口；文档视图设置按文档保存，主题则全局应用。它还加入全窗口笔记标签页，提供宽边距的专注编辑空间。这是 Zotero 8 发布时的官方功能说明，不表示它仍是最新版。[Zotero 8 发布说明](https://www.zotero.org/blog/zotero-8/)

**对 AIReader 的推论：** 笔记的核心对象应是“我的理解 + 可返回的来源”，而不仅是正文 JSON。右侧适合快速记录，长笔记可以展开阅读，但不必重新发明完整知识库。

### Readwise Reader：积累能离开应用

Reader 的 Notebook 面板提供整篇文档的笔记与高亮复制、Markdown 下载；还可通过 Readwise 同步到 Obsidian、Notion 等笔记工具。[导出帮助](https://docs.readwise.io/reader/docs/faqs/exporting)

PDF 内框选截图可作为图片高亮保存到 Notebook。但它的 PDF 视图和 Text view 高亮不会互相覆盖显示，虽然都能在 Notebook 查看；因此，双视图并不是没有一致性成本的简单升级。[PDF 帮助](https://docs.readwise.io/reader/docs/faqs/pdfs)

**对 AIReader 的推论：** 先做带来源信息与区域图片的 Markdown 导出，比立即接入所有云笔记平台更适合当前规模。保留统一定位体系，不为重排模式制造第二套无法互认的批注。

### LiquidText：关系与对照

LiquidText 把文档和笔记工作区并排放置，支持摘录与原文之间双向寻找、跨页内容连接，以及把相隔较远的文档片段放在一起对照。[功能介绍](https://www.liquidtext.net/features)、[深入介绍](https://www.liquidtext.net/liquidtextadeeperdive)

**对 AIReader 的推论：** 借鉴“来源近在手边”和临时对照，先做引用预览、原文返回与两处内容比较即可；无限画布和手写连线是另一种产品取向，当前不值得整体搬入。

## AIReader 的下一步建议（产品推论）

竞争资料支持一个共同方向：把一次性问答连接到原文核验和长期积累。下面是候选优先级，不是已承诺实现的范围，也不是来自用户行为数据的排名。

| 优先级 | 候选改进 | 用户能感受到的变化 | UI 方式 |
| --- | --- | --- | --- |
| 1：主线 | 可回源的学习笔记 | 用户明确保存、编辑好回答；保留原文定位与生成标识；回到该页能找到自己的理解和未解问题；能导出 Markdown、图片和出处 | 回答底部轻量“存为笔记”；笔记显示来源；导出在笔记或书籍菜单 |
| 1：配套 | 原位图表与公式问答 | 框选图表即可添加到问题，自动带页码和可核验的相邻文字；发送前明确看见实际发送范围 | 连接现有区域批注与截图聊天，复用附件区；提供“整页 / 框选”入口 |
| 1：配套 | 引用就近预览与返回位置 | 核验一句结论时不必离开当前页；需要跳转时可以直接回到原阅读位置 | 悬停或点击预览原文；跳转后提供返回入口 |
| 2 | 章节学习页 | 当前章的关键概念、待解问题、用户笔记与少量自测集中出现，支持继续上次学习 | 作为可关闭的章节面板或笔记内视图；不再常驻增加一列 |
| 2 | 整库备份与恢复 | 用户能恢复完整学习记录，安心长期积累 | 放在设置；文件导出与整库恢复是不同动作 |
| 3 | 主题集合与有限多文档比较 | 显式选择两三本书或论文，对比同一问题，引用指出文件和页码 | 从书库集合进入；发送区始终显示本轮启用材料 |
| 后续 | OCR、语音、视频、全自动研究等 | 扩大可处理材料和学习形式 | 先以真实使用痛点验证需求，避免把主阅读界面变成功能目录 |

建议先完成“读到难点 → 提问 → 核验 → 存为有出处的笔记 → 导出”的小闭环，再考虑学习卡片与多文档。理由是 AIReader 现有阅读、批注、笔记、聊天、选区和图片输入已经形成基础；把这些动作连起来，比继续增加并列入口更容易体现产品价值。

不自动把全部聊天转成笔记。用户选择值得留下的内容并编辑，系统继续区分原文摘录、AI 生成和用户撰写。本轮交付仅为调研与候选方向，未实施上述功能。

### 推荐的最小交付边界

上表的同等优先级不是要求一次开发完毕。第一项只承诺“一条已完成回答 → 本书可编辑笔记”：保留正文、AI 生成标识及已校验来源，切书与重启后可查找、编辑、回源，重复点击不会无提示地产生重复笔记。无有效出处的回答照实标记，不能凭空补出引用；不在这一步自动整理章节或合并多轮聊天。

紧随其后独立交付单篇笔记的 Markdown 与图片导出，保留书名、物理页/页码标签和出处文字；外部编辑器无法识别应用回跳链接时仍可人工定位。图表原位提问、引用预览和导航历史作为后续独立改进，避免一次同时更换输入、证据浮层和笔记保存三条流程。

### 界面方向

以下均为设计推论，需要以原型和实际阅读任务检验：

- 阅读区仍是视觉主体。保留紧凑工具栏，辅助面板按需展开，不把竞品的所有模块挤进同一屏。
- 输入区把“本轮材料”呈现为明确的原文片段 / 图片缩略图，并能预览和移除；模型与思考强度保持可见但不要压过书籍内容。
- 回答层级按“结论 → 可展开证据 → 后续动作”组织。公开推理摘要可以帮助理解过程，但不能代替引用是否支持结论的核验。
- 引用先弹出短原文与页码预览，再允许跳转；跳转后提供返回阅读位置，减少核验导致的迷路。
- “问答 / 笔记”切换不应让当前问题、草稿或阅读位置丢失；保存状态和生成状态使用局部反馈。
- 学习成果要标明“书中原文 / AI 整理 / 我的笔记”，避免用户日后复习时误把生成解释当成作者观点。

本轮 AIReader 界面观察指出，回答区同时出现“本轮依据 / 思考摘要 / 原文 / 详情”等多层入口，笔记首屏又集中出现新建、撤销、搜索和多个筛选控件。基于该观察，建议把低频管理操作放进菜单、把证据与过程详情合并为更少的展开入口，笔记首屏优先展示已有学习内容。这是本项目的 UI 判断，不是上述竞品的亲自试用结论，也尚未经过可用性测试。

### 下一轮验证建议

用固定材料、同一任务比较，而不依赖演示页观感：让读者解释一个图表、核验一个引用、保存一条笔记、第二天找回它。记录完成时间、操作数、失败点与引用能否支持结论；记录只是验证计划，不是本次实测结果。付费、正确性与用户偏好需另外测试，不能由功能表推出。
