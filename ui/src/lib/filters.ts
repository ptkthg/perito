// Modelo de filtro da timeline e semântica de casamento no cliente.
// A semântica espelha timeline.filter_events do backend (src/perito/timeline.py):
//   host  casa host | extra.src_host | extra.dst_host | extra.observer (normalizado)
//   user  normalizado (minúsculo, sem DOMINIO\ e sem @dominio), igualdade
//   ip    casa src_ip | dst_ip | extra.host_ip
//   hash  sha256, igualdade sem caixa
//   dominio  contém (sem caixa)
//   de/ate   inclusivos, comparação de ISO UTC
//   fonte/tipo  listas separadas por vírgula
//   texto  contém (sem caixa) em description | cmdline | file_path | domain
//   excluir_<campo>  remove os eventos que casam

import type { EventQuery, ExcludableField, PeritoEvent } from './types';
import { resolveSource, resolveType, isoMs, tsMs } from './format';
import { type TacticOf, resolveTatica, rotuloTatica } from './attack-pt';

// `tatica` é filtro LOCAL (aplicado no cliente sobre os eventos carregados; o backend não o conhece).
export type FilterField = 'host' | 'user' | 'ip' | 'fonte' | 'tipo' | 'texto' | 'hash' | 'dominio' | 'tatica';

export const FILTER_FIELDS: FilterField[] = ['host', 'user', 'ip', 'fonte', 'tipo', 'texto', 'hash', 'dominio', 'tatica'];

/** Campos que aceitam exclusão (`campo!=v`, tecla F) no backend. */
export const EXCLUDABLE: ReadonlySet<FilterField> = new Set<FilterField>(['host', 'user', 'ip', 'fonte', 'tipo']);

/** Campos que aceitam vários valores positivos (OR). Os demais: o novo substitui o anterior. */
const MULTI: ReadonlySet<FilterField> = new Set<FilterField>(['fonte', 'tipo', 'tatica']);

export const FIELD_ALIASES: Record<string, FilterField> = {
  src: 'fonte',
  source: 'fonte',
  type: 'tipo',
  domain: 'dominio',
  domínio: 'dominio',
  sha256: 'hash',
  text: 'texto',
  tática: 'tatica',
  tactic: 'tatica',
  fase: 'tatica',
};

export function resolveField(name: string): FilterField | null {
  const n = name.trim().toLowerCase();
  if ((FILTER_FIELDS as string[]).includes(n)) return n as FilterField;
  return FIELD_ALIASES[n] ?? null;
}

export interface Clause {
  field: FilterField;
  neg: boolean;
  value: string;
}

export interface FilterState {
  clauses: Clause[];
  de: string | null;
  ate: string | null;
}

export const EMPTY_FILTER: FilterState = { clauses: [], de: null, ate: null };

export function isEmptyFilter(f: FilterState): boolean {
  return f.clauses.length === 0 && !f.de && !f.ate;
}

/** Normaliza o valor digitado para a forma canônica (fonte DEF → defender etc.). */
export function canonicalValue(field: FilterField, value: string): string {
  if (field === 'fonte') return resolveSource(value);
  if (field === 'tipo') return resolveType(value);
  if (field === 'tatica') {
    const t = resolveTatica(value);
    if (!t) throw new Error(`tática desconhecida: ${value} (ex.: ENTRADA, EXECUÇÃO, SAÍDA DE DADOS)`);
    return t;
  }
  return value;
}

const sameClause = (a: Clause, b: Clause) =>
  a.field === b.field && a.neg === b.neg && a.value.toLowerCase() === b.value.toLowerCase();

/** Adiciona uma cláusula aplicando as regras de convivência. Lança Error com mensagem pt-BR. */
export function addClause(f: FilterState, c: Clause): FilterState {
  const clause: Clause = { ...c, value: canonicalValue(c.field, c.value) };
  if (!clause.value) throw new Error(`valor vazio para ${clause.field}`);
  if (clause.neg && !EXCLUDABLE.has(clause.field) && clause.field !== 'tatica') {
    throw new Error(`exclusão não suportada para ${clause.field} (só host, user, ip, fonte, tipo, tatica)`);
  }
  let clauses = f.clauses.filter(
    (x) => !(x.field === clause.field && x.neg !== clause.neg && x.value.toLowerCase() === clause.value.toLowerCase()),
  );
  if (clauses.some((x) => sameClause(x, clause))) return { ...f, clauses };
  if (!clause.neg && !MULTI.has(clause.field)) {
    clauses = clauses.filter((x) => !(x.field === clause.field && !x.neg));
  }
  return { ...f, clauses: [...clauses, clause] };
}

export function removeClause(f: FilterState, i: number): FilterState {
  return { ...f, clauses: f.clauses.filter((_, j) => j !== i) };
}

/** FilterState → query do backend (mesmo formato nos dois modos de dados). */
export function toQuery(f: FilterState, opts: { semJanela?: boolean } = {}): EventQuery {
  const q: EventQuery = {};
  const pos = (field: FilterField) => f.clauses.filter((c) => c.field === field && !c.neg).map((c) => c.value);
  const first = (field: FilterField) => pos(field)[0];
  const host = first('host');
  if (host) q.host = host;
  const user = first('user');
  if (user) q.user = user;
  const ip = first('ip');
  if (ip) q.ip = ip;
  const hash = first('hash');
  if (hash) q.hash = hash;
  const dominio = first('dominio');
  if (dominio) q.dominio = dominio;
  const texto = first('texto');
  if (texto) q.texto = texto;
  const fonte = pos('fonte');
  if (fonte.length) q.fonte = fonte.join(',');
  const tipo = pos('tipo');
  if (tipo.length) q.tipo = tipo.join(',');
  if (!opts.semJanela) {
    if (f.de) q.de = f.de;
    if (f.ate) q.ate = f.ate;
  }
  const excl: Partial<Record<ExcludableField, string[]>> = {};
  for (const c of f.clauses) {
    if (!c.neg || c.field === 'tatica') continue;
    const k = c.field as ExcludableField;
    (excl[k] ??= []).push(c.value);
  }
  if (Object.keys(excl).length) q.excluir = excl;
  return q;
}

/** Serializa a query como na URL do backend (excluir_<campo> repetível). */
export function queryString(q: EventQuery & { bucket?: number }): string {
  const p = new URLSearchParams();
  const keys = ['host', 'user', 'ip', 'hash', 'dominio', 'de', 'ate', 'fonte', 'tipo', 'texto', 'limite', 'bucket'] as const;
  for (const k of keys) {
    const v = q[k];
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  if (q.excluir) {
    for (const [k, vals] of Object.entries(q.excluir)) {
      for (const v of vals ?? []) p.append(`excluir_${k}`, v);
    }
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---------- normalização igual a schema.py ----------
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function normalizeHost(v: string | null | undefined): string | null {
  if (v == null) return null;
  let s = String(v).trim().replace(/^\\+|\\+$/g, '').toLowerCase();
  if (!s || s === '-' || s === 'n/a' || s === 'null' || s === 'none') return null;
  if (IPV4.test(s)) return s;
  s = s.split('.')[0] ?? s;
  return s || null;
}

export function normalizeUser(v: string | null | undefined): string | null {
  if (v == null) return null;
  let s = String(v).trim().toLowerCase();
  if (!s || s === '-' || s === 'n/a' || s === 'null' || s === 'none') return null;
  if (s.includes('\\')) s = s.split('\\').pop() ?? s;
  if (s.includes('@')) s = s.split('@')[0] ?? s;
  return s || null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

// ---------- predicados por campo ----------
function hostMatch(ev: PeritoEvent, host: string): boolean {
  const h = normalizeHost(host);
  if (!h) return true;
  return h === ev.host || h === str(ev.extra.src_host) || h === str(ev.extra.dst_host) || h === str(ev.extra.observer);
}
function userMatch(ev: PeritoEvent, user: string): boolean {
  const u = normalizeUser(user);
  if (!u) return true;
  return u === ev.user;
}
function ipMatch(ev: PeritoEvent, ip: string): boolean {
  const v = ip.trim();
  if (!v) return true;
  return v === ev.src_ip || v === ev.dst_ip || v === str(ev.extra.host_ip);
}
function listMatch(value: string, list: string): boolean {
  const set = list.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return set.length === 0 || set.includes(value.toLowerCase());
}
function textoMatch(ev: PeritoEvent, texto: string): boolean {
  const hay = [ev.description, ev.cmdline, ev.file_path, ev.domain].map((v) => v ?? '').join(' ').toLowerCase();
  return hay.includes(texto.toLowerCase());
}

/** Prepara um predicado a partir da query (compila uma vez, aplica a N eventos). */
export function compileQuery(q: EventQuery): (ev: PeritoEvent) => boolean {
  const deMs = q.de ? tsMs(q.de) : NaN;
  const ateMs = q.ate ? tsMs(q.ate) : NaN;
  // Comparação por string ISO é equivalente se ambos estiverem normalizados com ms e Z.
  const de = Number.isNaN(deMs) ? null : isoMs(deMs);
  const ate = Number.isNaN(ateMs) ? null : isoMs(ateMs);
  const ex = q.excluir ?? {};
  return (ev) => {
    if (q.host && !hostMatch(ev, q.host)) return false;
    if (q.user && !userMatch(ev, q.user)) return false;
    if (q.ip && !ipMatch(ev, q.ip)) return false;
    if (q.hash && q.hash.toLowerCase() !== (ev.sha256 ?? '').toLowerCase()) return false;
    if (q.dominio && !(ev.domain ?? '').toLowerCase().includes(q.dominio.toLowerCase())) return false;
    if (de && ev.ts_utc < de) return false;
    if (ate && ev.ts_utc > ate) return false;
    if (q.fonte && !listMatch(ev.source, q.fonte)) return false;
    if (q.tipo && !listMatch(ev.event_type, q.tipo)) return false;
    if (q.texto && !textoMatch(ev, q.texto)) return false;
    if (ex.host?.some((v) => hostMatch(ev, v))) return false;
    if (ex.user?.some((v) => userMatch(ev, v))) return false;
    if (ex.ip?.some((v) => ipMatch(ev, v))) return false;
    if (ex.fonte?.some((v) => listMatch(ev.source, v))) return false;
    if (ex.tipo?.some((v) => listMatch(ev.event_type, v))) return false;
    return true;
  };
}

// ---------- exibição ----------
/** Texto da faixa FILTRO: "host=ws-fin-023 ∧ fonte≠splunk ∧ janela 13:00..13:30". */
export function describeClause(c: Clause): string {
  if (c.field === 'tatica') return `tatica${c.neg ? '≠' : '='}${rotuloTatica(c.value)}`;
  const v = /\s/.test(c.value) ? `"${c.value}"` : c.value;
  return `${c.field}${c.neg ? '≠' : '='}${v}`;
}

export function describeWindow(f: FilterState): string | null {
  if (!f.de && !f.ate) return null;
  const fmt = (s: string | null) => (s ? s.slice(11, 19) : '…');
  const sameDay = f.de && f.ate && f.de.slice(0, 10) === f.ate.slice(0, 10);
  if (!sameDay && (f.de || f.ate)) {
    return `janela ${f.de ? f.de.slice(0, 19).replace('T', ' ') : '…'}..${f.ate ? f.ate.slice(0, 19).replace('T', ' ') : '…'}`;
  }
  return `janela ${fmt(f.de)}..${fmt(f.ate)}`;
}

export function describeFilter(f: FilterState): string {
  const parts = f.clauses.map(describeClause);
  const w = describeWindow(f);
  if (w) parts.push(w);
  return parts.join(' ∧ ');
}

// ---------- filtros locais (cliente) ----------
export function hasLocalClauses(f: FilterState): boolean {
  return f.clauses.some((c) => c.field === 'tatica');
}

/** Aplica as cláusulas locais (tatica) sobre os eventos já filtrados pelo backend. */
export function applyLocal(events: PeritoEvent[], f: FilterState, tacticOf: TacticOf): PeritoEvent[] {
  const pos = f.clauses.filter((c) => c.field === 'tatica' && !c.neg).map((c) => c.value);
  const neg = f.clauses.filter((c) => c.field === 'tatica' && c.neg).map((c) => c.value);
  if (!pos.length && !neg.length) return events;
  return events.filter((ev) => {
    const tacs = ev.mitre.map(tacticOf);
    if (pos.length && !tacs.some((t) => t && pos.includes(t))) return false;
    if (neg.length && tacs.some((t) => t && neg.includes(t))) return false;
    return true;
  });
}
