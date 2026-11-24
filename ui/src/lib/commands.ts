// Linha de comando: parser dos comandos e autocompletar a partir do índice de entidades.
//
// Comandos (I1):
//   filtro campo=v [campo!=v ...]     (src= é alias de fonte; type= de tipo)
//   pivo --ip|--host|--user|--hash|--dominio X   (substitui os filtros)
//   janela HH:MM..HH:MM | ISO..ISO | (vazio = remove a janela)
//   ir HH:MM[:SS] | ISO
//   limpar · u · ajuda

import type { Entidades, EntityKind, Resumo } from './types';
import { type Clause, type FilterField, FILTER_FIELDS, resolveField } from './filters';
import { SOURCES, TYPE_CODES, hhmm, tsMs } from './format';
import { KILL_CHAIN } from './attack-pt';

export type Command =
  | { kind: 'filtro'; clauses: Clause[] }
  | { kind: 'pivo'; field: FilterField; value: string }
  | { kind: 'janela'; de: string | null; ate: string | null }
  | { kind: 'ir'; ts: string }
  | { kind: 'limpar' }
  | { kind: 'desfazer' }
  | { kind: 'ajuda' }
  | { kind: 'mapa' }
  | { kind: 'agentes' };

export const COMMANDS: { name: string; args: string; help: string }[] = [
  { name: 'filtro', args: 'campo=v [campo!=v …]', help: 'adiciona filtros (host user ip fonte tipo texto hash dominio tatica)' },
  { name: 'pivo', args: '--ip|--host|--user|--hash|--dominio X', help: 'substitui os filtros pelo pivô' },
  { name: 'janela', args: 'HH:MM..HH:MM', help: 'restringe o tempo (vazio remove)' },
  { name: 'ir', args: 'HH:MM[:SS]', help: 'rola até o evento mais próximo' },
  { name: 'limpar', args: '', help: 'remove todos os filtros' },
  { name: 'u', args: '', help: 'desfaz o último filtro' },
  { name: 'ajuda', args: '', help: 'mapa de teclas e glifos' },
  { name: 'mapa', args: '', help: 'abre o MAPA DO ATAQUE (gm)' },
  { name: 'agentes', args: '', help: 'painel de agentes Claude/Codex (ga)' },
];

const PIVOT_FLAGS: Record<string, FilterField> = {
  '--ip': 'ip',
  '--host': 'host',
  '--user': 'user',
  '--hash': 'hash',
  '--dominio': 'dominio',
};

/** Divide respeitando aspas duplas. Retorna tokens e a posição inicial do último. */
export function tokenize(input: string): { tokens: string[]; lastStart: number } {
  const tokens: string[] = [];
  let cur = '';
  let inQ = false;
  let start = 0;
  let lastStart = input.length;
  let has = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === '"') {
      inQ = !inQ;
      if (!has) {
        start = i;
        has = true;
      }
      continue;
    }
    if (!inQ && /\s/.test(ch)) {
      if (has) tokens.push(cur);
      cur = '';
      has = false;
      continue;
    }
    if (!has) {
      start = i;
      has = true;
    }
    cur += ch;
  }
  if (has) {
    tokens.push(cur);
    lastStart = start;
  }
  return { tokens, lastStart };
}

// ---------- tempo ----------
const HMS = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/**
 * Converte "13:15", "13:15:30", "13:15:30.660" (na data base) ou ISO completo em ISO UTC.
 * Com `fim=true`, preenche até o fim da precisão informada (13:30 → 13:30:59.999), para
 * que a janela seja inclusiva no sentido em que o analista digitou.
 */
export function parseTimeSpec(s: string, baseDay: string, fim = false): string {
  const t = s.trim();
  const m = HMS.exec(t);
  if (m) {
    const [, hh, mm, ss, ms] = m;
    const h = Number(hh);
    const mi = Number(mm);
    if (h > 23 || mi > 59 || (ss && Number(ss) > 59)) throw new Error(`horário inválido: ${s}`);
    const sec = ss ?? (fim ? '59' : '00');
    const msec = ms ? ms.padEnd(3, '0') : fim ? '999' : '000';
    return `${baseDay}T${String(h).padStart(2, '0')}:${mm}:${sec}.${msec}Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(t)) {
    let iso = t.replace(' ', 'T');
    if (!/T/.test(iso)) iso += fim ? 'T23:59:59.999' : 'T00:00:00.000';
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) iso += 'Z';
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) throw new Error(`horário inválido: ${s}`);
    return new Date(ms).toISOString();
  }
  throw new Error(`horário inválido: ${s} (use HH:MM[:SS] ou ISO)`);
}

export interface ParseCtx {
  /** Data base (YYYY-MM-DD) para horários sem data: a do início da janela do caso. */
  baseDay: string;
}

export function parseCommand(input: string, ctx: ParseCtx): Command {
  const { tokens } = tokenize(input.trim());
  const [cmd, ...args] = tokens;
  if (!cmd) throw new Error('comando vazio');
  switch (cmd.toLowerCase()) {
    case 'filtro':
    case 'f': {
      if (args.length === 0) throw new Error('uso: filtro campo=v [campo!=v …]');
      const clauses = args.map((a) => {
        const m = /^([^=!≠]+)(!=|≠|=)(.*)$/.exec(a);
        if (!m) throw new Error(`argumento inválido: ${a} (use campo=v ou campo!=v)`);
        const field = resolveField(m[1]!);
        if (!field) throw new Error(`campo desconhecido: ${m[1]} (${FILTER_FIELDS.join(' ')})`);
        const value = m[3]!;
        if (!value) throw new Error(`valor vazio em ${a}`);
        return { field, neg: m[2] !== '=', value };
      });
      return { kind: 'filtro', clauses };
    }
    case 'pivo':
    case 'pivô': {
      const [flag, ...rest] = args;
      if (!flag) throw new Error('uso: pivo --ip|--host|--user|--hash|--dominio X');
      let field: FilterField | undefined;
      let value: string | undefined;
      const eq = /^(--\w+)=(.+)$/.exec(flag);
      if (eq) {
        field = PIVOT_FLAGS[eq[1]!.toLowerCase()];
        value = eq[2];
      } else {
        field = PIVOT_FLAGS[flag.toLowerCase()];
        value = rest.join(' ');
      }
      if (!field) throw new Error(`pivô desconhecido: ${flag} (--ip --host --user --hash --dominio)`);
      if (!value) throw new Error(`pivo ${flag}: falta o valor`);
      return { kind: 'pivo', field, value };
    }
    case 'janela': {
      const spec = args.join(' ').trim();
      if (!spec) return { kind: 'janela', de: null, ate: null };
      const parts = spec.includes('..') ? spec.split('..') : spec.split(/\s+|–|—/);
      if (parts.length !== 2) throw new Error('uso: janela HH:MM..HH:MM');
      const de = parts[0]!.trim() ? parseTimeSpec(parts[0]!, ctx.baseDay, false) : null;
      const ate = parts[1]!.trim() ? parseTimeSpec(parts[1]!, ctx.baseDay, true) : null;
      if (de && ate && de > ate) throw new Error(`janela invertida: ${de} > ${ate}`);
      return { kind: 'janela', de, ate };
    }
    case 'ir':
    case 't': {
      const spec = args.join(' ').trim();
      if (!spec) throw new Error('uso: ir HH:MM[:SS]');
      return { kind: 'ir', ts: parseTimeSpec(spec, ctx.baseDay, false) };
    }
    case 'limpar':
      return { kind: 'limpar' };
    case 'u':
    case 'desfazer':
      return { kind: 'desfazer' };
    case 'ajuda':
    case '?':
    case 'h':
      return { kind: 'ajuda' };
    case 'mapa':
      return { kind: 'mapa' };
    case 'agentes':
      return { kind: 'agentes' };
    default:
      throw new Error(`comando desconhecido: ${cmd} (digite ajuda)`);
  }
}

// ---------- autocompletar ----------
export interface Suggestion {
  /** Texto que substitui o token atual. */
  text: string;
  /** Rótulo exibido (normalmente igual a text). */
  label: string;
  count?: number;
}

export interface SuggestCtx {
  entidades: Entidades | null;
  resumo: Resumo | null;
}

const FIELD_TO_ENTITY: Partial<Record<FilterField, EntityKind>> = {
  host: 'host',
  user: 'user',
  ip: 'ip',
  hash: 'sha256',
  dominio: 'domain',
};

function valuePool(field: FilterField, ctx: SuggestCtx): { v: string; n: number }[] {
  if (field === 'tecnica') {
    return (ctx.resumo?.tecnicas ?? []).map((t) => ({ v: t.id, n: t.eventos }));
  }
  if (field === 'tatica') {
    const byTac = new Map<string, number>();
    for (const t of ctx.resumo?.tecnicas ?? []) byTac.set(t.tatica, (byTac.get(t.tatica) ?? 0) + t.eventos);
    return KILL_CHAIN.map((k) => ({ v: k.rotulo.replace(/ /g, '-'), n: byTac.get(k.tatica) ?? 0 }));
  }
  if (field === 'fonte') {
    const pf = ctx.resumo?.por_fonte ?? {};
    const names = new Set([...Object.keys(SOURCES), ...Object.keys(pf)]);
    return [...names].map((v) => ({ v, n: pf[v]?.eventos ?? 0 }));
  }
  if (field === 'tipo') {
    const pt = ctx.resumo?.por_tipo ?? {};
    const names = new Set([...Object.keys(pt), ...Object.keys(TYPE_CODES)]);
    return [...names].map((v) => ({ v, n: pt[v] ?? 0 }));
  }
  const kind = FIELD_TO_ENTITY[field];
  if (!kind) return [];
  const idx = ctx.entidades?.[kind] ?? {};
  return Object.entries(idx).map(([v, info]) => ({ v, n: info.eventos }));
}

function rank(pool: { v: string; n: number }[], typed: string): { v: string; n: number }[] {
  const t = typed.toLowerCase();
  const pre: { v: string; n: number }[] = [];
  const mid: { v: string; n: number }[] = [];
  for (const it of pool) {
    const l = it.v.toLowerCase();
    if (l.startsWith(t)) pre.push(it);
    else if (t && l.includes(t)) mid.push(it);
  }
  const byCount = (a: { v: string; n: number }, b: { v: string; n: number }) => b.n - a.n || a.v.localeCompare(b.v);
  return [...pre.sort(byCount), ...mid.sort(byCount)];
}

export function suggest(input: string, ctx: SuggestCtx): { items: Suggestion[]; tokenStart: number; token: string } {
  const { tokens, lastStart } = tokenize(input);
  const endsWithSpace = input.length > 0 && /\s$/.test(input);
  const tokenStart = endsWithSpace ? input.length : lastStart;
  const token = endsWithSpace ? '' : (tokens[tokens.length - 1] ?? '');
  const pos = endsWithSpace ? tokens.length : Math.max(0, tokens.length - 1);
  const cmd = (tokens[0] ?? '').toLowerCase();
  const out: Suggestion[] = [];

  if (pos === 0) {
    for (const c of COMMANDS) {
      if (c.name.startsWith(token.toLowerCase())) out.push({ text: c.name, label: c.name });
    }
    return { items: out.slice(0, 8), tokenStart, token };
  }

  if (cmd === 'filtro' || cmd === 'f') {
    const m = /^([^=!≠]*)(!=|≠|=)(.*)$/.exec(token);
    if (!m) {
      for (const f of [...FILTER_FIELDS, 'src', 'type']) {
        if (f.startsWith(token.toLowerCase())) out.push({ text: `${f}=`, label: `${f}=` });
      }
      return { items: out.slice(0, 8), tokenStart, token };
    }
    const field = resolveField(m[1]!);
    if (!field) return { items: [], tokenStart, token };
    for (const it of rank(valuePool(field, ctx), m[3]!).slice(0, 8)) {
      const t = `${m[1]}${m[2]}${it.v}`;
      out.push({ text: t, label: t, count: it.n });
    }
    return { items: out, tokenStart, token };
  }

  if (cmd === 'pivo' || cmd === 'pivô') {
    if (pos === 1) {
      for (const f of Object.keys(PIVOT_FLAGS)) {
        if (f.startsWith(token.toLowerCase())) out.push({ text: f, label: f });
      }
      return { items: out, tokenStart, token };
    }
    if (pos === 2) {
      const field = PIVOT_FLAGS[(tokens[1] ?? '').toLowerCase()];
      if (!field) return { items: [], tokenStart, token };
      for (const it of rank(valuePool(field, ctx), token).slice(0, 8)) {
        out.push({ text: it.v, label: it.v, count: it.n });
      }
    }
    return { items: out, tokenStart, token };
  }

  if (cmd === 'janela' && pos === 1 && !token) {
    const j = ctx.resumo?.janela;
    if (j?.primeiro && j.ultimo) {
      const t = `${hhmm(tsMs(j.primeiro))}..${hhmm(tsMs(j.ultimo))}`;
      out.push({ text: t, label: `${t} (caso inteiro)` });
    }
  }
  return { items: out, tokenStart, token };
}
