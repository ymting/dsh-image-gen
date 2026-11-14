import type { ImageMediaType } from '@deepseek-ai/dsh-attachment';
import { type ArkOutputOptions } from './shared.js';
/**
 * What an images request can return: the raster types the attachment layer
 * stores, plus the SVG document `output_format: 'svg'` produces.
 */
export type GeneratedMediaType = ImageMediaType | 'image/svg+xml';
export interface GeneratedCompatibleImage {
    data: Uint8Array;
    mediaType: GeneratedMediaType;
}
/**
 * The workbench stores results through the raster attachment API only, so a
 * studio call never asks for SVG; guard the widened result type anyway.
 */
export declare function rasterOnly<T extends {
    data: Uint8Array;
    mediaType: GeneratedMediaType;
}>(image: T): {
    data: Uint8Array;
    mediaType: ImageMediaType;
};
/**
 * True when the bytes are an SVG document rather than a raster image. The
 * relay returns SVG as `b64_json` of the markup (or a URL to a .svg file), so
 * the payload is UTF-8 text whose root element, after any XML declaration,
 * processing instructions, comments, and DOCTYPE, is `<svg>`; every raster
 * format starts with a binary magic number instead. An HTML page that merely
 * contains an inline `<svg>` is not an SVG document. Only the first 64 KB are
 * decoded.
 */
export declare function isSvgDocument(data: Uint8Array): boolean;
export interface CompatibleReferenceImage {
    data: Uint8Array;
    mediaType: ImageMediaType;
}
/** [FORK] 生成请求的入参；抽成接口让 url / b64 两条路径共用同一份类型。 */
export interface OpenAICompatibleGenerateInput {
    provider: 'openai' | 'openai-compat' | 'seedream' | 'xai' | 'zhipu';
    apiKey: string;
    baseURL: string;
    model: string;
    prompt: string;
    /**
     * Pixel size or tier string. Optional because not every channel accepts
     * `size` at all — xAI takes aspect_ratio+resolution via `extraBody` and
     * rejects nothing but silently ignores unknown fields, so we simply omit
     * the parameter for it.
     */
    size?: string;
    /** Vendor quality tier (e.g. OpenAI low/medium/high); omitted when unset. */
    quality?: string;
    /** Extra JSON fields merged last into the generations body (xAI aspect_ratio/resolution). */
    extraBody?: Readonly<Record<string, unknown>>;
    strictImageDownloads?: boolean;
    maxBytes: number;
    signal: AbortSignal;
    /** Ark-only output controls; ignored by every other provider. */
    arkOptions?: ArkOutputOptions;
    /**
     * [FORK] 让服务端只回一个图片 URL（`response_format: 'url'`）。
     *
     * 部分中转站内联 1.5–3MB base64，链路慢时会被超时截断并误报 invalid JSON；
     * 只回短链接可以让响应体缩到几百字节，彻底绕开出图链路的传输瓶颈。
     * 但链接可能指向当前网络不可达的 CDN，所以下载失败会自动退回不带该字段的
     * 第二次请求（服务端改为内联 base64）。
     *
     * `false`/缺省时与上游行为完全一致。
     */
    preferUrl?: boolean;
}
export declare function generateOpenAICompatibleImage(input: OpenAICompatibleGenerateInput): Promise<GeneratedCompatibleImage>;
/** How the edits endpoint expects its request body (#41). */
export type CompatEditFormat = 'multipart' | 'jsonImageUrlArray' | 'formReferenceImages' | 'siliconflowJson' | 'xaiJson' | 'qwenJson';
export declare function editOpenAICompatibleImage(input: {
    apiKey: string;
    baseURL: string;
    model: string;
    prompt: string;
    sourceImages: CompatibleReferenceImage[];
    size?: string;
    strictImageDownloads?: boolean;
    maxBytes: number;
    signal: AbortSignal;
    /**
     * Request shape for the edits call. Most OpenAI-compatible channels take
     * the standard multipart form; some (e.g. SenseNova) accept OpenAI's
     * generations endpoint but run edits on their own JSON contract with
     * `images: [{ image_url }]` objects. Defaults to the standard multipart.
     */
    editFormat?: CompatEditFormat;
    editSizeMode?: 'auto' | 'selected';
    /**
     * Channel-specific extra fields merged into the JSON edit body last (so
     * they can override the defaults above), e.g. SenseNova's
     * `watermark`/`prompt_extend`. Ignored in multipart mode.
     */
    editExtra?: Readonly<Record<string, unknown>>;
    /** Vendor quality tier sent with the edit request when set. */
    quality?: string;
    /**
     * Multipart edit response shape. `auto` asks for inline b64_json first and
     * retries once without the field when a relay rejects it (400/422); `url`
     * keeps the relay default; `b64_json` never retries.
     */
    editResponseFormat?: 'auto' | 'b64_json' | 'url';
    /** Called once when the relay rejects response_format and the request is retried without it. */
    onResponseFormatRetry?: (status: number) => void;
    /**
     * Extra fields for the edit request (multipart: one form field per entry;
     * JSON shapes: merged after `editExtra`), e.g. xAI's
     * aspect_ratio/resolution pair.
     */
    extraBody?: Readonly<Record<string, unknown>>;
}): Promise<GeneratedCompatibleImage>;
/**
 * [FORK] 中转站兼容：少数站点用 zstd/gzip/br/deflate 压缩响应体，而运行时
 * 未必按 `content-encoding` 自动解码，解出来就是乱码，JSON.parse 随即报
 * 「invalid JSON」——报错点和真实原因完全对不上。
 *
 * 判定顺序：先看 zstd 魔数（`28 b5 2f fd`，有些站点压缩但漏写 header），
 * 再看声明的 content-encoding。解压失败说明声明与实际不符（例如运行时已经
 * 自动解过一遍），原样返回，让上层的 JSON 解析报出真正的原因，而不是在这里
 * 吞掉或抛错。
 *
 * 导出供测试直接验证各分支；运行时只经 readBoundedBytes 调用。
 */
export declare function decodeCompressedBody(bytes: Uint8Array, encoding: string | null): Uint8Array;
