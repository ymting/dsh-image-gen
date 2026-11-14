/**
 * 校验 lib/ 产物是否齐全、是否比源码新。
 *
 * 为什么需要它：本 fork 把构建产物一并提交，因此 package.json 里**不能**保留
 * `prepare`。原因很实际——pnpm 只要看到依赖声明了安装期脚本（prepare /
 * preinstall / install / postinstall），就会要求把包加进 `allowBuilds` 白名单，
 * 否则直接 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 中断安装。「装上就能用」的
 * 前提是根本没有脚本要跑，而不是让用户去改白名单。
 *
 * 代价是产物可能与源码脱节，所以用 `prepack`（只在 pack/publish 时触发，
 * 不影响安装）做守卫：产物缺失，或任一源文件比入口产物新，就报错。
 *
 * 手动运行：
 *   node scripts/check-lib-fresh.mjs
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 运行期必需的入口产物。 */
const entries = ['lib/index.js', 'lib/client.js']

const missing = entries.filter(relative => {
  const full = resolve(repoRoot, relative)
  // 0 字节文件等于不存在，避免把中断的构建当成功
  return !existsSync(full) || statSync(full).size === 0
})

if (missing.length > 0) {
  console.error(`[check-lib] 缺少构建产物：${missing.join(', ')}`)
  console.error('[check-lib] 请执行 pnpm run build 后提交 lib/')
  process.exit(1)
}

/** 递归收集源码文件的最后修改时间。 */
function newestMtime(dir) {
  let newest = 0
  const walk = current => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, item.name)
      if (item.isDirectory()) { walk(full); continue }
      if (!/\.(ts|tsx)$/.test(item.name)) continue
      newest = Math.max(newest, statSync(full).mtimeMs)
    }
  }
  walk(dir)
  return newest
}

const newestSource = newestMtime(resolve(repoRoot, 'src'))
// 取较早的那个入口作为基准：两个入口都要比源码新才算没脱节
const oldestEntry = Math.min(...entries.map(relative => statSync(resolve(repoRoot, relative)).mtimeMs))

// 容差 2 秒：文件系统时间戳精度和「构建脚本先 tsc 后 tsdown」的写入顺序会让
// 毫秒级比较出现假警报（实测会出现「旧 0 秒」这种无意义结论）。
const TOLERANCE_MS = 2000
if (newestSource > oldestEntry + TOLERANCE_MS) {
  const lagSeconds = Math.round((newestSource - oldestEntry) / 1000)
  console.error(`[check-lib] lib/ 比源码旧 ${String(lagSeconds)} 秒，产物与源码已脱节`)
  console.error('[check-lib] 请执行 pnpm run build 后重新提交 lib/')
  process.exit(1)
}

console.log('[check-lib] lib/ 产物齐全且不早于源码')
