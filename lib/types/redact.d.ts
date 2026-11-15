/** Replace every occurrence of a known secret plus key-shaped values. */
export declare function redactSecrets(text: string, ...secrets: Array<string | undefined>): string;
/**
 * Make a URL safe to write into a diagnostic log line.
 *
 * Diagnostics exist to show *which* endpoint was called, not to archive the
 * credentials that endpoint was called with. Two leak paths matter:
 * - userinfo (`https://user:pass@relay`), which `redactSecrets` also catches;
 * - the query string, where relay CDN URLs carry signed access tokens
 *   (`?token=...&expires=...`). Truncating the string does not remove them —
 *   the token is usually the first parameter.
 *
 * Anything unparseable falls back to `redactSecrets` so a malformed value
 * cannot bypass the scrub.
 */
export declare function sanitizeUrlForLog(value: string): string;
