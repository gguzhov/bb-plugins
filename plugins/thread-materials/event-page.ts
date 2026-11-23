function exceedsResponseLimit(error: unknown): boolean {
 return /(?:HTTP 413|event_data_too_large|Event response exceeds)/i.test(String(error));
}

/** Retry the same cursor with fewer events. A single oversized event leaves the cursor intact. */
export async function readEventPage<T>(
 read: (limit: number) => Promise<T[]>,
 limit: number,
): Promise<{ rows: T[]; limit: number } | null> {
 for (;;) {
  try {
   return { rows: await read(limit), limit };
  } catch (error) {
   if (!exceedsResponseLimit(error)) throw error;
   if (limit === 1) return null;
   limit = Math.max(1, Math.floor(limit / 2));
  }
 }
}
