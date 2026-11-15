import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.js';
export { Config } from './config.js';
export { IMAGE_ROUTE, DELETE_ROUTE, SAVE_WORKSPACE_ROUTE, imageAttachmentFromMeta } from './image-route.js';
export { IMPORT_ROUTE } from './shared.js';
export { STUDIO_ROUTE } from './shared.js';
export { INSPIRATION_ROUTE } from './shared.js';
export { TEST_CONNECTION_ROUTE } from './shared.js';
export { CANVAS_STATE_ROUTE } from './shared.js';
export declare const name = "dsh-image-gen";
export declare const inject: string[];
/**
 * [FORK] Decide the pixel size a chat-tool image request should carry.
 * Implemented in `studio.ts` next to `openAIRequestSize` so the precedence
 * rules can be unit-tested without importing this entry module.
 */
export { chatToolSize } from './studio.js';
export declare function apply(ctx: Context, config?: Config): void;
