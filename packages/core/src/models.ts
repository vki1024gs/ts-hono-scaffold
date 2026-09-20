export type Item = { id: string; name: string; createdAt: string };
/** Optional application identity resolver; the default local app has no login. */
export type Actor = { id: string; canWrite: boolean };
