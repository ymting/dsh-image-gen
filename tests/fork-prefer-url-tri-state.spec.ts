/**
 * Regression tests: 渠道级 `preferUrl` 必须是三态，全局开关不能被渠道默认值架空。
 *
 * 背景（本 fork 的真实 bug）：
 * 早期渠道 schema 写成 `preferUrl: z.boolean().default(false)`，注释里说想用
 * `default(false)` 表达「未设置」，但 schemastery 会把缺失字段补成显式 `false`。
 * 于是 `resolveOpenAICompatChannels` 里 `entry.preferUrl === undefined` 的
 * 「沿用全局」分支永远走不到——用户只打开全局 `openaiCompatPreferUrl`、不动
 * 任何渠道时，全局开关其实完全不生效。
 *
 * 修法：schema 改成 `z.boolean()`（不写 default），undefined 才能原样保留。
 * 这里同时锁住 schema 三态与投影逻辑两侧的行为。
 */
import { describe, expect, it } from 'vitest'
import { Config, withOpenAICompatChannel } from '../src/config.js'
import { resolveOpenAICompatChannel, resolveOpenAICompatChannels, type OpenAICompatChannelSource } from '../src/shared.js'

/**
 * 走一遍真实的 Config schema，再按 index.ts 里 plainConfig 的方式解包。
 * 每个 `.volatile()` 字段在 DSH 0.1.7+ 上是一个带 `.get()` 的 box，
 * 测试环境同样需要解包，否则拿到的不是裸值。
 */
function parse(raw: Record<string, unknown>): Record<string, unknown> {
  const parsed = Config(raw) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    out[key] = value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function'
      ? (value as { get(): unknown }).get()
      : value
  }
  return out
}

/** 把解包后的配置当作渠道来源使用。 */
function sourceOf(raw: Record<string, unknown>): OpenAICompatChannelSource {
  return parse(raw) as OpenAICompatChannelSource
}

describe('[FORK] 渠道 preferUrl 三态', () => {
  it('未设置的渠道解析后仍是 undefined，不被打成 false', () => {
    const channels = resolveOpenAICompatChannels(sourceOf({
      openaiCompatPreferUrl: true,
      openaiCompatChannels: [{ id: 'ch-a', keyRef: 'K_A' }, { id: 'ch-b', keyRef: 'K_B' }],
    }))
    // channels[0] 是 legacy default 槽位，真实渠道从下标 1 开始
    expect(channels[1]?.preferUrl).toBeUndefined()
    expect(channels[2]?.preferUrl).toBeUndefined()
  })

  it('显式 true / false 原样保留', () => {
    const channels = resolveOpenAICompatChannels(sourceOf({
      openaiCompatChannels: [
        { id: 'ch-on', keyRef: 'K_ON', preferUrl: true },
        { id: 'ch-off', keyRef: 'K_OFF', preferUrl: false },
      ],
    }))
    expect(channels[1]?.preferUrl).toBe(true)
    expect(channels[2]?.preferUrl).toBe(false)
  })

  it('未设置时沿用全局：全局 true 就让该渠道也走 url 优先', () => {
    const config = parse({
      openaiCompatPreferUrl: true,
      openaiCompatActiveChannel: 'ch-a',
      openaiCompatChannels: [{ id: 'ch-a', keyRef: 'K_A' }],
    }) as Config
    // 渠道没有 preferUrl → withOpenAICompatChannel 不覆盖，全局值透传下来
    expect(withOpenAICompatChannel(config, 'ch-a').openaiCompatPreferUrl).toBe(true)
  })

  it('渠道显式 false 时能压过全局 true', () => {
    const config = parse({
      openaiCompatPreferUrl: true,
      openaiCompatActiveChannel: 'ch-off',
      openaiCompatChannels: [{ id: 'ch-off', keyRef: 'K_OFF', preferUrl: false }],
    }) as Config
    expect(withOpenAICompatChannel(config, 'ch-off').openaiCompatPreferUrl).toBe(false)
  })

  it('渠道显式 true 时能盖过全局 false', () => {
    const config = parse({
      openaiCompatPreferUrl: false,
      openaiCompatActiveChannel: 'ch-on',
      openaiCompatChannels: [{ id: 'ch-on', keyRef: 'K_ON', preferUrl: true }],
    }) as Config
    expect(withOpenAICompatChannel(config, 'ch-on').openaiCompatPreferUrl).toBe(true)
  })

  it('legacy default 槽位不受影响：它压根没有 preferUrl 字段', () => {
    const channels = resolveOpenAICompatChannels(sourceOf({ openaiCompatPreferUrl: true, openaiCompatLabel: 'solo' }))
    expect(channels[0]?.id).toBe('default')
    expect(channels[0]?.preferUrl).toBeUndefined()
  })
})

describe('[FORK] resolveOpenAICompatChannel 对未设置渠道的宽容度', () => {
  it('渠道来源缺 preferUrl 时不抛错', () => {
    const source: OpenAICompatChannelSource = {
      openaiCompatChannels: [{ id: 'ch-x', label: 'x', keyRef: 'K_X', baseURL: 'https://x/v1', model: 'm' }],
      openaiCompatActiveChannel: 'ch-x',
    }
    expect(() => resolveOpenAICompatChannel(source)).not.toThrow()
    expect(resolveOpenAICompatChannel(source).preferUrl).toBeUndefined()
  })
})
