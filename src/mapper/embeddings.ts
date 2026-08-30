import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

let extractor: FeatureExtractionPipeline | null = null;

const createFeatureExtractor = pipeline as unknown as (
  task: 'feature-extraction',
  model: string
) => Promise<FeatureExtractionPipeline>;

const MODEL_NAME = 'Xenova/bge-small-en-v1.5';
const EMBEDDING_DIM = 384;

export { EMBEDDING_DIM };

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    console.log(`Loading embedding model: ${MODEL_NAME}...`);
    extractor = await createFeatureExtractor('feature-extraction', MODEL_NAME);
    console.log('Embedding model loaded.');
  }
  return extractor;
}

/** Generate embedding for a single text */
export async function embed(text: string): Promise<number[]> {
  const ext = await getExtractor();
  const output = await ext(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array).slice(0, EMBEDDING_DIM);
}

/** Generate embeddings for multiple texts (batched) */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const ext = await getExtractor();
  const results: number[][] = [];

  // Process in chunks to avoid OOM
  const CHUNK_SIZE = 32;
  for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
    const chunk = texts.slice(i, i + CHUNK_SIZE);
    for (const text of chunk) {
      const output = await ext(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data as Float32Array).slice(0, EMBEDDING_DIM));
    }
  }

  return results;
}

/** Format embedding array for pgvector insertion */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
