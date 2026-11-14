/**
 * 记录一个阶段的耗时。`ms` 为该阶段自身耗时（瞬时事件传 0），
 * `extra` 是任意键值说明，会原样拼接到行尾。
 */
export declare function debugTiming(stage: string, ms: number, extra?: string): void;
/** 计时器：包住一段异步逻辑，返回结果并在结束时记一行日志。 */
export declare function timed<T>(stage: string, describe: (value: T) => string, run: () => Promise<T>): Promise<T>;
