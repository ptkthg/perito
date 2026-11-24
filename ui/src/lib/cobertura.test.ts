import { describe, expect, it } from 'vitest';
import { lacunas, matrizHost, matrizTempo, prefillLacuna } from './cobertura';
import type { Histograma } from './types';
import { ev } from './test-events';

const h: Histograma = {
  bucket_s: 600,
  inicio: '2026-11-10T10:00:00.000Z',
  fim: '2026-11-10T14:00:00.000Z',
  n_baldes: 24,
  fontes: { defender: Array.from({ length: 24 }, (_, i) => (i >= 9 && i < 15 ? 2 : 0)), elastic: Array.from({ length: 24 }, (_, i) => (i === 20 ? 1 : 0)) },
  cobertura: {
    defender: { primeiro: '2026-11-10T11:30:00.000Z', ultimo: '2026-11-10T12:30:00.000Z' },
    elastic: { primeiro: '2026-11-10T13:20:00.000Z', ultimo: '2026-11-10T13:25:00.000Z' },
  },
  marcas: [],
};

describe('cobertura', () => {
  it('matriz fonte × tempo reagrupa baldes e marca lacunas pela cobertura', () => {
    const m = matrizTempo(h, ['defender', 'elastic'], 8);
    expect(m.cols).toHaveLength(8);
    const def = m.linhas[0]!;
    expect(def.total).toBe(12);
    expect(def.celulas.map((c) => (c.lacuna ? '░' : c.n))).toEqual(['░', '░', '░', 6, 6, 0, '░', '░']);
    expect(m.linhas[1]!.celulas.filter((c) => !c.lacuna)).toHaveLength(1);
  });
  it('lacunas de início/fim por fonte e hosts sem EDR, com prefill', () => {
    const l = lacunas(h, ['srv-file-01']);
    expect(l.map((x) => x.texto)).toEqual(['DEF sem dados 10:00–11:30', 'DEF sem dados 12:30–14:00', 'ELA sem dados 10:00–13:20', 'ELA sem dados 13:25–14:00', 'srv-file-01 sem EDR']);
    const p = prefillLacuna(l[0]!);
    expect(p.limitacao).toContain('defender sem dados entre 2026-11-10 10:00Z e 2026-11-10 11:30Z');
    expect(prefillLacuna(l.at(-1)!).limitacao).toContain('srv-file-01 não tem EDR');
  });
  it('fonte × host por categoria de telemetria', () => {
    const m = matrizHost([
      ev({ source: 'defender', host: 'ws-1' }),
      ev({ source: 'sentinel', host: 'srv-1' }),
      ev({ source: 'splunk', event_type: 'network', extra: { observer: 'fw', src_host: 'srv-1' } }),
      ev({ source: 'splunk', event_type: 'process', host: 'srv-1' }),
    ]);
    expect(m).toEqual([
      { host: 'srv-1', c: { edr: 0, sysmon: 1, security: 1, rede: 1, nuvem: 0 } },
      { host: 'ws-1', c: { edr: 1, sysmon: 0, security: 0, rede: 0, nuvem: 0 } },
    ]);
  });
});
