// Entidades: valores por evento, sparkline textual, co-ocorrência e caminho (relação textual).
import type { EntityKind, PeritoEvent } from './types';
import { tsMs } from './format';
import { isExternalIp } from './ioc';

export type EKind = Exclude<EntityKind, 'process'>;
export const EKINDS: EKind[] = ['host', 'user', 'ip', 'domain', 'sha256'];

const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Mesma regra de timeline.entities do backend (host inclui src_host/dst_host; ip inclui host_ip). */
export function entityValues(ev: PeritoEvent): Record<EKind, string[]> {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  return {
    host: uniq([ev.host, s(ev.extra.src_host), s(ev.extra.dst_host)]),
    user: uniq([ev.user]),
    ip: uniq([ev.src_ip, ev.dst_ip, s(ev.extra.host_ip)]),
    domain: uniq([ev.domain]),
    sha256: uniq([ev.sha256]),
  };
}

const BLOCKS = '▁▂▃▄▅▆▇█';

/** Distribuição no tempo em `n` baldes → texto (· = zero; ▁…█ escala raiz sobre o máximo). */
export function sparkline(counts: number[]): string {
  const max = Math.max(0, ...counts);
  if (max === 0) return '·'.repeat(counts.length);
  return counts
    .map((c) => (c <= 0 ? '·' : BLOCKS[Math.min(7, Math.max(0, Math.ceil(8 * Math.sqrt(c / max)) - 1))]))
    .join('');
}

/** Baldes por entidade, numa passada pelos eventos: chave "kind\u0000valor". */
export function binsByEntity(events: PeritoEvent[], inicio: string, fim: string, n = 24): Map<string, number[]> {
  const a = tsMs(inicio);
  const span = Math.max(1, tsMs(fim) - a);
  const out = new Map<string, number[]>();
  for (const ev of events) {
    const i = Math.min(n - 1, Math.max(0, Math.floor(((tsMs(ev.ts_utc) - a) / span) * n)));
    const vals = entityValues(ev);
    for (const k of EKINDS) {
      for (const v of vals[k]) {
        const key = `${k}\u0000${v}`;
        let arr = out.get(key);
        if (!arr) out.set(key, (arr = new Array<number>(n).fill(0)));
        arr[i]! += 1;
      }
    }
  }
  return out;
}

export interface Coocorrencia {
  valor: string;
  n: number;
  primeira: string;
}

/** Entidades que aparecem nos mesmos eventos que (kind, valor), por tipo, em ordem de 1ª vez. */
export function coocorrencias(events: PeritoEvent[], kind: EKind, valor: string): Record<EKind, Coocorrencia[]> {
  const acc: Record<EKind, Map<string, Coocorrencia>> = { host: new Map(), user: new Map(), ip: new Map(), domain: new Map(), sha256: new Map() };
  for (const ev of events) {
    const vals = entityValues(ev);
    if (!vals[kind].includes(valor)) continue;
    for (const k of EKINDS) {
      for (const v of vals[k]) {
        if (k === kind && v === valor) continue;
        const c = acc[k].get(v);
        if (c) c.n += 1;
        else acc[k].set(v, { valor: v, n: 1, primeira: ev.ts_utc });
      }
    }
  }
  const sortT = (m: Map<string, Coocorrencia>) => [...m.values()].sort((x, y) => (x.primeira < y.primeira ? -1 : x.primeira > y.primeira ? 1 : y.n - x.n));
  return { host: sortT(acc.host), user: sortT(acc.user), ip: sortT(acc.ip), domain: sortT(acc.domain), sha256: sortT(acc.sha256) };
}

/** Arestas de movimentação entre máquinas: src_host → host e host → dst_host (1ª vez). */
export function arestasLaterais(events: PeritoEvent[]): { de: string; para: string; ts: string }[] {
  const seen = new Map<string, { de: string; para: string; ts: string }>();
  const add = (de: string | null, para: string | null, ts: string) => {
    if (!de || !para || de === para) return;
    const k = `${de}→${para}`;
    if (!seen.has(k)) seen.set(k, { de, para, ts });
  };
  for (const ev of events) {
    add(s(ev.extra.src_host), ev.host, ev.ts_utc);
    add(ev.host, s(ev.extra.dst_host), ev.ts_utc);
  }
  return [...seen.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

const INTERNO = /\.(local|lan|internal|intra|corp|home\.arpa)$/i;
export function isExternalDomain(d: string): boolean {
  return !INTERNO.test(d) && d.includes('.');
}
export function isExterno(kind: EKind, v: string): boolean {
  if (kind === 'ip') return isExternalIp(v);
  if (kind === 'domain') return isExternalDomain(v);
  return false;
}

/**
 * Relação textual da entidade, derivada dos eventos:
 *  conta   → máquinas na ordem em que a conta apareceu nelas   (svc_backup → ws-fin-023 → srv-file-01)
 *  máquina → origem lateral → máquina → destinos laterais e externos
 *  ip/domínio/hash → máquinas que o usaram → valor
 */
export function caminho(events: PeritoEvent[], kind: EKind, valor: string): string[] {
  const co = coocorrencias(events, kind, valor);
  if (kind === 'user') return [valor, ...co.host.map((h) => h.valor)];
  if (kind === 'host') {
    const ar = arestasLaterais(events);
    const antes = ar.filter((a) => a.para === valor).map((a) => a.de);
    const depois = ar.filter((a) => a.de === valor).map((a) => a.para);
    const ext = [...co.domain.filter((d) => isExternalDomain(d.valor)), ...co.ip.filter((i) => isExternalIp(i.valor))]
      .sort((a, b) => (a.primeira < b.primeira ? -1 : 1))
      .map((x) => x.valor);
    const uniq = (xs: string[]) => [...new Set(xs)];
    const tail = uniq([...depois, ...ext.slice(0, 2)]);
    return uniq([...antes, valor]).concat(tail.filter((t) => t !== valor));
  }
  return [...co.host.map((h) => h.valor).slice(0, 3), valor];
}
