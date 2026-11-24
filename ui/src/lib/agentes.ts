// PAINEL AGENTES (brief §11, spec 07): tipos, autorização de envio por sessão e
// análise do diff do rascunho (arquivos, +/−, tags ■ ◇ ⊘ e afirmações sem tag).

export type AgenteId = 'claude' | 'codex';
export type JobStatus = 'rodando' | 'concluido' | 'erro' | 'cancelado' | 'tempo_esgotado' | 'violacao';

export interface AcaoDisp {
  acao: string;
  descricao: string;
  arquivos: string[];
  agentes: AgenteId[];
  parametros?: string[];
}

export interface Disponiveis {
  claude: boolean;
  codex: boolean;
  acoes: AcaoDisp[];
}

export interface JobEstado {
  job: string;
  caso: string;
  acao: string;
  agente: AgenteId;
  status: JobStatus;
  inicio: string;
  fim: string | null;
  decorrido_s: number;
  linhas: string[];
  proxima: number;
  arquivos_alterados: string[];
  diff: string;
  mensagem: string;
  aplicado?: boolean;
  arquivos_aplicados?: string[];
  descartado?: boolean;
}

export const AGENTES: { id: AgenteId; nome: string; provedor: string }[] = [
  { id: 'claude', nome: 'CLAUDE', provedor: 'Anthropic' },
  { id: 'codex', nome: 'CODEX', provedor: 'OpenAI' },
];

/** Ordem e teclas 1–6 do brief §11. */
export const ACOES_UI: { acao: string; tecla: string; rotulo: string }[] = [
  { acao: 'resumo', tecla: '1', rotulo: 'Resumo' },
  { acao: 'relatorio-executivo', tecla: '2', rotulo: 'Relatório executivo' },
  { acao: 'relatorio-tecnico', tecla: '3', rotulo: 'Relatório técnico' },
  { acao: 'nota-dpo', tecla: '4', rotulo: 'Nota DPO/Jurídico' },
  { acao: 'revisao-cruzada', tecla: '5', rotulo: 'Revisão cruzada' },
  { acao: 'investigar-fase', tecla: '6', rotulo: 'Investigar fase' },
];

export const FASES_PT: Record<string, string> = {
  'acesso-inicial': 'acesso inicial',
  execucao: 'execução',
  persistencia: 'persistência',
  credenciais: 'credenciais',
  'movimentacao-lateral': 'movimentação lateral',
  exfiltracao: 'exfiltração',
  identidade: 'identidade (nuvem)',
};

export const STATUS_PT: Record<JobStatus, { rotulo: string; guiado: string }> = {
  rodando: { rotulo: 'RODANDO', guiado: 'o agente está trabalhando numa cópia do caso' },
  concluido: { rotulo: 'CONCLUÍDO', guiado: 'o agente terminou; revise as mudanças antes de aplicar' },
  erro: { rotulo: 'ERRO', guiado: 'o agente parou com erro (falha do provedor, da rede ou do programa); nada foi gravado no caso' },
  cancelado: { rotulo: 'CANCELADO', guiado: 'você cancelou a tarefa; o rascunho foi apagado e nada foi gravado no caso' },
  tempo_esgotado: { rotulo: 'TEMPO ESGOTADO', guiado: 'o agente passou do tempo limite e foi interrompido; nada foi gravado no caso' },
  violacao: {
    rotulo: 'VIOLAÇÃO',
    guiado: 'a verificação detectou mudança em evidências ou na custódia durante a tarefa; o resultado foi descartado — avise o responsável pelo caso',
  },
};

/** Instrução extra: até 500, sem quebras nem controles (o backend recusa caracteres de controle). */
export function limpaInstrucao(t: string): string {
  // eslint-disable-next-line no-control-regex
  return t.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 500);
}

// ---------------------------------------------------------------- autorização por sessão
const kAut = (caso: string, prov: AgenteId) => `perito.aviso-envio.${caso}.${prov}`;
export function autorizado(caso: string, provs: AgenteId[], store: Pick<Storage, 'getItem'> = sessionStorage): boolean {
  return provs.length > 0 && provs.every((p) => store.getItem(kAut(caso, p)) === '1');
}
export function autorizar(caso: string, provs: AgenteId[], v: boolean, store: Pick<Storage, 'setItem' | 'removeItem'> = sessionStorage): void {
  for (const p of provs) {
    if (v) store.setItem(kAut(caso, p), '1');
    else store.removeItem(kAut(caso, p));
  }
}

// ---------------------------------------------------------------- diff do rascunho
export interface ArquivoDiff {
  arquivo: string;
  mais: number;
  menos: number;
  evid: number;
  hip: number;
  lim: number;
  /** Afirmações adicionadas sem nenhuma tag (heurística, ver contaSemTag). */
  semTag: number;
  linhas: string[];
}

/** Divide o diff unificado do backend (--- caso/X / +++ rascunho/X) por arquivo. */
export function analisaDiff(diff: string): ArquivoDiff[] {
  const out: ArquivoDiff[] = [];
  let cur: ArquivoDiff | null = null;
  const linhas = diff.split(/\r?\n/);
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i]!;
    if (l.startsWith('--- ') && linhas[i + 1]?.startsWith('+++ ')) {
      const alvo = linhas[i + 1]!.slice(4).replace(/^(rascunho|caso)\//, '').trim();
      cur = { arquivo: alvo, mais: 0, menos: 0, evid: 0, hip: 0, lim: 0, semTag: 0, linhas: [l, linhas[i + 1]!] };
      out.push(cur);
      i++;
      continue;
    }
    if (!cur) continue;
    cur.linhas.push(l);
    if (l.startsWith('+')) {
      cur.mais++;
      const t = l.slice(1);
      cur.evid += (t.match(/\[EVID[EÊ]NCIA\]/gi) ?? []).length;
      cur.hip += (t.match(/\[HIP[OÓ]TESE\]/gi) ?? []).length;
      cur.lim += (t.match(/\[LIMITA[CÇ][AÃ]O\]/gi) ?? []).length;
      cur.semTag += contaSemTag(t);
    } else if (l.startsWith('-')) cur.menos++;
  }
  // remove linha vazia final que o split produz
  for (const a of out) while (a.linhas.length && a.linhas.at(-1) === '') a.linhas.pop();
  return out;
}

const TAG = /\[(EVID[EÊ]NCIA|HIP[OÓ]TESE|LIMITA[CÇ][AÃ]O)\]/i;

/**
 * Heurística de "afirmação sem tag" numa linha adicionada (documentada no relatório):
 *  - ignora títulos (#), tabelas (|…|), separadores, blocos de código, linhas vazias,
 *    rótulos "Campo:" curtos e linhas com menos de 6 palavras;
 *  - divide o resto em frases (. ! ? seguidos de espaço/fim) e conta as frases com
 *    6+ palavras que não contêm [EVIDÊNCIA], [HIPÓTESE] nem [LIMITAÇÃO].
 * A regra do projeto é que toda afirmação de fato/hipótese/limitação leve tag.
 */
export function contaSemTag(linha: string): number {
  const t = linha.replace(/^\s*([-*+]|\d+\.)\s+/, '').trim();
  if (!t || /^#{1,6}\s/.test(t) || /^\|.*\|$/.test(t) || /^[-=|:\s]+$/.test(t) || t.startsWith('```') || t.startsWith('>')) return 0;
  if (t.split(/\s+/).length < 6) return 0;
  const frases = t.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9"“(])/u);
  let n = 0;
  for (const f of frases) {
    if (f.trim().split(/\s+/).length < 6) continue;
    if (!TAG.test(f)) n++;
  }
  return n;
}

/** Tamanho legível em base 1024. */
export function kb(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** "+00:31.8" a partir de segundos. */
export function relTempo(s: number): string {
  const m = Math.floor(s / 60);
  return `+${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

export function cronometro(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
