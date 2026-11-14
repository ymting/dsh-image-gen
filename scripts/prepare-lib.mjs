/**
 * prepare 钩子：保证「装完就能用」。
 *
 * 上游的做法是每次 prepare 都跑完整构建（clean-lib + tsc + tsdown），这要求
 * 装上 devDependencies 并且允许执行构建脚本。作为 git 依赖或压缩包安装时，
 * 这两条都可能不成立：pnpm 默认会拦下依赖的 build script，构建脚本被拒 →
 * lib/ 不存在 → 插件加载失败。
 *
 * 本 fork 把构建产物一并提交进仓库，因此这里先判断产物是否齐全：
 * - 齐全：直接跳过构建，安装过程不需要任何构建权限；
 * - 缺失：才回退到真实构建，明确报错而不是留下一个空壳。
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 宿主入口与浏览器入口都是运行期必需；缺任一个都不算可用产物
const required = ['lib/index.js', 'lib/client.js']

const present = required.filter(relative => {
  const full = resolve(repoRoot, relative)
  // 0 字节文件等于不存在，避免把中断的构建当成功
  return existsSync(full) && statSync(full).size > 0
})

if (present.length === required.length) {
  console.log('[prepare] lib/ 产物已随仓库提供，跳过构建')
  process.exit(0)
}

const missing = required.filter(relative => !present.includes(relative))
console.warn(`[prepare] 缺少构建产物：${missing.join(', ')}；尝试现场构建（需要 devDependencies）`)

/**
 * 包管理器可能根本不在 PATH（本机就是这样）。Windows 下 shell 启动一个不存在
 * 的命令返回退出码 1 而非 spawn 错误，无法用 result.error 区分「命令不存在」
 * 和「命令本身失败」，所以先用 where/which 探测。
 */
function commandExists(command) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore', shell: true })
  return probe.status === 0
}

const attempts = ['pnpm', 'npm'].filter(commandExists)
if (attempts.length === 0) {
  console.error('[prepare] 找不到 pnpm 或 npm。请在有 devDependencies 的环境执行 pnpm run build，或改为安装含 lib/ 的发布包。')
  process.exit(1)
}

for (const command of attempts) {
  const result = spawnSync(command, ['run', 'build'], { cwd: repoRoot, stdio: 'inherit', shell: true })
  if (result.status === 0) process.exit(0)
  console.error(`[prepare] ${command} run build 失败（退出码 ${String(result.status)}），尝试下一个包管理器`)
}
console.error('[prepare] 构建未能完成。请安装 devDependencies 后手动执行 pnpm run build，或改为安装含 lib/ 的发布包。')
process.exit(1)
