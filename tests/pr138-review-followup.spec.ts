/**
 * Regression tests for the CodeRabbit review on PR #138.
 *
 * 三个问题都是原 PR 自己引入的，不是上游既有缺陷。这里直接调用生产代码
 * `chatToolSize` / `sanitizeUrlForLog`，而不是在测试里复刻逻辑——复刻版本
 * 改坏了源码也不会失败，起不到回归保护作用。
 *
 * 1. 格式守卫必须先于比例解析。`openAIRequestSize` 在「该比例最低档位高于
 *    请求预算」时抛错，于是本不该带 size 的 SVG / GIF 请求在守卫前就失败了。
 * 2. 预算写死 `'1K'`。渠道把某比例只配了 2K 档时直接抛错，用空档位（取表内
 *    默认基线）才能正常解析。
 * 3. 计时日志把 URL 的 userinfo 和签名查询串原样写进日志。
 */
import { describe, expect, it } from 'vitest'
import { chatToolSize } from '../src/studio.js'
import { sanitizeUrlForLog } from '../src/redact.js'
import type { Config } from '../src/config.js'

/** 该比例只配了 2K 档：1K 预算会抛错，正好用来暴露求值顺序问题。 */
const twoKOnly = { openaiCompatSizes: { '3:4': { '2K': '1792x2304' } } } as Config
const noTable = { openaiCompatSizes: {} } as Config

function sizeOf(config: Config, args: { size?: string; aspect_ratio?: string }, opts: { gif?: boolean; svg?: boolean; provider?: 'openai-compat' | 'openai' } = {}) {
  return chatToolSize({
    provider: opts.provider ?? 'openai-compat',
    config,
    fallbackSize: '1024x1024',
    args,
    gifRequested: opts.gif === true,
    svgRequested: opts.svg === true,
  })
}

describe('[PR#138 review] 格式守卫必须先于比例解析', () => {
  it('SVG 请求不解析尺寸，因此不会因 2K-only 比例抛错', () => {
    expect(() => sizeOf(twoKOnly, { aspect_ratio: '3:4' }, { svg: true })).not.toThrow()
    expect(sizeOf(twoKOnly, { aspect_ratio: '3:4' }, { svg: true })).toBeUndefined()
  })

  it('未显式给尺寸的 GIF 请求同样跳过解析', () => {
    expect(() => sizeOf(twoKOnly, { aspect_ratio: '3:4' }, { gif: true })).not.toThrow()
    expect(sizeOf(twoKOnly, { aspect_ratio: '3:4' }, { gif: true })).toBeUndefined()
  })

  it('显式给了尺寸的 GIF 请求仍走自己的 size', () => {
    expect(sizeOf(twoKOnly, { size: '512x512', aspect_ratio: '3:4' }, { gif: true })).toBe('512x512')
  })
})

describe('[PR#138 review] 2K-only 比例不应在聊天路径抛错', () => {
  it('空档位解析到表内配置的那一档', () => {
    expect(sizeOf(twoKOnly, { aspect_ratio: '3:4' })).toBe('1792x2304')
  })

  it('没有配置表时按方向兜底，竖构图仍是竖的', () => {
    expect(sizeOf(noTable, { aspect_ratio: '3:4' })).toBe('1024x1536')
    expect(sizeOf(noTable, { aspect_ratio: '16:9' })).toBe('1536x1024')
    expect(sizeOf(noTable, { aspect_ratio: '1:1' })).toBe('1024x1024')
  })

  it('显式 size 优先级最高，连表都不查', () => {
    expect(sizeOf(twoKOnly, { size: '1280x720', aspect_ratio: '3:4' })).toBe('1280x720')
  })

  it('没有 aspect_ratio 时回落到 profile 默认值', () => {
    expect(sizeOf(noTable, {})).toBe('1024x1024')
  })

  it('非 openai-compat 的 provider 不参与比例解析', () => {
    expect(sizeOf(noTable, { aspect_ratio: '3:4' }, { provider: 'openai' })).toBe('1024x1024')
  })
})

describe('[PR#138 review] 计时日志不得写入 URL 凭据', () => {
  it('剥掉 userinfo', () => {
    expect(sanitizeUrlForLog('https://user:pass@relay.example/v1')).toBe('https://relay.example/v1')
  })

  it('剥掉带签名的查询串（token 通常在最前面，截断救不了）', () => {
    const url = 'https://usawest.up.railway.app/v1/images/proxy?source=inline&token=SECRET123&expires=999'
    expect(sanitizeUrlForLog(url)).toBe('https://usawest.up.railway.app/v1/images/proxy')
  })

  it('剥掉 fragment', () => {
    expect(sanitizeUrlForLog('https://relay.example/v1#access_token=abc')).toBe('https://relay.example/v1')
  })

  it('无法解析的值退化为脱敏而不是原样输出', () => {
    expect(sanitizeUrlForLog('sk-live-abcdefghijklmnop')).toContain('[REDACTED]')
  })
})
