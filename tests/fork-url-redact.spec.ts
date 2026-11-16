/**
 * [FORK] 计时日志/诊断日志里 URL 脱敏的回归测试。
 *
 * `sanitizeUrlForLog` 是本 fork 独有的（上游只有 `redactSecrets`）。
 * 起因：中转站的取图 URL 常带签名查询串（`?source=inline&token=...`），
 * 原实现截断后仍会把 token 原样写进 image-gen-timing.log，属于凭据泄露。
 *
 * 直接调用生产代码，不在测试里复刻逻辑——复刻版本改坏了源码也不会失败。
 *
 * 注：`chatToolSize` 的行为测试已由上游的 tests/chat-tool-size.spec.ts 覆盖
 * （v0.11.3 起），本文件不再重复，避免同一逻辑两处断言、改一处漏一处。
 */
import { describe, expect, it } from 'vitest'
import { sanitizeUrlForLog } from '../src/redact.js'

describe('[FORK] 计时日志不得写入 URL 凭据', () => {
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
