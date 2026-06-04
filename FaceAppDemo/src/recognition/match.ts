// Enrollment + identification logic.
export const DEFAULT_THRESHOLD = 0.32;
export type Embedding = Float32Array | number[];

export interface EnrolledPerson {
  id: string; name: string; embedding: number[]; photoCount: number; enrolledAt: number; photoUri?: string;
}
export interface IdentifyResult {
  matched: boolean; personId: string | null; name: string | null; score: number;
  ranking: { id: string; name: string; score: number }[];
}

export function l2normalize(e: Embedding): number[] {
  let s = 0;
  for (let i = 0; i < e.length; i++) s += (e[i] as number) * (e[i] as number);
  const n = Math.sqrt(s) + 1e-9;
  const out = new Array(e.length);
  for (let i = 0; i < e.length; i++) out[i] = (e[i] as number) / n;
  return out;
}

export function cosine(a: Embedding, b: Embedding): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
}

export function buildGalleryEmbedding(embeds: Embedding[]): number[] {
  const dim = embeds[0].length;
  const acc = new Array(dim).fill(0);
  for (const e of embeds) {
    const ne = l2normalize(e);
    for (let i = 0; i < dim; i++) acc[i] += ne[i];
  }
  for (let i = 0; i < dim; i++) acc[i] /= embeds.length;
  return l2normalize(acc);
}

export function identify(
  probe: Embedding, gallery: EnrolledPerson[], threshold = DEFAULT_THRESHOLD
): IdentifyResult {
  const p = l2normalize(probe);
  const ranking = gallery
    .map((g) => ({ id: g.id, name: g.name, score: cosine(p, g.embedding) }))
    .sort((a, b) => b.score - a.score);
  if (!ranking.length) return { matched: false, personId: null, name: null, score: 0, ranking: [] };
  const top = ranking[0];
  const matched = top.score >= threshold;
  return { matched, personId: matched ? top.id : null, name: matched ? top.name : null, score: top.score, ranking };
}
