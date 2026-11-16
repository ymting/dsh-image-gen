# 本 fork 与上游的差异

基线：`dsh-image-gen@0.11.3`（上游 `shanliuling/dsh-image-gen`）
本 fork：`ymting/dsh-image-gen`，版本号 `0.11.3-fork.1`

本 fork 的定位是「装完即用」：不改配置、不额外装东西，`npm/pnpm add` 完就能出图。
为了让这一点成立，做了两类改动——**能力补全** 和 **分发方式**。

---

## 一、能力补全：中转站兼容三件套

上游对 OpenAI 兼容中转站（relay）的适配偏保守，实际会遇到三个问题。三项都用
配置开关控制，**默认关闭，关闭时行为与上游逐字一致**。

### 1. 压缩响应体解码

| | |
|---|---|
| 开关 | 无（始终生效，只在上游会失败时救场） |
| 源码 | `src/openai-compatible.ts` → `decodeCompressedBody()` |

部分中转站用 zstd / gzip / brotli / deflate 压缩响应体，而运行时未必按
`content-encoding` 自动解码。结果是一段乱码喂给 `JSON.parse`，报出
`returned invalid JSON`——报错点和真实原因完全对不上，很容易误判成提示词或
站点问题。

判定顺序：先看 zstd 魔数 `28 b5 2f fd`（有些站点压缩但漏写 header），再看
声明的 content-encoding。解压失败说明声明与实际不符，原样返回交给上层解析，
绝不吞掉真实原因。

### 2. URL 优先 + b64 自动回退

| | |
|---|---|
| 全局开关 | `openaiCompatPreferUrl`（默认 `false`） |
| 渠道开关 | `openaiCompatChannels[].preferUrl`（默认 `false`，未设置时沿用全局） |
| 源码 | `src/openai-compatible.ts` → `generateOpenAICompatibleImage()` |

中转站内联 1.5–3MB base64，链路慢时会被超时截断，同样表现为 `invalid JSON`。
开启后请求带 `response_format: 'url'`，服务端只回一个短链接（响应几百字节），
彻底绕开传输瓶颈。

但链接可能指向当前网络不可达的 CDN，所以**取图失败会自动回退**：重新请求一次
不带 `response_format` 的生成请求，让服务端改为内联 base64。

回退只在取图/解析类失败时触发（`download` / `no image` / `invalid JSON` /
`no image data`）；请求本身被 4xx/5xx 拒绝时直接抛出，不做无意义重试。

- 显式写在 `extraBody.response_format` 里的值永远不会被覆盖；
- `accept-encoding` 只声明 `gzip, deflate`，主动避开运行时不解码 zstd 的路径。

### 3. `aspect_ratio` 方向修复（**已上游化，不再是 fork 差异**）

| | |
|---|---|
| 源码 | `src/studio.ts` → `openAIRequestSize()` / `chatToolSize()`、`src/index.ts` 工具路径 |
| 状态 | ✅ 已作为 PR #138 合入上游，**v0.11.3 起由上游维护**，本 fork 不再单独持有 |

> **v0.11.3 合并说明**：本节内容已随 `v0.11.3` 进入上游主流，fork 侧的实现已
> 与上游对齐（`chatToolSize` 取自上游版本，含「空档位取最低配置档」的语义）。
> 保留本节是为了记录问题成因；改动这一块时要以上游代码为准，勿按本节旧描述改回。

两处缺口：

1. 对话工具在 `openai-compat` 下完全不读 `aspect_ratio`，size 链是
   `args.size ?? active.imageSize`，参数被静默丢弃，一律按 `1024x1024` 出方图；
2. `openAIRequestSize` 对表里没有的比例一律退回 `1024x1024`。内置
   `LEGACY_OPENAI_TABLE` 只有 1:1 / 3:2 / 2:3，而工具 schema 和比例选择器都
   宣称支持十种。

修法：工具路径改用与工作台相同的 `openAIRequestSize`（同一份渠道配置），
fallback 改为比较比例两边——竖构图给 `1024x1536`，横构图给 `1536x1024`，
只有 1:1 或无法解析时才给方形。渠道自己配了精确尺寸的仍然优先。

### 4. 分阶段计时日志（诊断用）

| | |
|---|---|
| 开关 | 环境变量 `DSH_IMAGE_GEN_TIMING`（默认关闭） |
| 源码 | `src/debug-timing.ts` |

出图慢时分不清是「服务端出图慢」还是「CDN 下载慢」还是「落盘慢」。开启后按
stage 追加一行：`gen.start` / `gen.total` / `download.done` / `download.fail` /
`tool.result` / `gen.fallback`。

```bash
# 写到默认位置 ~/.dsh/image-gen-timing.log
DSH_IMAGE_GEN_TIMING=1

# 或写到指定文件
DSH_IMAGE_GEN_TIMING=/tmp/image-gen.log
```

默认关闭，不影响正常使用的性能与磁盘。任何写入异常都被吞掉——诊断代码绝不
影响出图主流程。

---

## 二、分发方式：「装完即用」

上游的 `.gitignore` 直接忽略整个 `lib/`，`prepare` 每次都跑完整构建。作为
**git 依赖或压缩包**安装时这条路会断：

- `pnpm` 默认拦下依赖的 build script → 构建不跑 → `lib/` 不存在 → 插件加载失败；
- 现场构建还要求 devDependencies 齐全，而装插件不该有这种前置。

本 fork 的处理：

| 改动 | 位置 | 原因 |
|---|---|---|
| `lib/index.js`、`lib/client.js`、`lib/types/**/*.d.ts` 纳入版本控制 | `.gitignore` | 安装即用，不需要构建权限 |
| 忽略 `lib/**/*.map`、`lib/types/**/*.js`、`lib/types/**/*.json` | `.gitignore` | sourcemap 与 tsc 中间产物纯属冗余，素材 JSON 已编译内联 |
| **彻底删除** `prepare`，产物守卫挂到 `prepack` | `package.json` | pnpm 只要看到依赖声明了安装期脚本（prepare/preinstall/install/postinstall），就要求 `allowBuilds` 白名单，否则 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 中断安装。即使守卫脚本本身「什么都不做」也会被判定为需要执行——唯一可靠的做法是根本没有脚本 |
| 新增产物新鲜度守卫 `scripts/check-lib-fresh.mjs` | `package.json` → `prepack` | 产物缺失、或任一源文件比入口产物新（带 2 秒容差）就报错。只在 pack/publish 时触发，不影响安装 |
| `files` 保持原样 | `package.json` | 已包含 `lib/index.js` / `lib/client.js` / `lib/types/**/*.d.ts` |

产物与源码脱节的代价是「装完即用」的隐性风险，所以用 `prepack` 挡在发布侧，
而不是用 `prepare` 挡在安装侧。手动校验：

```bash
node scripts/check-lib-fresh.mjs
```

### 安装方式

```bash
# 方式 A：git 依赖（固定 commit，可复现）
pnpm add "dsh-image-gen@github:ymting/dsh-image-gen#<commit>"

# 方式 B：本地 link（开发时改源码即时生效）
pnpm add "dsh-image-gen@link:C:/my_projects/AI图片/github/dsh-image-gen"

# 方式 C：registry（发布后）
pnpm add dsh-image-gen@<version>
```

三条路都不需要现场构建，因为 `lib/` 已经在仓库里。

---

## 三、验证

```bash
pnpm run typecheck                              # 通过
pnpm run build                                  # 通过
node scripts/check-lib-fresh.mjs                # 产物齐全且不早于源码
npx vitest run tests/fork-relay-compat.spec.ts \
              tests/openai-compat-ratio.spec.ts # 20/20 通过
```

`tests/fork-relay-compat.spec.ts` 覆盖：四种压缩格式、zstd 魔数识别、声明与实际
不符时原样返回、preferUrl 开关、b64 回退、extraBody 不可被覆盖、4xx 不回退、
计时日志三种开关状态。全部 `vi.stubGlobal` 伪造 fetch，不触网。

### 已知的非本 fork 问题

`tests/studio.spec.ts > triggers upstream abort signal when browser fetch is
aborted after body upload` 是时序 flaky（等待 50ms 后在断言 `serverAbortFired`）。
在**未打任何改动**的原始源码上连跑三次，同样会 1 失败 2 通过。

---

## 四、上游跟进

上游出新版时的流程：

```bash
git fetch upstream --tags
git checkout -b merge/vX.Y.Z
git merge vX.Y.Z --no-edit        # 合并而非 rebase：fork 已发布 tag，改写历史会断链
# 解决冲突 → pnpm typecheck && pnpm test && pnpm build
git tag vX.Y.Z-fork.1 && git push origin merge/vX.Y.Z --tags
```

**2026-11-16 已按此流程合并 v0.11.3**（fork 版本 `0.11.3-fork.1`）。这次的实际冲突点：

- `src/studio.ts`：与上游 `chatToolSize` 的注释段落冲突 —— 全部取上游版本（上游
  的 `chatToolSize` 比 fork 原实现新，多了「空档位取该比例最低配置档」的语义）；
- `src/index.ts`：import 行冲突 —— 取上游（不再从 studio 引 `openAIRequestSize`，
  它已由 `chatToolSize` 内部消化）；
- `tests/pr138-review-followup.spec.ts` 与上游新增的 `tests/chat-tool-size.spec.ts`
  重复（同一批断言，上游是英文版）。删掉前者，其中 fork 独有的
  `sanitizeUrlForLog` 用例迁移到 `tests/fork-url-redact.spec.ts`。

合并后能力集：上游的 aspect 修复 + fork 的压缩解码 / URL 优先 / 计时日志 全部在位，
`pnpm test` 1190 通过。

三项能力中，第 3 项已被上游吸收；第 1、2 项仍是 fork 独有，且都做成配置开关且默认
关闭，因此即使上游将来合入，也不会产生行为冲突——最坏情况是配置项重复，删掉本
fork 的对应实现即可。
