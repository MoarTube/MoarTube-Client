/** Incremental delimiter framing; one concatenation per frame and no read-ahead work queue. */
export async function* readDelimited(
  source: AsyncIterable<Buffer>,
  delimiter: Buffer,
  maxBytes: number
): AsyncGenerator<Buffer> {
  if (!delimiter.length) {
    throw new Error('Empty delimiter');
  }
  const prefix = new Array<number>(delimiter.length).fill(0);
  for (let i = 1, j = 0; i < delimiter.length; i++) {
    while (j && delimiter[i] !== delimiter[j]) {
      j = prefix[j - 1] ?? 0;
    }
    if (delimiter[i] === delimiter[j]) {
      j++;
    }
    prefix[i] = j;
  }
  let chunks: Buffer[] = [],
    bytes = 0,
    matched = 0;
  for await (const chunk of source) {
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      while (matched && chunk[i] !== delimiter[matched]) {
        matched = prefix[matched - 1] ?? 0;
      }
      if (chunk[i] === delimiter[matched]) {
        matched++;
      }
      if (bytes + i - start + 1 > maxBytes) {
        throw new Error('Live frame exceeds byte limit');
      }
      if (matched === delimiter.length) {
        chunks.push(chunk.subarray(start, i + 1));
        bytes += i - start + 1;
        const frame = Buffer.concat(chunks, bytes);
        chunks = [];
        bytes = 0;
        matched = 0;
        start = i + 1;
        yield frame;
      }
    }
    if (start < chunk.length) {
      chunks.push(chunk.subarray(start));
      bytes += chunk.length - start;
    }
  }
  if (bytes && Buffer.concat(chunks, bytes).toString().trim() !== '#EXT-X-ENDLIST') {
    throw new Error('Live stream ended with an incomplete frame');
  }
}
