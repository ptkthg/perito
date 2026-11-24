// Formatação para exibição. Regra do brief: dado de evidência NUNCA muda de caixa
// nem de conteúdo; aqui só se trunca (com "…") ou se derivam rótulos de UI.

import type { PeritoEvent } from './types';

/** Código de 3 letras e cor (custom property) por fonte. */
export const SOURCES: Record<string, { code: string; cssVar: string }> = {
  defender: { code: 'DEF', cssVar: '--src-def' },
  sentinel: { code: 'SEN', cssVar: '--src-sen' },
  entra_signin: { code: 'ESI', cssVar: '--src-esi' },
  entra_audit: { code: 'EAU', cssVar: '--src-eau' },
  splunk: { code: 'SPL', cssVar: '--src-spl' },
  elastic: { code: 'ELA', cssVar: '--src-ela' },
  wazuh: { code: 'WAZ', cssVar: '--src-waz' },
};

/** Ordem fixa das linhas do sismógrafo (igual ao brief). */
export const SOURCE_ORDER = ['defender', 'sentinel', 'entra_signin', 'entra_audit', 'splunk', 'elastic', 'wazuh'];

export function sourceCode(source: string): string {
  return SOURCES[source]?.code ?? source.slice(0, 3).toUpperCase();
}

export function sourceColor(source: string): string {
  const s = SOURCES[source];
  return s ? `var(${s.cssVar})` : 'var(--text-2)';
}

/** Aceita nome da fonte ou código (DEF, def) e devolve o nome canônico. */
export function resolveSource(value: string): string {
  const v = value.trim().toLowerCase();
  for (const [name, s] of Object.entries(SOURCES)) {
    if (s.code.toLowerCase() === v) return name;
  }
  return v;
}

export const TYPE_CODES: Record<string, string> = {
  process: 'PROC',
  network: 'NET',
  dns: 'DNS',
  file: 'FILE',
  registry: 'REG',
  logon: 'LOGN',
  signin: 'SIGN',
  audit: 'AUD',
  email: 'MAIL',
  service: 'SVC',
  scheduled_task: 'TASK',
  alert: 'ALRT',
  other: 'OTHR',
};

export function typeCode(t: string): string {
  return TYPE_CODES[t] ?? t.slice(0, 4).toUpperCase();
}

/** Aceita nome do tipo ou código (PROC, task) e devolve o nome canônico. */
export function resolveType(value: string): string {
  const v = value.trim().toLowerCase();
  for (const [name, code] of Object.entries(TYPE_CODES)) {
    if (code.toLowerCase() === v) return name;
  }
  return v;
}

const DIAS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

/** "2026-11-10T13:15:30.660Z" → { hms: "13:15:30", ms: ".660" } sem conversão de fuso (já é UTC). */
export function splitTs(ts: string): { hms: string; ms: string } {
  const t = ts.indexOf('T');
  if (t < 0) return { hms: ts, ms: '' };
  const time = ts.slice(t + 1).replace(/Z$/, '');
  const dot = time.indexOf('.');
  if (dot < 0) return { hms: time.slice(0, 8), ms: '' };
  return { hms: time.slice(0, dot), ms: time.slice(dot, dot + 4) };
}

export function dayOf(ts: string): string {
  return ts.slice(0, 10);
}

/** "2026-11-10" → "── 2026-11-10 TER ──" */
export function daySeparator(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = Number.isNaN(d.getTime()) ? '' : ` ${DIAS[d.getUTCDay()]}`;
  return `── ${day}${dow} ──`;
}

/** HH:MM a partir de ms epoch (UTC). */
export function hhmm(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}

export function hhmmss(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

/** Trunca no meio preservando início e fim: "rundll32.exe C:\Win…dmp full". */
export function truncateMiddle(s: string, max: number): string {
  if (max <= 0) return '';
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  if (max <= 1) return '…';
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return chars.slice(0, head).join('') + '…' + (tail > 0 ? chars.slice(chars.length - tail).join('') : '');
}

/** Hash abreviado: a3f9c2e1…7d04 (o valor completo segue disponível via `y`). */
export function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;
}

/** Rótulo curto da fase (âmbar invertido na barra). */
export function shortPhase(fase: string): string {
  const f = fase
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (/prepar/.test(f)) return 'PREP';
  if (/detect|identif|analis/.test(f)) return 'DETECT';
  if (/cont[ae]|contain/.test(f)) return 'CONTER';
  if (/errad|eradic/.test(f)) return 'ERRAD';
  if (/recup|recover/.test(f)) return 'RECUP';
  if (/lic|lesson|pos-|pos /.test(f)) return 'LIÇÕES';
  const first = fase.split(/[\s/]+/)[0] ?? fase;
  return first.slice(0, 8).toUpperCase() || '—';
}

export const isHeuristic = (ev: PeritoEvent, tech: string): boolean =>
  (ev.extra.mitre_heuristica ?? []).includes(tech);

/** Converte ISO UTC em ms; NaN se inválido. */
export function tsMs(ts: string): number {
  return Date.parse(ts);
}

/** ms → ISO UTC com milissegundos e "Z" (formato da timeline). */
export function isoMs(ms: number): string {
  return new Date(ms).toISOString();
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Bytes legíveis em base 1024 com vírgula decimal: 2576980378 → "2,4 GB". */
export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const s = v >= 100 ? v.toFixed(0) : v.toFixed(1);
  return `${s.replace('.', ',').replace(/,0$/, '')} ${units[i]}`;
}
