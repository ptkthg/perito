// Regras das colunas da timeline: valor exibido, valor copiado (y), pivô (p) e filtro (f/F).
import type { Histograma, PeritoEvent, Resumo } from '../../lib/types';
import type { FilterField, FilterState } from '../../lib/filters';
import { sourceCode, hhmm, tsMs } from '../../lib/format';
import { type Confirmadas, VAZIO_CONF, sugerida } from '../../lib/bancada';
import { type TacticOf, primaryTechnique, sortTechniques } from '../../lib/attack-pt';

export type ColKey = 'ts' | 'src' | 'tipo' | 'host' | 'user' | 'resumo' | 'attack' | 'flag';

/** label = modo ANALISTA (brief); guiado = cabeçalho por extenso do modo GUIADO. */
export const COLS: { key: ColKey; label: string; guiado: string }[] = [
  { key: 'ts', label: 'TS(UTC)', guiado: 'HORÁRIO (UTC)' },
  { key: 'src', label: 'SRC', guiado: 'FONTE' },
  { key: 'tipo', label: 'TIPO', guiado: 'TIPO' },
  { key: 'host', label: 'HOST', guiado: 'MÁQUINA' },
  { key: 'user', label: 'USER', guiado: 'CONTA' },
  { key: 'resumo', label: 'RESUMO', guiado: 'O QUE ACONTECEU' },
  { key: 'attack', label: 'ATT&CK', guiado: 'TÉCNICA' },
  { key: 'flag', label: 'FLAG', guiado: 'SINAIS' },
];

const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** HOST exibido: host; senão ~src_host (deduzido); senão — (só observador ou vazio). */
export function hostDisplay(ev: PeritoEvent): { text: string; deduced: boolean; empty: boolean } {
  if (ev.host) return { text: ev.host, deduced: false, empty: false };
  const sh = s(ev.extra.src_host);
  if (sh) return { text: `~${sh}`, deduced: true, empty: false };
  return { text: '—', deduced: false, empty: true };
}

/**
 * Técnica principal: ordenada pela posição da tática na kill chain (Evasão de defesa por
 * último), depois subtécnica, depois lexical. Ex.: powershell → T1059.001, não T1027.
 */
export function attackCell(ev: PeritoEvent, tacticOf: TacticOf, conf: Confirmadas = VAZIO_CONF): { text: string; more: number; heur: boolean } | null {
  const main = primaryTechnique(ev, tacticOf);
  if (!main) return null;
  // "?" só enquanto a técnica for sugestão da heurística não confirmada em achados.md
  return { text: main, heur: sugerida(ev, main, conf), more: ev.mitre.length - 1 };
}

/** SINAIS do modo GUIADO em palavras curtas. */
export function signalWords(ev: PeritoEvent, marked: boolean): string[] {
  const f = eventFlags(ev);
  const out: string[] = [];
  if (marked) out.push('marcado');
  if (f.corrob > 0) out.push(`${f.corrob + 1} fontes`);
  if (f.volume) out.push('grande envio');
  if (!ev.host && s(ev.extra.src_host)) out.push('máquina deduzida');
  if (f.observer) out.push(`visto por ${s(ev.extra.observer)}`);
  return out;
}

export interface Flags {
  corrob: number;
  volume: boolean;
  observer: boolean;
}

export function eventFlags(ev: PeritoEvent): Flags {
  const obs = s(ev.extra.observer);
  return {
    corrob: Array.isArray(ev.extra.corroborado_por) ? ev.extra.corroborado_por.length : 0,
    volume: ev.extra.volume_alto === true,
    observer: !!obs && obs !== ev.host,
  };
}

/** Texto completo copiado por `y` na coluna. */
export function cellCopyValue(ev: PeritoEvent, col: ColKey, tacticOf?: TacticOf): string | null {
  switch (col) {
    case 'ts':
      return ev.ts_utc;
    case 'src':
      return ev.source;
    case 'tipo':
      return ev.event_type;
    case 'host':
      return ev.host ?? s(ev.extra.src_host) ?? s(ev.extra.observer);
    case 'user':
      return ev.user;
    case 'resumo':
      return ev.description;
    case 'attack':
      return ev.mitre.length ? (tacticOf ? sortTechniques(ev.mitre, tacticOf) : ev.mitre).join(', ') : null;
    case 'flag': {
      const c = ev.extra.corroborado_por;
      return Array.isArray(c) && c.length ? c.join('; ') : null;
    }
  }
}

export type PivotTarget = { field: FilterField; value: string; via: string } | { error: string };

/** Valor de pivô/filtro da célula. RESUMO escolhe o indicador mais útil do evento. */
export function cellTarget(ev: PeritoEvent, col: ColKey, purpose: 'pivo' | 'filtro'): PivotTarget {
  switch (col) {
    case 'host': {
      if (ev.host) return { field: 'host', value: ev.host, via: 'HOST' };
      const sh = s(ev.extra.src_host);
      if (sh) return { field: 'host', value: sh, via: 'HOST ~deduzido' };
      const obs = s(ev.extra.observer);
      if (obs) return { field: 'host', value: obs, via: 'OBSERVADOR' };
      return { error: 'célula HOST vazia' };
    }
    case 'user':
      return ev.user ? { field: 'user', value: ev.user, via: 'USER' } : { error: 'célula USER vazia' };
    case 'resumo': {
      if (ev.event_type === 'dns' && ev.domain) return { field: 'dominio', value: ev.domain, via: 'RESUMO → DOMÍNIO' };
      if (ev.dst_ip) return { field: 'ip', value: ev.dst_ip, via: 'RESUMO → DST IP' };
      if (ev.domain) return { field: 'dominio', value: ev.domain, via: 'RESUMO → DOMÍNIO' };
      if (ev.sha256) return { field: 'hash', value: ev.sha256, via: 'RESUMO → SHA256' };
      if (ev.src_ip) return { field: 'ip', value: ev.src_ip, via: 'RESUMO → SRC IP' };
      return { error: 'RESUMO sem ip/domínio/hash para pivô' };
    }
    case 'src':
      if (purpose === 'filtro') return { field: 'fonte', value: ev.source, via: 'SRC' };
      return { error: 'coluna SRC sem pivô — use f/F para filtrar a fonte' };
    case 'tipo':
      if (purpose === 'filtro') return { field: 'tipo', value: ev.event_type, via: 'TIPO' };
      return { error: 'coluna TIPO sem pivô — use f/F para filtrar o tipo' };
    case 'ts':
      return { error: 'coluna TS sem pivô — use janela ou arraste no sismógrafo' };
    case 'attack':
      return { error: 'pivô por técnica: entrega I3 (F3 ATT&CK)' };
    case 'flag':
      return { error: 'coluna FLAG sem pivô — os raw_ref de ≡ estão no detalhe' };
  }
}

/** Texto pesquisável da linha para `/` (sem caixa). */
export function searchHaystack(ev: PeritoEvent): string {
  return [ev.description, ev.cmdline, ev.host, s(ev.extra.src_host), ev.user, ev.src_ip, ev.dst_ip, ev.domain, ev.file_path, ev.process, ev.sha256, ev.raw_ref]
    .filter(Boolean)
    .join('\u0001')
    .toLowerCase();
}

/**
 * Estado vazio cruzado com a cobertura: "não houve evento" ≠ "não havia coleta".
 * Para cada fonte considerada, lista os trechos da janela sem dados.
 */
export function coverageNotes(f: FilterState, hist: Histograma | null, resumo: Resumo | null): string[] {
  const cob = hist?.cobertura ?? (resumo ? Object.fromEntries(Object.entries(resumo.por_fonte).map(([k, v]) => [k, { primeiro: v.primeiro, ultimo: v.ultimo }])) : {});
  const all = Object.keys(cob);
  const pos = f.clauses.filter((c) => c.field === 'fonte' && !c.neg).map((c) => c.value);
  const neg = new Set(f.clauses.filter((c) => c.field === 'fonte' && c.neg).map((c) => c.value));
  const considered = (pos.length ? pos : all).filter((x) => !neg.has(x));
  const notes: string[] = [];
  const caseStart = resumo?.janela.primeiro ?? hist?.inicio ?? null;
  const caseEnd = resumo?.janela.ultimo ?? hist?.fim ?? null;
  const hasWindow = !!(f.de || f.ate);
  for (const src of considered) {
    const c = cob[src];
    const code = sourceCode(src);
    if (!c) {
      notes.push(`⊘ ${code} sem dados no caso`);
      continue;
    }
    if (!hasWindow) continue;
    const de = f.de ?? caseStart;
    const ate = f.ate ?? caseEnd;
    if (!de || !ate) continue;
    const a = tsMs(de);
    const b = tsMs(ate);
    const p = tsMs(c.primeiro);
    const u = tsMs(c.ultimo);
    if (b < p || a > u) {
      notes.push(`⊘ ${code} sem dados ${hhmm(a)}–${hhmm(b)}`);
      continue;
    }
    if (a < p) notes.push(`⊘ ${code} sem dados ${hhmm(a)}–${hhmm(p)}`);
    if (b > u) notes.push(`⊘ ${code} sem dados ${hhmm(u)}–${hhmm(b)}`);
  }
  if (notes.length === 0 && considered.length) {
    const codes = considered.map(sourceCode).join(' ');
    notes.push(hasWindow ? `cobertura de ${codes} inclui a janela — ausência de evento, não de coleta` : `fontes consideradas: ${codes} (com coleta no caso)`);
  }
  return notes;
}

/** Fonte de uma marca do histograma: pelo evento (raw_ref) ou pelo prefixo do arquivo. */
export function markSource(rawRef: string, byRef: Map<string, PeritoEvent>, sources: string[]): string | null {
  const ev = byRef.get(rawRef);
  if (ev) return ev.source;
  const file = rawRef.toLowerCase();
  let best: string | null = null;
  for (const src of sources) {
    if (file.startsWith(src.toLowerCase()) && (!best || src.length > best.length)) best = src;
  }
  return best;
}
