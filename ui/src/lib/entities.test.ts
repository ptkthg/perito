import { describe, expect, it } from 'vitest';
import { arestasLaterais, binsByEntity, caminho, coocorrencias, entityValues, isExterno, sparkline } from './entities';
import { ev } from './test-events';

const evs = [
  ev({ idx: 0, ts_utc: '2026-11-10T11:55:00.000Z', host: 'ws-fin-023', user: 'svc_backup' }),
  ev({ idx: 1, ts_utc: '2026-11-10T13:39:58.000Z', host: 'ws-fin-023', user: 'm.silva', dst_ip: '10.10.30.5', extra: { dst_host: 'srv-file-01' } }),
  ev({ idx: 2, ts_utc: '2026-11-10T13:40:12.000Z', host: 'srv-file-01', user: 'svc_backup', extra: { src_host: 'ws-fin-023' } }),
  ev({ idx: 3, ts_utc: '2026-11-10T13:57:43.000Z', host: 'srv-file-01', user: 'svc_backup', domain: 'bkp.example-storage.net' }),
];

describe('entidades', () => {
  it('entityValues segue o backend', () => {
    expect(entityValues(evs[1]!).host).toEqual(['ws-fin-023', 'srv-file-01']);
  });
  it('sparkline: zero vira ·, máximo vira █', () => {
    expect(sparkline([0, 1, 4, 0])).toBe('·▄█·');
    expect(sparkline([0, 0])).toBe('··');
  });
  it('binsByEntity distribui no tempo', () => {
    const b = binsByEntity(evs, '2026-11-10T11:00:00.000Z', '2026-11-10T15:00:00.000Z', 4);
    expect(b.get('user\u0000svc_backup')).toEqual([1, 0, 2, 0]);
  });
  it('coocorrências e arestas laterais', () => {
    expect(coocorrencias(evs, 'user', 'svc_backup').host.map((h) => h.valor)).toEqual(['ws-fin-023', 'srv-file-01']);
    expect(arestasLaterais(evs).map((a) => `${a.de}→${a.para}`)).toEqual(['ws-fin-023→srv-file-01']);
  });
  it('caminho textual', () => {
    expect(caminho(evs, 'user', 'svc_backup')).toEqual(['svc_backup', 'ws-fin-023', 'srv-file-01']);
    expect(caminho(evs, 'host', 'srv-file-01')).toEqual(['ws-fin-023', 'srv-file-01', 'bkp.example-storage.net']);
  });
  it('externo', () => {
    expect(isExterno('ip', '203.0.113.45')).toBe(true);
    expect(isExterno('ip', '10.10.30.5')).toBe(false);
    expect(isExterno('domain', 'dc01.acme.local')).toBe(false);
  });
});
