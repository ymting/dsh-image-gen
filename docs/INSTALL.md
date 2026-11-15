# 全新安装与配置指南

面向「一台干净的 DeepSeek-Harness，从零把 dsh-image-gen 装起来」的场景。
本 fork（`ymting/dsh-image-gen`）的 `lib/` 已随仓库分发，**安装时不需要任何构建步骤**。

---

## 一、前置检查

| 项 | 要求 | 检查命令 |
|---|---|---|
| DeepSeek-Harness | 稳定版，已有可用 profile | 打开 DSH 能进对话 |
| Node.js | `^22.19.0` 或 `>=24.0.0` | `node --version` |
| git | 装 git 源时才需要，且**必须在 PATH 里** | `git --version` |
| 网络 | 拉 GitHub 需要能通；国内环境通常要走代理 | 见下文「代理」 |

### 代理（国内环境必看）

`pnpm` 拉 git 仓库**不读系统代理**，必须显式给环境变量，否则报
`Could not connect to github.com:443`：

```powershell
$env:HTTP_PROXY  = 'http://127.0.0.1:7890'   # 换成你自己的代理地址
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
```

git 不在 PATH 时（`git` 报「不是内部或外部命令」）：

```powershell
$env:PATH = "C:\Program Files\Git\cmd;$env:PATH"
```

---

## 二、安装

> 下面 `<DSH>` 指你的 DSH 可执行方式。若 `dsh` 不在 PATH，用 DSH 自带的
> `pnpm dsh` 或 DSH 安装目录里的启动器替代。

### 方式 A：git 源 + 固定 commit（推荐）

```bash
# profile 名按需替换（常见为 desktop / web）
pnpm dsh plugin --profile desktop add "dsh-image-gen@github:ymting/dsh-image-gen#<commit>"
```

固定 commit 而不是分支，保证可复现——分支被别人改动不会影响你。

**为什么不会卡在构建上**：`lib/index.js`、`lib/client.js`、`lib/types` 都在仓库里，
且 `package.json` 里**没有任何安装期脚本**（`prepare`/`preinstall`/`install`/`postinstall`）。
pnpm 只在依赖声明了这类脚本时才要求 `allowBuilds` 白名单，没有脚本就没有这道坎。

如果仍遇到 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`，说明装的是上游版本而非本 fork，
把依赖换成上面的 git spec 即可。

### 方式 B：本地源码 link（开发/调试）

```bash
git clone https://github.com/ymting/dsh-image-gen.git
pnpm dsh plugin --profile desktop add "dsh-image-gen@link:/绝对路径/dsh-image-gen"
```

改 `src/` 后需要 `pnpm run build` 重新生成 `lib/`，再重载插件。适合自己改代码。

### 方式 C：手动写 profile（不想用 CLI 时）

编辑 `~/.dsh/profiles/<profile>/package.json`：

```json
{
  "dependencies": {
    "dsh-image-gen": "github:ymting/dsh-image-gen#<commit>"
  },
  "dsh": {
    "profile": {
      "bundles": [ "...", "dsh-image-gen" ]
    }
  }
}
```

然后在 profile 目录执行安装：

```bash
cd ~/.dsh/profiles/<profile>
pnpm install
```

**`dsh.profile.bundles` 里必须出现 `dsh-image-gen`**，否则包装了也不会被加载。

---

## 三、首次启动

bundle 列表是 DSH **启动时**组合的，所以新装一个 bundle 后要**重启 DSH**。

重启后打开插件面板：**左侧边栏「插件」图标 → 「已安装」→ dsh-image-gen**。

> DSH 0.1.5 及更早版本没有插件面板，走 **设置 → 插件 → 插件配置 → 图像生成**。

点进去就是「图像生成」配置表单。

---

## 四、配置密钥

两条路，任选其一。

### 路径 1：用设置面板填（推荐，新手用这条）

在插件详情页选 Provider，填 API Key，点保存。特征：

- 页面**不会读回明文**，提示文案是「留空即可保留已配置的 Key」；
- Key 存进 DSH 的凭证库 `~/.dsh/.credentials.yaml`，键名按渠道自动生成；
- 填完可以点「测试连接」验证，或点「拉取模型」自动获取该厂商可用模型。

订阅通道（ChatGPT / Grok / Google）不用填 Key：展开订阅行 → 点「登录」→ 浏览器授权。

### 路径 2：手写配置（高级，多渠道路径用这条）

编辑 `~/.dsh/profiles/<profile>/cordis.patch.yml`，在 `image-gen` 段里配渠道：

```yaml
- id: image-gen
  name: dsh-image-gen
  config:
    provider: openai-compat
    openaiCompatModel: gpt-image-2.6
    openaiCompatActiveChannel: channel-xxxx        # ← 决定实际用哪个渠道
    openaiCompatPreferUrl: true                    # ← 可选：url 优先、失败回退 b64
    openaiCompatChannels:
      - id: channel-xxxx
        label: 我的中转站
        keyRef: DSH_IMAGE_GEN_OPENAI_COMPAT_KEY_CHANNEL_XXXX   # 只是引用名，不是真 key
        baseURL: https://你的中转站域名/v1
        model: gpt-image-2.6
        models:
          - gpt-image-2.6
        sizes:
          1:1: { 1K: 1024x1024 }
          3:4: { 1K: 864x1152 }
```

**关键点：`keyRef` 只是凭证库里的一条引用名，真值不放配置文件。**

命名规则（代码里硬编码的）：

| 渠道 | keyRef |
|---|---|
| 默认渠道（`id: default`） | `DSH_IMAGE_GEN_OPENAI_COMPAT_KEY` |
| 其它渠道（`id: channel-abc`） | `DSH_IMAGE_GEN_OPENAI_COMPAT_KEY_CHANNEL_ABC` |

即：`DSH_IMAGE_GEN_OPENAI_COMPAT_KEY_` + 渠道 id 转大写、非字母数字换成下划线。

真 key 写进 `~/.dsh/.credentials.yaml` 的 `refs` 段，或用设置面板填一次让它自动写入
（更省事，也避免手抄出错）。

### 几个容易踩的坑

| 坑 | 说明 |
|---|---|
| `openaiCompatActiveChannel` 才是生效渠道 | 顶层的 `openaiCompatBaseURL` / `openaiCompatModel` 只是默认渠道的值，会被它覆盖。只往 `openaiCompatChannels` 加新渠道而不改这一项，等于没生效 |
| `baseURL` 要带 `/v1` | 插件会拼 `images/generations`，漏了 `/v1` 会打到站点首页并返回 HTML，报 `invalid JSON` |
| `preferUrl` 与 `extraBody.response_format` | `preferUrl` 是"url 优先 + 失败回退 b64"；`extraBody` 里显式写的 `response_format` 优先级更高且不会被覆盖 |

---

## 五、验证

### 1. 配置是否被读到

```bash
dsh --profile <profile> --dump-config
```

输出里应能看到 `dsh-image-gen` 这一层和 `image-gen` 行。

### 2. 插件是否加载成功

插件面板的「已安装」里 dsh-image-gen 的状态应为正常（不是红色错误）。

### 3. 真实出图

在对话里直接说：

```text
画一张雨夜霓虹街头的赛博朋克猫，电影感光线，16:9。
```

或让 Agent 调工具：`生成一张戴墨镜的赛博朋克猫图片`。

成功标志：一条 `generate_image` 调用返回，图片渲染在对话里。

### 4. 打开诊断计时（可选，排查慢的问题）

```bash
# Windows PowerShell
$env:DSH_IMAGE_GEN_TIMING = '1'
# 或写到指定文件
$env:DSH_IMAGE_GEN_TIMING = 'C:\temp\image-gen.log'
```

启用后每次出图会按 stage 追加一行日志（`gen.start` / `gen.total` / `download.done` /
`tool.result` / `gen.fallback`），能分清是服务端出图慢、CDN 下载慢还是落盘慢。
默认关闭，不影响正常使用。

---

## 六、改配置后要不要重启

| 改动 | 是否需要重启 DSH |
|---|---|
| 首次安装 bundle（`bundles` 列表新增一项） | **需要重启**（bundle 树在启动时组合） |
| 改 `cordis.patch.yml` 里的 `config` 值 | 一般重载插件即可（`set_plugin` 先 false 再 true）；不确定就重启 |
| 改插件源码 / 换包版本 | 需要重载插件；模块缓存会保留旧代码，只重载配置不够 |
| 改 `lib/index.js` 内的逻辑 | 必须重载插件（改源码 ≠ 改配置） |

重载插件的等效操作（有 `plugin_manager` 工具时）：

```
set_plugin(target="include:image-gen", enabled=false)
set_plugin(target="include:image-gen", enabled=true)
```

---

## 七、卸载

```bash
pnpm dsh plugin --profile <profile> remove dsh-image-gen
```

`~/.dsh/.credentials.yaml` 里已保存的 Key 不会自动删除——如果确定不再需要，
手动清掉对应的 `DSH_IMAGE_GEN_OPENAI_COMPAT_KEY*` 条目。

---

## 八、本 fork 与上游的行为差异

只在以下场景体现，默认全部关闭，正常使用与上游一致：

| 能力 | 开关 | 什么时候有用 |
|---|---|---|
| 压缩响应体解码（zstd/gzip/br/deflate） | 无，自动 | 中转站压缩响应，上游会误报 `invalid JSON` |
| URL 优先 + b64 回退 | `openaiCompatPreferUrl` / 渠道级 `preferUrl` | 中转站内联超大 base64 导致超时 |
| `aspect_ratio` 方向修复 | 无，自动 | 竖构图请求被静默压成方图 |
| 分阶段计时日志 | 环境变量 `DSH_IMAGE_GEN_TIMING` | 出图慢，需要定位卡在哪一段 |

详细说明见 [FORK.md](./FORK.md)。
