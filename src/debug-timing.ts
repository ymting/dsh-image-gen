/**
 * [FORK] 生成链路的分阶段计时日志。
 *
 * 中转站出图慢且环节多（服务端出图 / 取图传输 / 落盘），出问题时光看总耗时
 * 无法判断卡在哪一段。这里把每一步的真实耗时追加写入一个日志文件，默认关闭，
 * 只有设置环境变量 `DSH_IMAGE_GEN_TIMING=1`（或 =<自定义文件路径>）时才写，
 * 因此不影响正常使用的性能与磁盘。
 *
 * 设计要点：
 * - 同步追加写，单行自包含，方便 `tail`/grep 定位；
 * - 任何异常都吞掉：诊断代码绝不能影响出图主流程；
 * - 文件名可覆盖，便于把多个实例的日志分开。
 */
import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 环境变量名：置 1 启用，置路径则写到该路径。 */
const TIMING_ENV = 'DSH_IMAGE_GEN_TIMING'

/** 解析日志落点；未启用时返回 undefined。 */
function timingTarget(): string | undefined {
  const raw = process.env[TIMING_ENV]?.trim()
  if (raw === undefined || raw.length === 0 || raw === '0' || raw === 'false') return undefined
  if (raw === '1' || raw === 'true') return join(homedir(), '.dsh', 'image-gen-timing.log')
  return raw
}

/**
 * 记录一个阶段的耗时。`ms` 为该阶段自身耗时（瞬时事件传 0），
 * `extra` 是任意键值说明，会原样拼接到行尾。
 */
export function debugTiming(stage: string, ms: number, extra?: string): void {
  const target = timingTarget()
  if (target === undefined) return
  try {
    appendFileSync(target, `${new Date().toISOString()} stage=${stage} cost=${ms.toFixed(0)}ms ${extra ?? ''}\n`)
  } catch {
    // 诊断日志失败不影响出图
  }
}

/** 计时器：包住一段异步逻辑，返回结果并在结束时记一行日志。 */
export async function timed<T>(stage: string, describe: (value: T) => string, run: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try {
    const value = await run()
    debugTiming(stage, performance.now() - started, describe(value))
    return value
  } catch (error) {
    debugTiming(`${stage}.fail`, performance.now() - started, `err=${String((error as { message?: unknown })?.message ?? error).slice(0, 160)}`)
    throw error
  }
}
