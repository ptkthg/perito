// F5 COBERTURA (brief §4): matriz fonte × tempo (a partir dos baldes do histograma),
// matriz fonte × host (quem tem EDR/Sysmon/Security/rede/nuvem) e lacunas → [l] registrar LIM.
import type { Histograma, PeritoEvent } from './types';
import { hhmm, sourceCode, tsMs } from './format';
import type { LimPrefill } from '../views/bench/LimForm';

export interface CelulaTempo {
  n: number;
  /** fora da janela de cobertura da fonte: "não havia coleta" */
  lacuna: boolean;
}
export interface MatrizTempo {
  cols: { ini: number; fim: number }[];
  linhas: { fonte: string; celulas: CelulaTempo[]; total: number }[];
}

/** Reagrupa os baldes do histograma em `nCols` colunas e marca lacunas pela cobertura da fonte. */
export function matrizTempo(h: Histograma, fontes: string[], nCols = 24): MatrizTempo {
  const ini = tsMs(h.inicio);
  const bms = h.bucket_s * 1000;
  const por = Math.max(1, Math.ceil(h.n_baldes / nCols));
  const n = Math.ceil(h.n_baldes / por);
  const cols = Array.from({ length: n }, (_, i) => ({ ini: ini + i * por * bms, fim: ini + Math.min(h.n_baldes, (i + 1) * por) * bms }));
  const linhas = fontes.map((f) => {
    const b = h.fontes[f] ?? [];
    const cob = h.cobertura[f];
    const p = cob ? tsMs(cob.primeiro) : Infinity;
    const u = cob ? tsMs(cob.ultimo) : -Infinity;
    const celulas = cols.map((c, i) => {
      let soma = 0;
      for (let k = i * por; k < Math.min(h.n_baldes, (i + 1) * por); k++) soma += b[k] ?? 0;
      return { n: soma, lacuna: c.fim <= p || c.ini > u };
    });
    return { fonte: f, celulas, total: celulas.reduce((s, c) => s + c.n, 0) };
  });
  return { cols, linhas };
}

export interface Lacuna {
  id: string;
  tipo: 'fonte' | 'edr';
  fonte?: string;
  host?: string;
  de?: string;
  ate?: string;
  texto: string;
}

/**
 * Lacunas: início/fim do caso sem dados de uma fonte (> 2 baldes) e hosts sem EDR.
 * "Não houve evento" ≠ "não havia coleta": só a ausência de coleta vira lacuna.
 */
export function lacunas(h: Histograma, semEdr: string[]): Lacuna[] {
  const out: Lacuna[] = [];
  const ini = tsMs(h.inicio);
  const fim = tsMs(h.fim);
  const min = 2 * h.bucket_s * 1000;
  for (const [f, c] of Object.entries(h.cobertura).sort()) {
    const p = tsMs(c.primeiro);
    const u = tsMs(c.ultimo);
    const code = sourceCode(f);
    if (p - ini > min) out.push({ id: `${f}:antes`, tipo: 'fonte', fonte: f, de: h.inicio, ate: c.primeiro, texto: `${code} sem dados ${hhmm(ini)}–${hhmm(p)}` });
    if (fim - u > min) out.push({ id: `${f}:depois`, tipo: 'fonte', fonte: f, de: c.ultimo, ate: h.fim, texto: `${code} sem dados ${hhmm(u)}–${hhmm(fim)}` });
  }
  for (const host of semEdr) out.push({ id: `edr:${host}`, tipo: 'edr', host, texto: `${host} sem EDR` });
  return out;
}

/** Texto pré-preenchido do [l] registrar LIM para uma lacuna. */
export function prefillLacuna(l: Lacuna): LimPrefill {
  if (l.tipo === 'edr') {
    return {
      limitacao: `${l.host} não tem EDR: não há telemetria de processos, arquivos e memória do host.`,
      impacto: `Execução, persistência e acesso a credenciais em ${l.host} podem não ter sido registrados; conclusões dependem de logs de Windows/rede.`,
      mitigacao: `Coletar triagem forense de ${l.host} (memória, Prefetch, Amcache, $MFT) ou instalar EDR e repetir as consultas.`,
    };
  }
  const de = l.de ? `${l.de.slice(0, 16).replace('T', ' ')}Z` : '?';
  const ate = l.ate ? `${l.ate.slice(0, 16).replace('T', ' ')}Z` : '?';
  return {
    limitacao: `${l.fonte} sem dados entre ${de} e ${ate} (fora da janela exportada/coletada).`,
    impacto: `Eventos de ${l.fonte} nesse intervalo não aparecem na timeline; ausência de evento não significa que não houve atividade.`,
    mitigacao: `Solicitar nova exportação de ${l.fonte} cobrindo ${de}–${ate} e reingerir.`,
  };
}

/** Prefill para arquivo ingerido sem parser (fonte não reconhecida). */
export function prefillSemParser(arquivo: string): LimPrefill {
  return {
    limitacao: `Arquivo ${arquivo} registrado na custódia, mas sem parser: o conteúdo não entrou na timeline.`,
    impacto: `Eventos desse arquivo não são correlacionados nem aparecem nas buscas e no mapa.`,
    mitigacao: `Identificar o formato de ${arquivo}, converter para uma fonte suportada ou analisar manualmente e registrar achados.`,
  };
}

// ---------------------------------------------------------------- fonte × host
export const CATEGORIAS = [
  { k: 'edr', rot: 'EDR', ajuda: 'Defender / EDR: processos, arquivos, memória' },
  { k: 'sysmon', rot: 'SYSMON', ajuda: 'Sysmon via SIEM: processos e rede do host' },
  { k: 'security', rot: 'SECURITY', ajuda: 'log de segurança do Windows (Sentinel/Wazuh)' },
  { k: 'rede', rot: 'REDE', ajuda: 'firewall/DNS vendo o host como origem/destino' },
  { k: 'nuvem', rot: 'NUVEM', ajuda: 'logins e auditoria do Entra a partir do host' },
] as const;
export type Categoria = (typeof CATEGORIAS)[number]['k'];

const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function categoriaDe(ev: PeritoEvent): Categoria | null {
  const st = String(ev.extra.sourcetype ?? '');
  if (ev.source === 'defender' || (ev.source === 'elastic' && ev.event_type === 'process')) return 'edr';
  if (/sysmon/i.test(st) || (ev.source === 'splunk' && ev.event_type === 'process')) return 'sysmon';
  if (ev.source === 'sentinel' || ev.source === 'wazuh') return 'security';
  if (ev.source === 'entra_signin' || ev.source === 'entra_audit') return 'nuvem';
  if (s(ev.extra.observer)) return 'rede';
  return null;
}

/** Hosts × categorias de telemetria: contagem de eventos por categoria. */
export function matrizHost(eventos: PeritoEvent[]): { host: string; c: Record<Categoria, number> }[] {
  const m = new Map<string, Record<Categoria, number>>();
  const zero = (): Record<Categoria, number> => ({ edr: 0, sysmon: 0, security: 0, rede: 0, nuvem: 0 });
  for (const ev of eventos) {
    const cat = categoriaDe(ev);
    if (!cat) continue;
    const hosts = new Set([ev.host, cat === 'rede' ? s(ev.extra.src_host) : null, cat === 'rede' ? s(ev.extra.dst_host) : null].filter((x): x is string => !!x));
    for (const h of hosts) {
      const r = m.get(h) ?? m.set(h, zero()).get(h)!;
      r[cat]++;
    }
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([host, c]) => ({ host, c }));
}
