import { describe, expect, it } from 'vitest';
import { type Grafo, type GrafoAresta, type GrafoNo, bytesSI, espacarChips, layoutMapa, metricaAresta, rotear } from './graph';

const no = (id: string, coluna: string, p: Partial<GrafoNo> = {}): GrafoNo => ({
  id,
  tipo: id.split(':')[0]!,
  rotulo: id.split(':').slice(1).join(':'),
  coluna,
  flags: {},
  primeira: '2026-11-10T13:00:00.000Z',
  ultima: '2026-11-10T13:00:00.000Z',
  eventos: 1,
  tecnicas: [],
  relevante: false,
  ...p,
});
const ar = (id: string, origem: string, destino: string, p: Partial<GrafoAresta> = {}): GrafoAresta => ({
  id,
  origem,
  destino,
  tipo: 'logon',
  rotulo: '',
  primeira: '2026-11-10T13:00:00.000Z',
  ultima: '2026-11-10T13:00:00.000Z',
  contagem: 1,
  sucesso: 1,
  falha: 0,
  bytes_out: 0,
  volume_alto: false,
  tecnicas: [],
  raw_refs: [],
  idxs: [1],
  suspeita: false,
  ...p,
});

const base: Grafo = {
  nos: [
    no('email:x@y.example', 'entrada', { relevante: true }),
    no('conta:m.silva', 'interno', { relevante: true }),
    no('host:ws-fin-023', 'interno', { relevante: true, primeira: '2026-11-10T11:00:00.000Z' }),
    no('conta:dc01$', 'interno'),
    no('dominio:bkp.example', 'saida', { relevante: true }),
    no('dominio:www.office.com', 'saida'),
  ],
  arestas: [
    ar('e1', 'email:x@y.example', 'conta:m.silva', { tipo: 'email', suspeita: true, primeira: '2026-11-10T13:02:00.000Z' }),
    ar('e2', 'conta:m.silva', 'host:ws-fin-023', { primeira: '2026-11-10T11:30:00.000Z' }),
    ar('e3', 'host:ws-fin-023', 'dominio:bkp.example', { tipo: 'rede_externa', suspeita: true, volume_alto: true, bytes_out: 2469606194, primeira: '2026-11-10T13:57:00.000Z' }),
    ar('e4', 'host:ws-fin-023', 'dominio:www.office.com', { tipo: 'rede_externa', idxs: [7, 8] }),
    ar('e5', 'conta:dc01$', 'host:ws-fin-023', { idxs: [9] }),
  ],
  caminho: ['e1', 'e3'],
};
const opts = { recolherRuido: false, soCaminho: false, expandidos: new Set<string>() };

describe('layout do mapa', () => {
  it('é determinístico (ordem de entrada não importa)', () => {
    const embaralhado: Grafo = { ...base, nos: [...base.nos].reverse(), arestas: [...base.arestas].reverse() };
    const a = layoutMapa(base, opts);
    const b = layoutMapa(embaralhado, opts);
    expect(a.colunas.map((c) => c.map((n) => `${n.id}@${n.slot}`))).toEqual(b.colunas.map((c) => c.map((n) => `${n.id}@${n.slot}`)));
  });
  it('coluna pelo campo coluna; ordem (caminho, relevante, primeira, id)', () => {
    const l = layoutMapa(base, opts);
    expect(l.colunas.map((c) => c.map((n) => n.id))).toEqual([
      ['email:x@y.example'],
      ['host:ws-fin-023', 'conta:m.silva', 'conta:dc01$'],
      [],
      ['dominio:bkp.example', 'dominio:www.office.com'],
    ]);
    expect(l.arestas.find((a) => a.id === 'e3')!.passo).toBe(2);
  });
  it('GUIADO recolhe o ruído em grupos por tipo e agrega as arestas', () => {
    const l = layoutMapa(base, { ...opts, recolherRuido: true });
    expect(l.colunas[1]!.map((n) => n.id)).toEqual(['host:ws-fin-023', 'conta:m.silva', 'grupo:interno:conta']);
    expect(l.colunas[1]![2]!.rotulo).toBe('+1 contas de ruído');
    const g = l.arestas.find((a) => a.origem === 'grupo:interno:conta')!;
    expect(g.idxs).toEqual([9]);
    // expandir (+) devolve o nó
    const e = layoutMapa(base, { ...opts, recolherRuido: true, expandidos: new Set(['grupo:interno:conta']) });
    expect(e.colunas[1]!.map((n) => n.id)).toContain('conta:dc01$');
  });
  it('acima de 8 nós por coluna agrupa o que não é relevante nem do caminho', () => {
    const muitos: Grafo = {
      nos: [no('host:alvo', 'interno', { relevante: true }), ...Array.from({ length: 12 }, (_, i) => no(`ip:10.0.0.${i}`, 'interno'))],
      arestas: [],
      caminho: [],
    };
    const l = layoutMapa(muitos, opts);
    expect(l.colunas[1]!.map((n) => n.id)).toEqual(['host:alvo', 'grupo:interno:ip']);
    expect(l.colunas[1]![1]!.membros).toHaveLength(12);
  });
  it('c: só o caminho', () => {
    const l = layoutMapa(base, { ...opts, soCaminho: true });
    expect(l.arestas.map((a) => a.id).sort()).toEqual(['e1', 'e3']);
    expect([...l.nos.keys()].sort()).toEqual(['conta:m.silva', 'dominio:bkp.example', 'email:x@y.example', 'host:ws-fin-023']);
  });
});

describe('roteamento', () => {
  const m = { colX: [0, 200, 460, 660], colW: [150, 210, 160, 180], canal: 50, noH: 60, slotH: 80, topo: 10 };
  it('ortogonal com até 2 dobras, do lado certo de cada nó', () => {
    const l = layoutMapa(base, opts);
    const r = rotear(l, m);
    for (const x of r) {
      expect(x.pts.length).toBeLessThanOrEqual(4);
      for (let i = 1; i < x.pts.length; i++) {
        const [a, b] = [x.pts[i - 1]!, x.pts[i]!];
        expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
      }
    }
    const e1 = r.find((x) => x.id === 'e1')!;
    expect(e1.pts[0]![0]).toBe(150); // borda direita do e-mail
    expect(e1.pts.at(-1)![0]).toBe(200); // borda esquerda da conta
  });
  it('é determinístico', () => {
    const a = rotear(layoutMapa(base, opts), m).map((x) => x.d);
    const b = rotear(layoutMapa(base, opts), m).map((x) => x.d);
    expect(a).toEqual(b);
  });
});

describe('chips', () => {
  it('afasta chips sobrepostos no mesmo canal, mantém os de outros canais', () => {
    const p = espacarChips([
      { id: 'a', x: 100, y: 50 },
      { id: 'b', x: 104, y: 55 },
      { id: 'c', x: 300, y: 52 },
      { id: 'd', x: 100, y: 200 },
    ]);
    expect(p.get('a')).toEqual([100, 50]);
    expect(p.get('b')).toEqual([104, 76]);
    expect(p.get('c')).toEqual([300, 52]);
    expect(p.get('d')).toEqual([100, 200]);
  });
});

describe('textos', () => {
  it('bytes como o backend e métricas', () => {
    expect(bytesSI(2469606194)).toBe('2,5 GB');
    expect(bytesSI(4521)).toBe('4,5 KB');
    expect(metricaAresta({ volume_alto: true, bytes_out: 2469606194, falha: 0, sucesso: 0 }).texto).toBe('▲2,5 GB');
    expect(metricaAresta({ volume_alto: false, bytes_out: 0, falha: 3, sucesso: 2 }).texto).toBe('✕3 ✓2');
    expect(metricaAresta({ volume_alto: false, bytes_out: 0, falha: 2, sucesso: 0 }).tipo).toBe('falha');
  });
});
