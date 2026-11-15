// Snapshot-local bytes only. Every replay still checks signatures, hashes and
// source identity. Failed/oversized responses and credentials never persist.
export function createSubmissionFetchCache(
  fetchImpl = fetch,
  { maxBytes = 128 * 1024 * 1024, maxEntryBytes = 32 * 1024 * 1024 } = {},
) {
  const responses = new Map();
  let bytes = 0,
    hits = 0,
    misses = 0;
  const copy = (entry) =>
    new Response(entry.bytes, { status: entry.status, headers: entry.headers });
  const cached = async (url, options = {}) => {
    options.signal?.throwIfAborted();
    if ((options.method ?? "GET") !== "GET") return fetchImpl(url, options);
    const key = JSON.stringify([
      String(url),
      [...new Headers(options.headers)].sort(),
      options.redirect ?? "follow",
    ]);
    if (responses.has(key)) {
      const entry = await responses.get(key);
      if (entry.bytes) {
        hits++;
        return copy(entry);
      }
      return entry.response.clone ? entry.response.clone() : entry.response;
    }
    misses++;
    const pending = (async () => {
      const response = await fetchImpl(url, options);
      const uncached = () => {
        responses.delete(key);
        return { response };
      };
      if (response.status !== 200 || !response.clone || bytes >= maxBytes)
        return uncached();
      const declared = response.headers.get("content-length");
      if (declared !== null && Number(declared) > maxEntryBytes)
        return uncached();
      const reader = response.clone().body?.getReader();
      if (!reader) return uncached();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxEntryBytes || bytes + size > maxBytes) {
          // A tee cancellation can wait for the other consumer; do not block it.
          void reader.cancel().catch(() => {});
          return uncached();
        }
        chunks.push(value);
      }
      if (bytes + size > maxBytes) return uncached();
      const buffer = Buffer.concat(chunks, size);
      bytes += size;
      void response.body?.cancel().catch(() => {});
      return {
        bytes: buffer,
        status: response.status,
        headers: [...response.headers],
      };
    })();
    responses.set(key, pending);
    try {
      const entry = await pending;
      return entry.bytes ? copy(entry) : entry.response;
    } catch (error) {
      responses.delete(key);
      throw error;
    }
  };
  cached.metrics = () => ({ hits, misses, retainedBytes: bytes });
  return cached;
}
