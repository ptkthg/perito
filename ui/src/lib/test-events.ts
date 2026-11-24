// Fábrica de eventos mínimos para testes unitários.
import type { PeritoEvent } from './types';

let n = 0;
export function ev(p: Partial<PeritoEvent> & { extra?: PeritoEvent['extra'] } = {}): PeritoEvent {
  const idx = p.idx ?? n++;
  return {
    idx,
    ts_utc: '2026-11-10T13:00:00.000Z',
    source: 'defender',
    event_type: 'process',
    raw_ref: `teste.csv:${idx + 2}`,
    ts_original: null,
    host: null,
    user: null,
    src_ip: null,
    dst_ip: null,
    dst_port: null,
    domain: null,
    process: null,
    parent: null,
    cmdline: null,
    file_path: null,
    sha256: null,
    action: null,
    outcome: null,
    description: null,
    severity: null,
    mitre: [],
    ...p,
    extra: { mitre_heuristica: [], ...(p.extra ?? {}) },
  };
}
