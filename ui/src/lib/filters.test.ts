import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, addClause, applyLocal, compileQuery, describeFilter, normalizeHost, normalizeUser, toQuery, queryString } from './filters';
import { makeTacticOf } from './attack-pt';
import { ev } from './test-events';

const run = (q: Parameters<typeof compileQuery>[0], evs: ReturnType<typeof ev>[]) => evs.filter(compileQuery(q)).map((e) => e.idx);

describe('normalização (igual a schema.py)', () => {
  it('host: minúsculo, sem domínio DNS, IP preservado', () => {
    expect(normalizeHost('WS-FIN-023.acme.local')).toBe('ws-fin-023');
    expect(normalizeHost('\\\\SRV-FILE-01')).toBe('srv-file-01');
    expect(normalizeHost('10.10.20.23')).toBe('10.10.20.23');
    expect(normalizeHost('-')).toBeNull();
  });
  it('user: sem DOMINIO\\ e sem @dominio', () => {
    expect(normalizeUser('ACME\\M.Silva')).toBe('m.silva');
    expect(normalizeUser('m.silva@acme.com.br')).toBe('m.silva');
    expect(normalizeUser('n/a')).toBeNull();
  });
});

describe('compileQuery', () => {
  const evs = [
    ev({ idx: 0, host: 'ws-fin-023', user: 'm.silva', src_ip: '10.10.20.23', dst_ip: '203.0.113.45', domain: 'cdn-update.example-cdn.net', source: 'defender', event_type: 'network' }),
    ev({ idx: 1, host: null, src_ip: '10.10.20.23', source: 'splunk', event_type: 'network', extra: { src_host: 'ws-fin-023', observer: 'pa-fw-01' } }),
    ev({ idx: 2, host: 'srv-file-01', user: 'svc_backup', source: 'sentinel', event_type: 'logon', extra: { src_host: 'ws-fin-023' } }),
    ev({ idx: 3, host: null, source: 'elastic', event_type: 'dns', domain: 'WWW.Office.com', extra: { observer: 'dc01', host_ip: '10.10.30.5' } }),
    ev({ idx: 4, host: 'ws-fin-023', source: 'defender', event_type: 'network', extra: { dst_host: 'srv-file-01' }, ts_utc: '2026-11-10T14:00:00.000Z' }),
  ];

  it('host casa host | src_host | dst_host | observer, normalizando a consulta', () => {
    expect(run({ host: 'WS-FIN-023.acme.local' }, evs)).toEqual([0, 1, 2, 4]);
    expect(run({ host: 'srv-file-01' }, evs)).toEqual([2, 4]);
    expect(run({ host: 'dc01' }, evs)).toEqual([3]);
  });
  it('user normalizado', () => {
    expect(run({ user: 'ACME\\SVC_BACKUP' }, evs)).toEqual([2]);
    expect(run({ user: 'm.silva@acme.com.br' }, evs)).toEqual([0]);
  });
  it('ip casa src_ip | dst_ip | extra.host_ip', () => {
    expect(run({ ip: '10.10.20.23' }, evs)).toEqual([0, 1]);
    expect(run({ ip: '203.0.113.45' }, evs)).toEqual([0]);
    expect(run({ ip: '10.10.30.5' }, evs)).toEqual([3]);
  });
  it('dominio: substring sem caixa', () => {
    expect(run({ dominio: 'office' }, evs)).toEqual([3]);
    expect(run({ dominio: 'EXAMPLE-CDN' }, evs)).toEqual([0]);
  });
  it('fonte/tipo em lista, de/ate inclusivos', () => {
    expect(run({ fonte: 'splunk,elastic' }, evs)).toEqual([1, 3]);
    expect(run({ tipo: 'network' }, evs)).toEqual([0, 1, 4]);
    expect(run({ de: '2026-11-10T14:00:00.000Z' }, evs)).toEqual([4]);
    expect(run({ ate: '2026-11-10T13:00:00.000Z' }, evs)).toEqual([0, 1, 2, 3]);
  });
  it('excluir_<campo> remove o que casa', () => {
    expect(run({ excluir: { fonte: ['defender'] } }, evs)).toEqual([1, 2, 3]);
    expect(run({ host: 'ws-fin-023', excluir: { host: ['srv-file-01'] } }, evs)).toEqual([0, 1]);
    expect(run({ excluir: { user: ['M.Silva'] } }, evs)).toEqual([1, 2, 3, 4]);
  });
});

describe('FilterState', () => {
  it('fonte aceita código e acumula (OU); host substitui', () => {
    let f = addClause(EMPTY_FILTER, { field: 'fonte', neg: false, value: 'DEF' });
    f = addClause(f, { field: 'fonte', neg: false, value: 'SPL' });
    f = addClause(f, { field: 'host', neg: false, value: 'a' });
    f = addClause(f, { field: 'host', neg: false, value: 'b' });
    expect(toQuery(f)).toMatchObject({ fonte: 'defender,splunk', host: 'b' });
  });
  it('exclusão vira excluir_<campo> repetível e não aceita hash', () => {
    let f = addClause(EMPTY_FILTER, { field: 'fonte', neg: true, value: 'splunk' });
    f = addClause(f, { field: 'fonte', neg: true, value: 'elastic' });
    expect(queryString(toQuery(f))).toBe('?excluir_fonte=splunk&excluir_fonte=elastic');
    expect(() => addClause(f, { field: 'hash', neg: true, value: 'abc' })).toThrow(/exclusão não suportada/);
  });
  it('tatica é local: não vai para a query do backend', () => {
    const f = addClause(EMPTY_FILTER, { field: 'tatica', neg: false, value: 'saída de dados' });
    expect(f.clauses[0]!.value).toBe('Exfiltração');
    expect(toQuery(f)).toEqual({});
    expect(describeFilter(f)).toBe('tatica=SAÍDA DE DADOS');
    expect(() => addClause(EMPTY_FILTER, { field: 'tatica', neg: false, value: 'xyz' })).toThrow(/tática desconhecida/);
  });
  it('tecnica é local, aceita técnica-mãe e exclusão', () => {
    const tacticOf = makeTacticOf([]);
    const evs = [ev({ idx: 20, mitre: ['T1059.001'] }), ev({ idx: 21, mitre: ['T1003.001'] }), ev({ idx: 22 })];
    const f = addClause(EMPTY_FILTER, { field: 'tecnica', neg: false, value: 't1059' });
    expect(f.clauses[0]!.value).toBe('T1059');
    expect(toQuery(f)).toEqual({});
    expect(applyLocal(evs, f, tacticOf).map((e) => e.idx)).toEqual([20]);
    const n = addClause(EMPTY_FILTER, { field: 'tecnica', neg: true, value: 'T1003.001' });
    expect(applyLocal(evs, n, tacticOf).map((e) => e.idx)).toEqual([20, 22]);
    expect(() => addClause(EMPTY_FILTER, { field: 'tecnica', neg: false, value: 'xyz' })).toThrow(/técnica inválida/);
  });
  it('applyLocal filtra por tática (inclui e exclui)', () => {
    const tacticOf = makeTacticOf([
      { id: 'T1567.002', nome: '', tatica: 'Exfiltração', eventos: 1 },
      { id: 'T1059.001', nome: '', tatica: 'Execução', eventos: 1 },
      { id: 'T1027', nome: '', tatica: 'Evasão de defesa', eventos: 1 },
    ]);
    const evs = [ev({ idx: 10, mitre: ['T1567.002'] }), ev({ idx: 11, mitre: ['T1059.001', 'T1027'] }), ev({ idx: 12 })];
    const inc = addClause(EMPTY_FILTER, { field: 'tatica', neg: false, value: 'EXECUÇÃO' });
    expect(applyLocal(evs, inc, tacticOf).map((e) => e.idx)).toEqual([11]);
    const exc = addClause(EMPTY_FILTER, { field: 'tatica', neg: true, value: 'DISFARCE' });
    expect(applyLocal(evs, exc, tacticOf).map((e) => e.idx)).toEqual([10, 12]);
  });
});
