// Bancada (brief §10): lógica pura dos formulários de escrita.
import type { PeritoEvent } from './types';
import { truncateMiddle } from './format';

const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Limites do backend (spec 06). */
export const ACHADO_MIN = 20; // mínimo da UI (brief: 20 caracteres)
export const ACHADO_MAX = 300; // máximo do backend

/**
 * Texto pré-preenchido do achado: só fatos do evento, sem adjetivos.
 * Ex.: "powershell.exe iniciado por excel.exe em ws-fin-023 (conta m.silva) · cmd: powershell.exe -nop …"
 */
export function textoAchado(ev: PeritoEvent): string {
  const base = (ev.description ?? ev.action ?? `${ev.event_type} em ${ev.source}`).trim();
  const partes = [base];
  const has = (v: string) => base.toLowerCase().includes(v.toLowerCase());
  const host = ev.host ?? s(ev.extra.src_host);
  if (host && !has(host)) partes.push(`em ${ev.host ? host : `~${host}`}`);
  if (ev.user && !has(ev.user)) partes.push(`(conta ${ev.user})`);
  if (ev.dst_ip && !has(ev.dst_ip)) partes.push(`→ ${ev.dst_ip}${ev.dst_port != null ? `:${ev.dst_port}` : ''}`);
  else if (ev.dst_port != null && !has(`:${ev.dst_port}`) && ev.dst_ip) partes.push(`porta ${ev.dst_port}`);
  if (ev.domain && !has(ev.domain)) partes.push(`(${ev.domain})`);
  let txt = partes.join(' ');
  if (ev.cmdline && !has(ev.cmdline)) txt += ` · cmd: ${truncateMiddle(ev.cmdline.replace(/\s+/g, ' '), 140)}`;
  if (ev.extra.volume_alto === true) txt += ' · volume alto';
  return truncateMiddle(txt.replace(/[\r\n|]+/g, ' '), ACHADO_MAX);
}

/** Validação do achado (feita só ao salvar). */
export function validaAchado(texto: string): string | null {
  const t = texto.trim();
  if (t.length < ACHADO_MIN) return `mínimo de ${ACHADO_MIN} caracteres (tem ${t.length})`;
  if (t.length > ACHADO_MAX) return `máximo de ${ACHADO_MAX} caracteres (tem ${t.length})`;
  return null;
}

// ---------------------------------------------------------------- 409
export interface Conflito {
  versaoAtual: string;
  conteudoAtual: string;
}

/** Interpreta o corpo de um 409 do backend: {"erro":"conflito","versao_atual","conteudo_atual"}. */
export function parseConflito(status: number, body: unknown): Conflito | null {
  if (status !== 409 || !body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.erro !== 'conflito') return null;
  return { versaoAtual: String(b.versao_atual ?? ''), conteudoAtual: typeof b.conteudo_atual === 'string' ? b.conteudo_atual : '' };
}

// ---------------------------------------------------------------- diff
export type DiffOp = { op: ' ' | '-' | '+'; linha: string; n: number };

/** Diff por linhas (LCS). `n` = número da linha no texto de origem do lado correspondente. */
export function diffLinhas(a: string, b: string): DiffOp[] {
  const A = a.split(/\r?\n/);
  const B = b.split(/\r?\n/);
  const m = A.length;
  const n = B.length;
  // LCS em O(m·n); arquivos do caso são pequenos (markdown/CSV de análise).
  const L: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i]![j] = A[i] === B[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) {
      out.push({ op: ' ', linha: A[i]!, n: j + 1 });
      i++;
      j++;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) {
      out.push({ op: '-', linha: A[i]!, n: i + 1 });
      i++;
    } else {
      out.push({ op: '+', linha: B[j]!, n: j + 1 });
      j++;
    }
  }
  while (i < m) out.push({ op: '-', linha: A[i]!, n: ++i });
  while (j < n) out.push({ op: '+', linha: B[j]!, n: ++j });
  return out;
}

/** Diff mínimo: só as linhas alteradas, com `contexto` linhas ao redor; lacunas viram "…". */
export function diffMinimo(a: string, b: string, contexto = 1): (DiffOp | null)[] {
  const ops = diffLinhas(a, b);
  const keep = new Set<number>();
  ops.forEach((o, i) => {
    if (o.op !== ' ') for (let k = i - contexto; k <= i + contexto; k++) keep.add(k);
  });
  const out: (DiffOp | null)[] = [];
  let last = -2;
  ops.forEach((o, i) => {
    if (!keep.has(i)) return;
    if (i !== last + 1 && out.length) out.push(null);
    out.push(o);
    last = i;
  });
  return out;
}

// ---------------------------------------------------------------- IOC
export const MOTIVOS = ['falso positivo', 'infraestrutura legítima', 'interno'] as const;
export type Confianca = 'candidato' | 'confirmado' | 'descartado';

/** Motivo de descarte aceito pelo backend: um dos fixos ou "outro: <texto até 200>". */
export function motivoValido(m: string): string | null {
  const t = m.trim();
  if ((MOTIVOS as readonly string[]).includes(t)) return null;
  const o = /^outro:\s*(.+)$/.exec(t);
  if (!o) return 'escolha um motivo (falso positivo · infraestrutura legítima · interno · outro: texto)';
  if (o[1]!.trim().length > 200) return 'motivo "outro" com até 200 caracteres';
  return null;
}

export interface ItemIoc {
  tipo: string;
  valor: string;
  confianca: Confianca;
  motivo?: string;
}

/** Monta o corpo do PATCH em lote (aplica tudo ou nada). Lança se o descarte não tiver motivo válido. */
export function loteIoc(linhas: { tipo: string; valor: string }[], confianca: Confianca, motivo?: string): { itens: ItemIoc[] } {
  if (linhas.length === 0) throw new Error('nenhum IOC selecionado');
  if (confianca === 'descartado') {
    const e = motivoValido(motivo ?? '');
    if (e) throw new Error(e);
  }
  const vistos = new Set<string>();
  const itens: ItemIoc[] = [];
  for (const l of linhas) {
    const k = `${l.tipo}\u0000${l.valor}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    itens.push(confianca === 'descartado' ? { tipo: l.tipo, valor: l.valor, confianca, motivo: motivo!.trim() } : { tipo: l.tipo, valor: l.valor, confianca });
  }
  return { itens };
}

// ---------------------------------------------------------------- técnicas confirmadas
/**
 * Técnica confirmada = citada em achados.md para aquele evento (raw_ref na evidência do achado).
 * `global` = técnicas citadas em qualquer achado.
 */
export interface Confirmadas {
  porRef: Map<string, Set<string>>;
  global: Set<string>;
}

export function indexaConfirmadas(achados: { attack: string[]; evidencia: string[] }[], expand: (ref: string) => string[]): Confirmadas {
  const porRef = new Map<string, Set<string>>();
  const global = new Set<string>();
  for (const a of achados) {
    for (const t of a.attack) global.add(t);
    for (const ev of a.evidencia) {
      for (const ref of expand(ev)) {
        const set = porRef.get(ref) ?? porRef.set(ref, new Set()).get(ref)!;
        for (const t of a.attack) set.add(t);
      }
    }
  }
  return { porRef, global };
}

export const VAZIO_CONF: Confirmadas = { porRef: new Map(), global: new Set() };

/** Sugerida (mostra "?") = veio da heurística e ainda não foi confirmada em achados.md. */
export function sugerida(ev: Pick<PeritoEvent, 'raw_ref' | 'extra'>, tech: string, conf: Confirmadas): boolean {
  if (!(ev.extra.mitre_heuristica ?? []).includes(tech)) return false;
  return !conf.porRef.get(ev.raw_ref)?.has(tech);
}
