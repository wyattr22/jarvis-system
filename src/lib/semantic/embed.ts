// Local sentence embeddings via Transformers.js.
// Model: Xenova/all-MiniLM-L6-v2 (22MB, 384-dim, encoder-only)
// Runs CPU-only inside the Vercel function. Zero outbound calls after first
// download of weights. Cosine sim between two embeddings ≡ semantic relevance.
//
// The transformers package is dynamically imported on first use so module-level
// import failures (missing native ONNX bindings, etc.) don't crash the route.
// Callers must handle the case where embedding fails and fall back to keyword.

const MODEL = 'Xenova/all-MiniLM-L6-v2'
const DIM = 384

let extractor: any = null
let loadPromise: Promise<any> | null = null

async function getExtractor(): Promise<any> {
  if (extractor) return extractor
  if (!loadPromise) {
    loadPromise = (async () => {
      const transformers = await import('@xenova/transformers')
      // Vercel Lambdas don't ship the native onnxruntime; force WASM backend.
      transformers.env.allowRemoteModels = true
      transformers.env.allowLocalModels = false
      transformers.env.backends.onnx.wasm.numThreads = 1
      const p = await transformers.pipeline('feature-extraction', MODEL, { quantized: true })
      extractor = p
      return p
    })().catch((err: Error) => {
      loadPromise = null
      throw err
    })
  }
  return loadPromise
}

export async function embed(text: string): Promise<Float32Array> {
  const trimmed = text.slice(0, 8000).trim()
  if (!trimmed) return new Float32Array(DIM)
  const fe = await getExtractor()
  const out = await fe(trimmed, { pooling: 'mean', normalize: true })
  return out.data as Float32Array
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return []
  const fe = await getExtractor()
  const trimmed = texts.map(t => t.slice(0, 8000).trim() || ' ')
  const results: Float32Array[] = []
  // Process in small batches so we don't blow up the function memory
  const BATCH = 8
  for (let i = 0; i < trimmed.length; i += BATCH) {
    const slice = trimmed.slice(i, i + BATCH)
    const out = await fe(slice, { pooling: 'mean', normalize: true })
    // out.data is a flat Float32Array; reshape to per-text vectors
    for (let j = 0; j < slice.length; j++) {
      results.push(out.data.slice(j * DIM, (j + 1) * DIM))
    }
  }
  return results
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot  // both L2-normalized → dot product == cosine similarity
}

export function floatArrayToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

export function bufferToFloatArray(buf: Uint8Array | ArrayBuffer | Float32Array | null | undefined): Float32Array {
  if (!buf) return new Float32Array(0)
  if (buf instanceof Float32Array) return buf
  if (buf instanceof ArrayBuffer) return new Float32Array(buf)
  // libsql returns Uint8Array for BLOB columns (Buffer is a Uint8Array subclass in Node)
  if (ArrayBuffer.isView(buf)) {
    return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  }
  return new Float32Array(0)
}

export const EMBED_DIM = DIM
