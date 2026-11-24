// Referências de evidência citadas em hipóteses/achados → eventos da timeline.
//   "defender_advanced_hunting.csv:15-17"  intervalo de linhas
//   "entra_signin.json#3"                  índice de registro
//   "a.csv:3; b.json#1"                    lista separada por ; ou ,
//   "A6"                                   ID de achado (resolvido pela tabela de achados)
import type { Achado, PeritoEvent } from './types';

/** Só extensões de evidência: não casa "203.0.113.45:443" nem "host.net:443". */
const REF = /([\w.-]+\.(?:csv|tsv|json|jsonl|ndjson|log|txt|evtx|xml|xlsx|md))([:#])(\d+)(?:-(\d+))?/gi;
const ACHADO = /\bA\d+\b/g;

/** Expande refs de texto livre em chaves exatas de raw_ref ("arquivo:linha" / "arquivo#n"). */
export function expandRefs(texto: string, maxIntervalo = 500): string[] {
  const out: string[] = [];
  for (const m of texto.matchAll(REF)) {
    const [, arq, sep, a, b] = m;
    const ini = Number(a);
    const fim = b ? Number(b) : ini;
    if (fim < ini || fim - ini > maxIntervalo) {
      out.push(`${arq}${sep}${ini}`);
      continue;
    }
    for (let n = ini; n <= fim; n++) out.push(`${arq}${sep}${n}`);
  }
  return out;
}

/** IDs de achado citados (A1, A12…). */
export function achadoIds(texto: string): string[] {
  return [...new Set(texto.match(ACHADO) ?? [])];
}

/** Resolve refs + IDs de achado → idx dos eventos (ordenados, sem repetição). */
export function resolveRefs(texto: string, eventos: PeritoEvent[], achados: Achado[] = []): number[] {
  const chaves = new Set(expandRefs(texto));
  for (const id of achadoIds(texto)) {
    const a = achados.find((x) => x.id === id);
    if (a) for (const ev of a.evidencia) for (const k of expandRefs(ev)) chaves.add(k);
  }
  if (chaves.size === 0) return [];
  const idx: number[] = [];
  for (const ev of eventos) if (chaves.has(ev.raw_ref)) idx.push(ev.idx);
  return idx.sort((x, y) => x - y);
}

/** Divide um texto em pedaços: texto comum, ref de evidência ou ID de achado (para links). */
export type Pedaco = { tipo: 'texto' | 'ref' | 'achado'; v: string };

export function splitRefs(texto: string): Pedaco[] {
  const re = /([\w.-]+\.(?:csv|tsv|json|jsonl|ndjson|log|txt|evtx|xml|xlsx|md)[:#]\d+(?:-\d+)?|\bA\d+\b)/g;
  const out: Pedaco[] = [];
  let last = 0;
  for (const m of texto.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ tipo: 'texto', v: texto.slice(last, i) });
    out.push({ tipo: /^A\d+$/.test(m[0]) ? 'achado' : 'ref', v: m[0] });
    last = i + m[0].length;
  }
  if (last < texto.length) out.push({ tipo: 'texto', v: texto.slice(last) });
  return out;
}
