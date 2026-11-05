# Audacity Web

> 基于 React + Rust/WASM 的 Web 版多轨音频编辑器，参考 Audacity 的界面与工作流设计。
> **这是一个独立的 Web 重构实现，不隶属于 Audacity 官方团队，也不冒充官方产品。** Audacity 是其各自所有者的商标。

![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)
![Docs: CC BY 3.0](https://img.shields.io/badge/Docs-CC%20BY%203.0-lightgrey.svg)
![React](https://img.shields.io/badge/React-19-61dafb)
![Rust](https://img.shields.io/badge/Rust-WASM-ce422b)
![PWA](https://img.shields.io/badge/PWA-Ready-5a0fc8)
![Tests](https://img.shields.io/badge/Tests-Vitest-729b1a)

- **在线体验**：https://qixinia.github.io/audacity-web-pwa/
- **完整源码**：https://github.com/QiXinia/audacity-web-pwa

---

## 功能矩阵

### 核心编辑能力

| 功能 | 状态 | 说明 |
|------|------|------|
| 多轨音频编辑 | ✅ | 支持多轨道导入、录音、叠加播放 |
| 波形显示 | ✅ | 实时波形渲染，支持缩放与滚动 |
| 频谱视图 | ✅ | FFT 频谱分析视图，切换波形/频谱/混合显示 |
| 选区编辑 | ✅ | 剪切、复制、粘贴、裁剪、删除 |
| 非破坏性时间拉伸 | ✅ | 片段级 WSOLA 拉伸，0.25×–4×，保持音高并贯穿播放、分割、编辑与导出 |
| Shift 片段多选 | ✅ | 跨轨不连续选择，支持成组移动、修剪、拉伸、删除与速度复位 |
| 基础效果 | ✅ | 增益、淡入、淡出、标准化、反转、静音、移除直流 |
| 撤销 / 重做 | ✅ | 命令历史栈 + IndexedDB 持久化，刷新可恢复 |
| 实时播放 | ✅ | Web Audio API 驱动，带播放头与游标 |
| 窄屏与触屏编辑 | ✅ | 工具栏横向滚动；片段移动、修剪与拉伸使用 Pointer Capture 且禁用手势抢占 |
| 录音 | ✅ | AudioWorklet 低延迟采集 + ScriptProcessor 降级 |
| 立体声支持 | ✅ | 立体声数据贯穿导入、编辑、播放、持久化、导出全链路 |
| 重采样 | ✅ | 导入采样率与工程不一致时自动重采样（线性插值） |

### 导出格式

| 格式 | 状态 | 实现方式 |
|------|------|----------|
| WAV PCM 16-bit 立体声 | ✅ | WASM / JS 软件编码 |
| WAV Float 32-bit 立体声 | ✅ | WASM / JS 软件编码 |
| MP3 128 kbps 立体声 | ✅ | @breezystack/lamejs 纯 JS MP3 编码器（真实编码，非改名 WAV） |

> MP3 导出使用 [@breezystack/lamejs](https://github.com/shijinyu/lamejs) 纯 JavaScript MP3 编码器，无需依赖浏览器 MediaRecorder，所有浏览器均支持。

### 实时效果链（每轨道独立）

| 效果器 | 状态 |
|--------|------|
| 增益 (Gain) | ✅ |
| 三段均衡器 (EQ) | ✅ |
| 压缩器 (Compressor) | ✅ |
| 混响 (Reverb) | ✅ |
| 延迟 (Delay) | ✅ |
| 噪声门 (Noise Gate) | ✅ |
| 高通滤波器 (High Pass) | ✅ |
| 低通滤波器 (Low Pass) | ✅ |

### 工程管理

| 功能 | 状态 |
|------|------|
| 新建 / 重命名 / 删除工程 | ✅ |
| 回收站 / 恢复 | ✅ |
| 搜索工程 | ✅ |
| IndexedDB 本地持久化 | ✅ |
| Workspace 工作区 | ✅ | Classic / Modern / Music 预设、自定义布局、轨道面板与混音器显隐 |
| 撤销/重做持久化（刷新可恢复） | ✅ |

---

## 技术栈

- **React 19 + TypeScript**：类型安全的前端架构
- **Rust/WASM 加速**：计算密集的 DSP 模块（FFT、增益、滤波、压缩器等）用 Rust 实现，编译为 WASM；同时提供纯 JS 降级保证可用性
- **IndexedDB (Dexie)**：工程、音频 Buffer、撤销栈快照本地持久化
- **Web Audio API**：实时音频播放与处理；AudioWorklet 低延迟录音
- **PWA**：manifest + Service Worker 离线缓存 + 版本更新提示
- **Tailwind CSS v4 + shadcn/ui**：现代化 UI 组件库
- **@breezystack/lamejs**：纯 JS MP3 编码器
- **Vitest**：单元测试框架

---

## 快速开始

### 前置要求

- Node.js ≥ 20
- npm ≥ 10
- （可选）Rust + wasm-pack：仅在重新编译 WASM 模块时需要；仓库已包含构建好的 WASM 与 JS glue

### 安装与运行

```bash
# 安装依赖
npm install

# 开发模式运行
npm run dev

# 生产构建
npm run build

# 类型检查
npm run typecheck

# 运行单元测试
npm test

# 测试 watch 模式
npm run test:watch
```

### 重新编译 WASM 模块（可选）

仓库已包含 `public/wasm/audio_processor.js` 和 `public/wasm/audio_processor_bg.wasm`，普通开发与部署无需安装 Rust。修改 Rust 源码后，使用以下命令同步生成绑定层和二进制：

```bash
# 安装 Rust 工具链（如未安装）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 安装 wasm-pack 并编译
cargo install wasm-pack --locked
npm run build:wasm
```

应用启动时自动加载 WASM；加载失败才使用 JavaScript 降级实现。在「设置 → 性能与技术」中可以查看当前实际状态。

---

## 部署到 GitHub Pages

当前仓库采用**本地手动编译、静态分支发布**。向 `main` 推送源码不会触发自定义 Actions 自动部署；线上静态文件由维护者从本地 `dist` 发布到 `gh-pages` 分支。

### 手动发布步骤

```bash
# 1. 安装依赖并执行完整验证
npm ci
npm run lint
npm test

# 2. 使用 Pages 子路径构建；构建脚本会同时生成 404.html
VITE_APP_BASE=/audacity-web-pwa/ npm run build

# 3. 仅将本地 dist 发布到 gh-pages（不会把 dist 提交进 main）
npx --yes gh-pages@6.3.0 -d dist -b gh-pages -m "Manual Pages deploy"
```

仓库 Settings → Pages 应选择 **Deploy from a branch**，分支为 `gh-pages`，目录为 `/(root)`。发布命令需要当前 Git 凭据具备仓库写权限。

`.github/workflows/deploy.yml` 仅保留 `workflow_dispatch` 作为可选的人工灾备入口，不参与日常发布，也没有 `push` / `pull_request` 自动触发。GitHub 官方的 `pages-build-deployment` 是静态分支发布后的托管机制，不执行本项目的编译工作流。

构建时设置 `VITE_APP_BASE=/audacity-web-pwa/` 以适配 Pages 子路径，包括：
- JS / CSS / WASM / Worklet 资源路径
- PWA manifest start_url / scope
- Service Worker 缓存路径与 navigateFallback
- 图标与静态资源引用

### 本地验证 Pages 构建

```bash
# 使用 Pages 子路径配置构建
VITE_APP_BASE=/audacity-web-pwa/ npm run build

# 使用相同子路径预览构建结果
VITE_APP_BASE=/audacity-web-pwa/ npm run preview
```

### SPA 路由刷新 404 处理

GitHub Pages 是静态托管，直接访问子路径（如 `/editor/xxx`）会 404。`scripts/build.sh` 会复制 `index.html` 为 `404.html`，确保所有路由都能返回应用壳，由前端路由接管。

---

## 测试

项目使用 Vitest 进行单元测试，覆盖以下模块：

| 测试文件 | 覆盖内容 | 用例数 |
|----------|----------|--------|
| `src/lib/audioUtils.test.ts` | 格式化工具、数学计算、重采样、声道交叉 | 24 |
| `src/wasm/processor.test.ts` | WAV 编解码、DSP 函数（normalize/reverse/gain/fade/phase/peak/rms）、缓冲区工具 | 24 |
| `src/wasm/selection-ops.test.ts` | 选区截取、删除、插入、替换操作 | 18 |
| `src/services/historyService.test.ts` | 撤销/重做命令栈、push/undo/redo/clear | 9 |
| `src/services/clipboardService.test.ts` | 多声道剪贴板序列化、旧格式恢复、异常输入 | 4 |
| `src/engine/audioEngine.test.ts` | 立体声声像、增益、修剪偏移、拉伸导出时间轴 | 5 |
| `src/engine/audioEngine.recording.test.ts` | Worklet 尾帧等待、双声道降级、停止超时、初始化清理 | 4 |
| `src/engine/recordingWorklet.test.ts` | 真实 Worklet 任意尾块 flush、停止确认与去重 | 2 |
| `src/engine/timeStretch.test.ts` | WSOLA 时长、音高、立体声对齐与归一化幅度 | 6 |
| `src/lib/clipEditing.test.ts` | 跨轨多选、成组编辑、速度复位起点保持、非破坏性分割与删除边界 | 12 |
| `src/services/workspaceService.test.ts` | 内置工作区、自定义布局、自动更新与旧数据迁移 | 6 |
| `src/engine/mp3Encoder.test.ts` | 真实 MPEG 输出、采样率选择、空输入边界 | 3 |

当前完整前端回归共 **12 个测试文件、117 项测试**；Rust/WASM 另有 **4 项** WSOLA 单元测试。

运行测试：

```bash
# 全量测试
npm test

# 查看测试覆盖率（如配置）
npx vitest run --coverage
```

---

## PWA 与离线验证

### 功能特性

- **离线启动**：Service Worker 预缓存应用壳（HTML / CSS / JS / 图标），断网后仍可打开应用
- **工程离线恢复**：工程数据存储在 IndexedDB，离线状态下可打开和编辑已有工程
- **版本更新**：有新版本时提示用户刷新，避免新旧版本混用
- **旧缓存清理**：新版本激活后自动清理旧版本缓存
- **WASM 缓存**：WASM 模块纳入预缓存，离线也可使用

### 离线验证步骤

1. 执行生产构建：`npm run build`
2. 启动本地预览服务：`npm run preview`
3. 用 Chrome 打开应用，等待页面加载完成
4. 打开 DevTools → Application → Service Workers，确认 SW 已注册并激活
5. 勾选 "Offline" 模拟断网
6. 刷新页面 — 应用应正常加载（显示 UI 和已有工程）
7. 打开一个已有工程 — 工程数据和音频波形应正常显示
8. 取消 "Offline"，验证应用恢复正常联网状态

### 已知限制

- **开发模式下 PWA 不启用**（`devOptions.enabled: false`），请用生产构建验证
- 首次访问必须联网以缓存资源
- 工程数据存储在 IndexedDB 中，清除浏览器数据会导致工程丢失

---

## 工程结构

```
audacity-web/
├── src/
│   ├── app.tsx                 # 路由配置
│   ├── index.tsx               # 入口文件（含 PWA SW 注册）
│   ├── vite-env.d.ts           # Vite + PWA 类型声明
│   ├── types/
│   │   └── project.ts          # 核心类型定义
│   ├── db/
│   │   └── audioDb.ts          # IndexedDB 数据库（Dexie，含历史快照表）
│   ├── engine/
│   │   ├── audioEngine.ts      # 音频引擎（播放/录音/混音/导出）
│   │   ├── timeStretch.ts      # WSOLA JavaScript 降级实现
│   │   ├── recordingWorklet.test.ts # 真实录音 Worklet 边界测试
│   │   └── mp3Encoder.ts       # MP3 编码器封装（基于 @breezystack/lamejs）
│   ├── wasm/
│   │   ├── processor.ts        # WASM 加载层 + 纯 JS 降级实现
│   │   ├── processor.test.ts   # WASM/JS DSP 测试
│   │   ├── selection-ops.test.ts # 选区编辑操作测试
│   │   └── audio_processor/    # Rust 源码（WASM 模块）
│   │       ├── Cargo.toml
│   │       └── src/
│   │           ├── lib.rs
│   │           └── wav.rs
│   ├── services/
│   │   ├── projectService.ts   # 工程 CRUD / 轨道管理 / 音频导入
│   │   ├── historyService.ts   # 撤销/重做命令栈 + IndexedDB 持久化
│   │   ├── workspaceService.ts # 内置与自定义 Workspace 布局
│   │   └── historyService.test.ts
│   ├── lib/
│   │   ├── clipEditing.ts      # 多选片段的成组编辑纯函数
│   │   ├── audioUtils.ts       # 工具函数（含重采样、声道交叉）
│   │   └── audioUtils.test.ts
│   ├── test/
│   │   └── setup.ts            # Vitest 全局 setup
│   ├── components/             # 共享组件（Header / Footer / Layout）
│   │   └── ui/                 # shadcn/ui 组件库
│   └── pages/
│       ├── ProjectManagerPage/ # 工程管理器（首页）
│       ├── AudioEditorPage/    # 音频编辑器（核心）
│       ├── SettingsPage/       # 设置页
│       └── NotFoundPage/       # 404 页
├── public/
│   ├── manifest.json           # 静态备用 manifest；生产构建使用 manifest.webmanifest
│   ├── favicon.svg
│   ├── icon-192.png            # PWA 图标 192x192
│   ├── icon-512.png            # PWA 图标 512x512（maskable）
│   ├── wasm/                   # wasm-pack 生成的 JS glue、d.ts 与 .wasm
│   └── worklets/
│       └── recording-processor.js  # AudioWorklet 录音处理器
├── index.html
├── package.json
├── vite.config.ts              # Vite、PWA 与 Vitest 配置
├── tsconfig.json
├── LICENSE                     # GPLv3
└── README.md
```

---

## 浏览器兼容性

| 功能 | Chrome | Firefox | Safari | Edge |
|------|--------|---------|--------|------|
| 音频播放 | ✅ | ✅ | ✅ | ✅ |
| AudioWorklet 录音 | ✅ | ✅ | ✅ (14.1+) | ✅ |
| ScriptProcessor 降级录音 | ✅ | ✅ | ✅ | ✅ |
| IndexedDB | ✅ | ✅ | ✅ | ✅ |
| WASM | ✅ | ✅ | ✅ | ✅ |
| PWA 安装 | ✅ | ✅ | ✅ (16.4+) | ✅ |
| WAV 导出（16/32-bit） | ✅ | ✅ | ✅ | ✅ |
| MP3 导出（@breezystack/lamejs） | ✅ | ✅ | ✅ | ✅ |
| 立体声支持 | ✅ | ✅ | ✅ | ✅ |
| 撤销/重做持久化 | ✅ | ✅ | ✅ | ✅ |

> **注意**：
> - AudioWorklet 不支持时自动降级到 ScriptProcessorNode（功能等效，延迟略高）
> - MP3 导出由 @breezystack/lamejs 纯 JS 实现，不依赖浏览器编码能力，所有现代浏览器均支持
> - WAV 导出由软件实现，所有浏览器均支持

---

## 存储说明

- 所有工程与音频素材保存在浏览器本地（IndexedDB）
- 不涉及任何后端服务器、云端同步或用户账号
- 浏览器存储配额有限（通常 500MB ~ 数 GB），长时录音请注意存储空间
- 撤销历史快照也保存在 IndexedDB 中，默认最多 20 个持久化快照，避免占用过多空间
- 清除浏览器数据会导致工程和历史记录丢失，建议定期导出重要工程

---

## 开源许可

### 程序代码

**GNU General Public License v3.0** — 详见 [LICENSE](LICENSE)

```
Audacity Web - Web-based multi-track audio editor
Copyright (C) 2026 Audacity Web contributors

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```

### 文档

**Creative Commons Attribution 3.0 Unported (CC BY 3.0)**

您可以自由：
- 共享 — 在任何媒介以任何形式复制、发行本作品
- 改编 — 修改、转换或以本作品为基础进行创作

惟须遵守下列条件：
- **署名** — 您必须给出适当的署名，提供指向本许可协议的链接，同时标明是否（对原始作品）作了修改。

### 第三方组件

第三方组件保留各自许可。MP3 编码器的 LGPL-3.0 文本与声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

## 独立非官方实现声明

本项目是独立开发的 Web 音频编辑器，参考了 Audacity 的界面布局与编辑工作流，但**不是** Audacity 官方产品，也**不隶属于** Audacity 团队或 Muse Group。

- Audacity 官方网站：https://www.audacityteam.org/
- Audacity 官方仓库：https://github.com/audacity/audacity

Audacity® 是其各自所有者的商标。本项目仅用于学习与探索目的，不冒充官方产品。

---

## 贡献

欢迎提交 Issue 和 Pull Request！

---

## 致谢

- 灵感来自 [Audacity](https://www.audacityteam.org/) — 开源音频编辑的标杆
- UI 组件基于 [shadcn/ui](https://ui.shadcn.com/)
- 音频处理基于 [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- MP3 编码基于 [@breezystack/lamejs](https://github.com/shijinyu/lamejs)
- PWA 基于 [vite-plugin-pwa](https://vite-pwa-org.netlify.app/)
