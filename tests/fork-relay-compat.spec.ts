/**
 * [FORK] 本 fork 三项中转站兼容能力的回归测试。
 *
 * 覆盖：
 * 1. 压缩响应体解码（zstd 魔数 / content-encoding 声明 / 声明不符时原样返回）；
 * 2. `preferUrl` 开启时先要 url，取图失败自动回退 b64；关闭时行为与上游一致；
 * 3. 计时日志默认关闭、开启后按 stage 写入。
 *
 * 全部用 vi.stubGlobal 伪造 fetch，不触网，也不依赖真实中转站。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from 'node:zlib'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateOpenAICompatibleImage } from '../src/openai-compatible.js'
import { debugTiming } from '../src/debug-timing.js'

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001' +
  '0d0a2db40000000049454e44ae426082',
  'hex',
)

const baseInput = {
  provider: 'openai-compat' as const,
  apiKey: 'test-key',
  baseURL: 'https://relay.invalid/v1',
  model: 'gpt-image-test',
  prompt: 'a quiet lake',
  maxBytes: 32 * 1024 * 1024,
  signal: new AbortController().signal,
}

/**
 * 构造一个能记录请求的 fetch 桩，按调用顺序返回预设响应。
 * 元素既可以是一个 Response（复用同一条响应），也可以是返回 Response 的工厂。
 * `bodies` 只记录生成请求（带 body 的那些），下载请求没有 body，分开统计才能
 * 准确断言「回退时又发了一次生成请求」。
 */
function stubFetchSequence(responses: Array<Response | (() => Response)>) {
  const bodies: string[] = []
  const urls: string[] = []
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    urls.push(String(url))
    if (init?.body !== undefined) bodies.push(String(init.body))
    const next = responses.shift()
    if (next === undefined) throw new Error('fetch stub ran out of responses')
    return typeof next === 'function' ? next() : next
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, bodies, urls }
}

function b64Response(): Response {
  const payload = JSON.stringify({ data: [{ b64_json: PNG_1X1.toString('base64') }] })
  return new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } })
}

function urlResponse(url = 'https://cdn.invalid/img.png'): Response {
  return new Response(JSON.stringify({ data: [{ url }] }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('[FORK] 压缩响应体解码', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('解压 zstd 响应体（声明了 content-encoding）', async () => {
    const payload = Buffer.from(JSON.stringify({ data: [{ b64_json: PNG_1X1.toString('base64') }] }))
    const compressed = zstdCompressSync(payload)
    stubFetchSequence([() => new Response(compressed, { status: 200, headers: { 'content-encoding': 'zstd' } })])
    const image = await generateOpenAICompatibleImage(baseInput)
    expect(image.data.byteLength).toBe(PNG_1X1.byteLength)
    expect(image.mediaType).toBe('image/png')
  })

  it('按 zstd 魔数识别漏写 content-encoding 的响应', async () => {
    const payload = Buffer.from(JSON.stringify({ data: [{ b64_json: PNG_1X1.toString('base64') }] }))
    const compressed = zstdCompressSync(payload)
    stubFetchSequence([() => new Response(compressed, { status: 200 })])
    const image = await generateOpenAICompatibleImage(baseInput)
    expect(image.data.byteLength).toBe(PNG_1X1.byteLength)
  })

  it('解压 gzip 响应体', async () => {
    const payload = Buffer.from(JSON.stringify({ data: [{ b64_json: PNG_1X1.toString('base64') }] }))
    stubFetchSequence([() => new Response(gzipSync(payload), { status: 200, headers: { 'content-encoding': 'gzip' } })])
    const image = await generateOpenAICompatibleImage(baseInput)
    expect(image.data.byteLength).toBe(PNG_1X1.byteLength)
  })

  it('解压 deflate 响应体', async () => {
    const payload = Buffer.from(JSON.stringify({ data: [{ b64_json: PNG_1X1.toString('base64') }] }))
    stubFetchSequence([() => new Response(deflateSync(payload), { status: 200, headers: { 'content-encoding': 'deflate' } })])
    const image = await generateOpenAICompatibleImage(baseInput)
    expect(image.data.byteLength).toBe(PNG_1X1.byteLength)
  })

  it('解压 brotli 响应体', async () => {
    const payload = Buffer.from(JSON.stringify({ data: [{ b64_json: PNG_1X1.toString('base64') }] }))
    stubFetchSequence([() => new Response(brotliCompressSync(payload), { status: 200, headers: { 'content-encoding': 'br' } })])
    const image = await generateOpenAICompatibleImage(baseInput)
    expect(image.data.byteLength).toBe(PNG_1X1.byteLength)
  })

  it('声明压缩但实际是明文时原样交给上层解析', async () => {
    stubFetchSequence([() => new Response(JSON.stringify({ data: [{ b64_json: PNG_1X1.toString('base64') }] }), { status: 200, headers: { 'content-encoding': 'br' } })])
    const image = await generateOpenAICompatibleImage(baseInput)
    expect(image.data.byteLength).toBe(PNG_1X1.byteLength)
  })
})

describe('[FORK] preferUrl 与 b64 回退', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('关闭时请求体不带 response_format', async () => {
    const { bodies } = stubFetchSequence([b64Response])
    await generateOpenAICompatibleImage(baseInput)
    expect(bodies[0]).not.toContain('response_format')
  })

  it('开启时首次请求带 response_format=url', async () => {
    const { bodies } = stubFetchSequence([
      urlResponse(),
      () => new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } }),
    ])
    const image = await generateOpenAICompatibleImage({ ...baseInput, preferUrl: true })
    expect(bodies[0]).toContain('"response_format":"url"')
    expect(image.data.byteLength).toBe(PNG_1X1.byteLength)
  })

  it('url 下载失败时自动回退到 b64 请求', async () => {
    const { bodies } = stubFetchSequence([
      urlResponse(),
      // 绝对 URL 只有一个下载候选，直接失败
      () => new Response('nope', { status: 502 }),
      b64Response,
    ])
    const image = await generateOpenAICompatibleImage({ ...baseInput, preferUrl: true })
    expect(bodies.length).toBe(2)
    // 第二次请求不再要求 url，服务端改为内联 base64
    expect(bodies[1]).not.toContain('"response_format":"url"')
    expect(image.data.byteLength).toBe(PNG_1X1.byteLength)
  })

  it('extraBody 里显式给出的 response_format 不被覆盖', async () => {
    const { bodies } = stubFetchSequence([
      b64Response,
      () => new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } }),
    ])
    await generateOpenAICompatibleImage({ ...baseInput, preferUrl: true, extraBody: { response_format: 'b64_json' } })
    expect(bodies[0]).toContain('"response_format":"b64_json"')
  })

  it('请求被 4xx 拒绝时不回退（回退也没有意义）', async () => {
    const { bodies } = stubFetchSequence([
      () => new Response('{"error":{"message":"bad size"}}', { status: 400 }),
      b64Response,
    ])
    await expect(generateOpenAICompatibleImage({ ...baseInput, preferUrl: true })).rejects.toThrow()
    expect(bodies.length).toBe(1)
  })
})

describe('[FORK] 计时日志', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dsh-image-gen-timing-')) })
  afterEach(() => { delete process.env.DSH_IMAGE_GEN_TIMING; rmSync(dir, { recursive: true, force: true }) })

  it('未设置环境变量时不写文件', () => {
    delete process.env.DSH_IMAGE_GEN_TIMING
    const target = join(dir, 'timing.log')
    debugTiming('probe', 1, 'x=1')
    expect(() => readFileSync(target)).toThrow()
  })

  it('设置为 1 之外的路径时写到该路径', () => {
    const target = join(dir, 'timing.log')
    process.env.DSH_IMAGE_GEN_TIMING = target
    debugTiming('probe', 12, 'x=1')
    expect(readFileSync(target, 'utf8')).toContain('stage=probe cost=12ms x=1')
  })

  it('设置为 0 视为关闭', () => {
    process.env.DSH_IMAGE_GEN_TIMING = '0'
    const target = join(dir, 'timing.log')
    debugTiming('probe', 1)
    expect(() => readFileSync(target)).toThrow()
  })
})
