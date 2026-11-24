// MAPA DO ATAQUE (brief §9): tipos do /grafo, layout determinístico em 4 colunas,
// agrupamento de ruído e roteamento ortogonal das arestas (≤2 dobras, pontes nos cruzamentos).
// Tudo puro e testável; o componente só desenha.

export type NoTipo = 'email' | 'conta' | 'host' | 'ip' | 'dominio' | 'app';
export type Coluna = 'entrada' | 'interno' | 'nuvem' | 'saida';

export interface GrafoNo {
  id: string;
  tipo: NoTipo | string;
  rotulo: string;
  coluna: Coluna | string;
  flags: { sem_edr?: boolean; externo?: boolean; nuvem?: boolean; onprem?: boolean };
  primeira: string;
  ultima: string;
  eventos: number;
  tecnicas: string[];
  relevante: boolean;
  ips?: string[];
}

export interface GrafoAresta {
  id: string;
  origem: string;
  destino: string;
  tipo: string;
  rotulo: string;
  contas?: string[];
  primeira: string;
  ultima: string;
  contagem: number;
  sucesso: number;
  falha: number;
  bytes_out: number;
  volume_alto: boolean;
  tecnicas: string[];
  raw_refs: string[];
  idxs: number[];
  suspeita: boolean;
}

export interface Grafo {
  nos: GrafoNo[];
  arestas: GrafoAresta[];
  caminho: string[];
}

export const COLUNAS: { key: Coluna; titulo: string; sub: string; ch: number }[] = [
  { key: 'entrada', titulo: 'ENTRADA', sub: 'de onde veio', ch: 22 },
  { key: 'interno', titulo: 'REDE INTERNA', sub: 'máquinas e contas da empresa', ch: 32 },
  { key: 'nuvem', titulo: 'NUVEM', sub: 'Microsoft 365 / Entra', ch: 24 },
  { key: 'saida', titulo: 'SAÍDA', sub: 'para onde foram os dados', ch: 28 },
];
export const CANAL_CH = 8;
export const MAX_POR_COLUNA = 8;

const TIPO_PLURAL: Record<string, string> = {
  ip: 'IPs',
  dominio: 'domínios',
  conta: 'contas',
  host: 'máquinas',
  app: 'aplicativos',
  email: 'e-mails',
};

export interface LNo extends GrafoNo {
  col: number;
  slot: number;
  noCaminho: boolean;
  /** Nó de grupo (ruído agregado): ids dos membros. */
  membros?: string[];
}

export interface LAresta extends GrafoAresta {
  /** Passo no caminho do atacante (1..n), se fizer parte. */
  passo: number | null;
  /** Arestas originais agregadas (quando há grupo). */
  agregadas: string[];
}

export interface MapaLayout {
  colunas: LNo[][];
  nos: Map<string, LNo>;
  arestas: LAresta[];
  /** id da aresta por passo (índice 0 = passo 1). */
  passos: string[];
  /** grupos recolhidos (id do grupo → membros). */
  grupos: Map<string, string[]>;
}

export interface LayoutOpts {
  /** GUIADO recolhe o ruído (nós fora do caminho e não relevantes) mesmo com ≤8 por coluna. */
  recolherRuido: boolean;
  /** Só nós e arestas do caminho (tecla c). */
  soCaminho: boolean;
  /** Grupos expandidos pelo analista (+). */
  expandidos: ReadonlySet<string>;
}

const colIndex = (c: string) => {
  const i = COLUNAS.findIndex((k) => k.key === c);
  return i < 0 ? 1 : i;
};

export const grupoId = (col: string, tipo: string) => `grupo:${col}:${tipo}`;

/**
 * Layout determinístico: mesmos dados → mesmo desenho.
 * Ordem na coluna: (no caminho desc, relevante desc, primeira asc, id asc).
 */
export function layoutMapa(g: Grafo, opts: LayoutOpts): MapaLayout {
  const passoDe = new Map<string, number>();
  g.caminho.forEach((id, i) => passoDe.set(id, i + 1));
  const noCaminho = new Set<string>();
  for (const a of g.arestas) {
    if (passoDe.has(a.id)) {
      noCaminho.add(a.origem);
      noCaminho.add(a.destino);
    }
  }

  // 1) nós visíveis (antes de agrupar)
  let nos = g.nos;
  if (opts.soCaminho) nos = nos.filter((n) => noCaminho.has(n.id));

  // 2) agrupamento por coluna
  const porCol = new Map<string, GrafoNo[]>();
  for (const n of nos) {
    const k = COLUNAS[colIndex(n.coluna)]!.key;
    (porCol.get(k) ?? porCol.set(k, []).get(k)!).push(n);
  }
  const ordem = (a: GrafoNo, b: GrafoNo) =>
    Number(noCaminho.has(b.id)) - Number(noCaminho.has(a.id)) ||
    Number(b.relevante) - Number(a.relevante) ||
    (a.primeira < b.primeira ? -1 : a.primeira > b.primeira ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const mapeia = new Map<string, string>(); // id original → id exibido (ele mesmo ou grupo)
  const grupos = new Map<string, string[]>();
  const colunas: LNo[][] = COLUNAS.map(() => []);
  for (const [ci, c] of COLUNAS.entries()) {
    const lista = [...(porCol.get(c.key) ?? [])].sort(ordem);
    const fixos = lista.filter((n) => noCaminho.has(n.id) || n.relevante);
    const resto = lista.filter((n) => !(noCaminho.has(n.id) || n.relevante));
    const agrupar = opts.recolherRuido ? resto.length > 0 : lista.length > MAX_POR_COLUNA;
    const visiveis: GrafoNo[] = [...fixos];
    const porTipo = new Map<string, GrafoNo[]>();
    for (const n of resto) {
      const gid = grupoId(c.key, n.tipo);
      if (!agrupar || opts.expandidos.has(gid)) visiveis.push(n);
      else (porTipo.get(n.tipo) ?? porTipo.set(n.tipo, []).get(n.tipo)!).push(n);
    }
    // nós soltos mantêm a ordem canônica
    visiveis.sort(ordem);
    for (const n of visiveis) {
      mapeia.set(n.id, n.id);
      colunas[ci]!.push({ ...n, col: ci, slot: 0, noCaminho: noCaminho.has(n.id) });
    }
    for (const tipo of [...porTipo.keys()].sort()) {
      const membros = porTipo.get(tipo)!;
      const gid = grupoId(c.key, tipo);
      grupos.set(gid, membros.map((m) => m.id));
      for (const m of membros) mapeia.set(m.id, gid);
      colunas[ci]!.push({
        id: gid,
        tipo,
        rotulo: `+${membros.length} ${TIPO_PLURAL[tipo] ?? tipo} de ruído`,
        coluna: c.key,
        flags: {},
        primeira: membros.map((m) => m.primeira).sort()[0] ?? '',
        ultima: membros.map((m) => m.ultima).sort().at(-1) ?? '',
        eventos: membros.reduce((s, m) => s + m.eventos, 0),
        tecnicas: [],
        relevante: false,
        col: ci,
        slot: 0,
        noCaminho: false,
        membros: membros.map((m) => m.id),
      });
    }
    colunas[ci]!.forEach((n, i) => (n.slot = i));
  }

  // 3) arestas: remapeadas para grupos e agregadas por (origem, destino, tipo)
  const agreg = new Map<string, LAresta>();
  const ordenadas = [...g.arestas].sort((a, b) => (a.primeira < b.primeira ? -1 : a.primeira > b.primeira ? 1 : a.id < b.id ? -1 : 1));
  for (const a of ordenadas) {
    if (opts.soCaminho && !passoDe.has(a.id)) continue;
    const o = mapeia.get(a.origem);
    const d = mapeia.get(a.destino);
    if (!o || !d) continue;
    const agrupada = o !== a.origem || d !== a.destino;
    const k = agrupada ? `${o}|${d}|${a.tipo}` : a.id;
    const ex = agreg.get(k);
    if (!ex) {
      agreg.set(k, { ...a, id: agrupada ? `g:${k}` : a.id, origem: o, destino: d, passo: passoDe.get(a.id) ?? null, agregadas: [a.id] });
    } else {
      ex.contagem += a.contagem;
      ex.sucesso += a.sucesso;
      ex.falha += a.falha;
      ex.bytes_out += a.bytes_out;
      ex.volume_alto ||= a.volume_alto;
      ex.suspeita ||= a.suspeita;
      ex.idxs = [...ex.idxs, ...a.idxs].sort((x, y) => x - y);
      ex.raw_refs = [...ex.raw_refs, ...a.raw_refs];
      ex.tecnicas = [...new Set([...ex.tecnicas, ...a.tecnicas])];
      ex.ultima = ex.ultima > a.ultima ? ex.ultima : a.ultima;
      ex.agregadas.push(a.id);
      ex.rotulo = `${ex.agregadas.length} ligações agrupadas`;
    }
  }
  const nosMap = new Map<string, LNo>();
  for (const col of colunas) for (const n of col) nosMap.set(n.id, n);
  const arestas = [...agreg.values()];
  const passos = g.caminho.filter((id) => arestas.some((a) => a.id === id));
  return { colunas, nos: nosMap, arestas, passos, grupos };
}

// ---------------------------------------------------------------- roteamento
export interface Metricas {
  /** x inicial de cada coluna (px). */
  colX: number[];
  /** largura de cada coluna (px). */
  colW: number[];
  /** largura do canal entre colunas (px). */
  canal: number;
  /** altura do nó e passo vertical entre slots (px). */
  noH: number;
  slotH: number;
  /** deslocamento vertical do primeiro slot (px). */
  topo: number;
}

export interface Rota {
  id: string;
  /** Pontos da poligonal (início no nó de origem, fim no nó de destino). */
  pts: [number, number][];
  /** Caminho SVG com pontes (arcos de 4px) onde esta aresta cede a outra. */
  d: string;
  /** Posição do chip [n] / métrica (meio do segmento no canal). */
  chip: [number, number];
  prioridade: number;
}

const prioridade = (a: LAresta) => (a.passo !== null ? 3 : a.suspeita ? 2 : 1);

/**
 * Arestas ortogonais com até 2 dobras:
 *  coluna origem < destino: sai pela direita, desce/sobe no canal antes do destino, entra pela esquerda;
 *  mesma coluna: sai pela direita, usa o canal à direita e volta (colchete);
 *  origem > destino: sai pela esquerda, canal antes da origem, entra pela direita.
 * Arestas que dividem o canal são separadas por 4px.
 */
export function rotear(lay: MapaLayout, m: Metricas): Rota[] {
  const midY = (n: LNo) => m.topo + n.slot * m.slotH + m.noH / 2;
  const left = (n: LNo) => m.colX[n.col]!;
  const right = (n: LNo) => m.colX[n.col]! + m.colW[n.col]!;
  const canalX = (c: number) => (m.colX[c] ?? 0) + (m.colW[c] ?? 0); // canal à direita da coluna c
  const lanes = new Map<number, number>();
  const lane = (c: number) => {
    const k = lanes.get(c) ?? 0;
    lanes.set(c, k + 1);
    // alterna a partir do centro do canal: 0, +4, -4, +8, -8...
    const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 4;
    return Math.max(4, Math.min(m.canal - 4, m.canal / 2 + off));
  };
  // ordem estável: prioridade desc e id, para que as faixas sejam determinísticas
  const ord = [...lay.arestas].sort((a, b) => prioridade(b) - prioridade(a) || (a.id < b.id ? -1 : 1));
  const rotas: Rota[] = [];
  // paralelas (mesmo par de nós) ganham deslocamento vertical de 4px nas extremidades
  const pares = new Map<string, number>();
  for (const a of ord) {
    const o = lay.nos.get(a.origem);
    const t = lay.nos.get(a.destino);
    if (!o || !t) continue;
    const parK = [a.origem, a.destino].sort().join('|');
    const pi = pares.get(parK) ?? 0;
    pares.set(parK, pi + 1);
    const dy = pi * 4;
    let pts: [number, number][];
    if (o.col < t.col) {
      const cx = canalX(t.col - 1) + lane(t.col - 1);
      pts = [
        [right(o), midY(o) + dy],
        [cx, midY(o) + dy],
        [cx, midY(t) + dy],
        [left(t), midY(t) + dy],
      ];
    } else if (o.col === t.col) {
      const cx = canalX(o.col) + lane(o.col);
      pts = [
        [right(o), midY(o) + dy],
        [cx, midY(o) + dy],
        [cx, midY(t) + dy],
        [right(t), midY(t) + dy],
      ];
    } else {
      const cx = canalX(o.col - 1) + lane(o.col - 1);
      pts = [
        [left(o), midY(o) + dy],
        [cx, midY(o) + dy],
        [cx, midY(t) + dy],
        [right(t), midY(t) + dy],
      ];
    }
    // remove dobras degeneradas (segmento vertical nulo)
    if (pts[1]![1] === pts[2]![1]) pts = [pts[0]!, pts[3]!];
    const chip: [number, number] = pts.length === 4 ? [pts[1]![0], (pts[1]![1] + pts[2]![1]) / 2] : [(pts[0]![0] + pts[1]![0]) / 2, pts[0]![1]];
    rotas.push({ id: a.id, pts, d: '', chip, prioridade: prioridade(a) });
  }
  // pontes: a aresta de menor prioridade (ou maior id no empate) ganha arco onde cruza outra
  for (const r of rotas) {
    const pontes: [number, number][][] = r.pts.slice(1).map(() => []);
    for (let si = 0; si < r.pts.length - 1; si++) {
      const [a, b] = [r.pts[si]!, r.pts[si + 1]!];
      if (a[1] !== b[1]) continue; // pontes só nos segmentos horizontais
      const y = a[1];
      const [x1, x2] = a[0] < b[0] ? [a[0], b[0]] : [b[0], a[0]];
      for (const o of rotas) {
        if (o === r) continue;
        const cede = r.prioridade < o.prioridade || (r.prioridade === o.prioridade && r.id > o.id);
        if (!cede) continue;
        for (let oi = 0; oi < o.pts.length - 1; oi++) {
          const [c, d] = [o.pts[oi]!, o.pts[oi + 1]!];
          if (c[0] !== d[0]) continue;
          const x = c[0];
          const [y1, y2] = c[1] < d[1] ? [c[1], d[1]] : [d[1], c[1]];
          if (x > x1 + 6 && x < x2 - 6 && y > y1 + 1 && y < y2 - 1) pontes[si]!.push([x, y]);
        }
      }
    }
    r.d = pathComPontes(r.pts, pontes);
  }
  return rotas;
}

function pathComPontes(pts: [number, number][], pontes: [number, number][][]): string {
  let d = `M${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const hs = (pontes[i - 1] ?? []).map((p) => p[0]);
    if (ay === by && hs.length) {
      const dir = bx > ax ? 1 : -1;
      hs.sort((p, q) => (p - q) * dir);
      for (const x of hs) {
        d += `L${x - 4 * dir} ${ay}a4 4 0 0 ${dir > 0 ? 1 : 0} ${8 * dir} 0`;
      }
    }
    d += `L${bx} ${by}`;
  }
  return d;
}

/**
 * Afasta chips [n] que cairiam um sobre o outro no mesmo canal (|Δx| < faixa):
 * ordena por y e empurra para baixo até `gap` px de distância. Determinístico.
 */
export function espacarChips(pts: { id: string; x: number; y: number }[], gap = 26, faixa = 40): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const ord = [...pts].sort((a, b) => a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : 1));
  const grupos: { x: number; itens: { id: string; x: number; y: number }[] }[] = [];
  for (const p of ord) {
    const g = grupos.find((gg) => Math.abs(gg.x - p.x) < faixa);
    if (g) g.itens.push(p);
    else grupos.push({ x: p.x, itens: [p] });
  }
  for (const g of grupos) {
    g.itens.sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : 1));
    let ultimo = -Infinity;
    for (const p of g.itens) {
      const y = Math.max(p.y, ultimo + gap);
      out.set(p.id, [p.x, y]);
      ultimo = y;
    }
  }
  return out;
}

// ---------------------------------------------------------------- textos
/** Bytes como o backend (base 1000, vírgula): 2469606194 → "2,5 GB". */
export function bytesSI(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000;
    i++;
  }
  return `${(v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)).replace('.', ',').replace(/,0$/, '')} ${u[i]}`;
}

/** Métrica curta da aresta (brief §9.3): ▲volume, ✕falhas ✓sucessos, ou nada. */
export function metricaAresta(a: Pick<GrafoAresta, 'volume_alto' | 'bytes_out' | 'falha' | 'sucesso'>): { texto: string; tipo: 'volume' | 'mista' | 'falha' | null } {
  if (a.volume_alto) return { texto: `▲${bytesSI(a.bytes_out)}`, tipo: 'volume' };
  if (a.falha > 0 && a.sucesso > 0) return { texto: `✕${a.falha} ✓${a.sucesso}`, tipo: 'mista' };
  if (a.falha > 0) return { texto: `✕${a.falha}`, tipo: 'falha' };
  return { texto: '', tipo: null };
}

export const rotuloTipoNo = (n: Pick<GrafoNo, 'tipo' | 'flags'>): string => {
  switch (n.tipo) {
    case 'host':
      return 'HOST';
    case 'conta':
      return 'CONTA';
    case 'app':
      return 'APP';
    case 'email':
      return 'MAIL';
    case 'ip':
      return n.flags.externo ? 'IP · externo' : 'IP';
    case 'dominio':
      return n.flags.externo ? 'DOMÍNIO · externo' : 'DOMÍNIO';
    default:
      return String(n.tipo).toUpperCase();
  }
};

/** Frase do passo no modo GUIADO (lista CAMINHO). */
export function frasePasso(a: GrafoAresta, o: string, d: string): string {
  switch (a.tipo) {
    case 'email':
      return `${a.rotulo} chegou para ${d}`;
    case 'logon':
      return `${o} entrou em ${d} (${a.rotulo})`;
    case 'rdp':
    case 'smb':
    case 'winrm':
    case 'ssh':
      return `${o} acessou ${d}: ${a.rotulo}`;
    case 'rede_externa':
      return `${o} conectou em ${d} (${a.rotulo})`;
    case 'signin':
      return `${o} tentou entrar na conta ${d}: ${a.rotulo}`;
    case 'mfa':
      return `${o} registrou ${a.rotulo} na conta ${d}`;
    case 'consent':
      return `${o} ${a.rotulo}`;
    default:
      return `${o} → ${d}: ${a.rotulo}`;
  }
}
