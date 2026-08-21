/** Stable JSON for configuration digests and plan identifiers. */
export declare function canonicalJson(value: unknown): string;
/** Lowercase SHA-256 digest. */
export declare function sha256(value: string | Uint8Array): string;
