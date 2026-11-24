// ATT&CK em linguagem simples para o modo GUIADO e para a Visão Geral.
// O ID da técnica continua visível no detalhe e no title; aqui só há rótulos de UI.

import type { PeritoEvent, TecnicaResumo } from './types';

/** Nome curto em português por técnica (rótulo de UI, não dado de evidência). */
export const TECNICA_PT: Record<string, string> = {
  'T1003.001': 'Roubo de senhas (LSASS)',
  'T1027': 'Ofuscação',
  'T1021.001': 'Acesso remoto (RDP)',
  'T1053.005': 'Tarefa agendada',
  'T1059.001': 'PowerShell',
  'T1059.003': 'Prompt de comando',
  'T1070.001': 'Apagou logs',
  'T1071.001': 'Comunicação web (C2)',
  'T1078.004': 'Conta de nuvem',
  'T1098.005': 'Novo dispositivo MFA',
  'T1105': 'Baixou ferramenta',
  'T1204.002': 'Usuário abriu arquivo',
  'T1218.011': 'Rundll32',
  'T1528': 'Autorizou app (OAuth)',
  'T1566.001': 'E-mail com anexo malicioso',
  'T1567.002': 'Envio p/ nuvem',
  'T1621': 'Bombardeio de MFA',
};

export function tecnicaPt(id: string, fallback?: string): string {
  return TECNICA_PT[id] ?? TECNICA_PT[id.split('.')[0] ?? id] ?? fallback ?? id;
}

/** Ordem da kill chain usada na Visão Geral. */
export const KILL_CHAIN: { tatica: string; rotulo: string }[] = [
  { tatica: 'Acesso inicial', rotulo: 'ENTRADA' },
  { tatica: 'Execução', rotulo: 'EXECUÇÃO' },
  { tatica: 'Persistência', rotulo: 'PERMANÊNCIA' },
  { tatica: 'Escalonamento de privilégios', rotulo: 'ELEVAÇÃO' },
  { tatica: 'Evasão de defesa', rotulo: 'DISFARCE' },
  { tatica: 'Acesso a credenciais', rotulo: 'ROUBO DE SENHAS' },
  { tatica: 'Descoberta', rotulo: 'RECONHECIMENTO' },
  { tatica: 'Movimentação lateral', rotulo: 'MOVIMENTAÇÃO' },
  { tatica: 'Coleta', rotulo: 'COLETA' },
  { tatica: 'Comando e controle', rotulo: 'CONTROLE REMOTO' },
  { tatica: 'Exfiltração', rotulo: 'SAÍDA DE DADOS' },
  { tatica: 'Impacto', rotulo: 'IMPACTO' },
];

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Aceita "ENTRADA", "entrada", "Acesso inicial", "acesso-inicial" → "Acesso inicial". */
export function resolveTatica(v: string): string | null {
  const f = fold(v).replace(/[-_]/g, ' ');
  for (const k of KILL_CHAIN) {
    if (fold(k.tatica) === f || fold(k.rotulo) === f) return k.tatica;
  }
  return null;
}

export function rotuloTatica(tatica: string): string {
  return KILL_CHAIN.find((k) => k.tatica === tatica)?.rotulo ?? tatica.toUpperCase();
}

/** Mapa técnica → tática a partir de resumo.tecnicas (subtécnica herda do pai se faltar). */
export type TacticOf = (tech: string) => string | null;

export function makeTacticOf(tecnicas: TecnicaResumo[] | undefined): TacticOf {
  const m = new Map<string, string>();
  for (const t of tecnicas ?? []) m.set(t.id, t.tatica);
  return (tech) => m.get(tech) ?? m.get(tech.split('.')[0] ?? tech) ?? null;
}

/**
 * Posição para escolher a técnica principal: ordem da kill chain, com Evasão de defesa
 * por ÚLTIMO (ofuscação raramente é o que o analista quer ver primeiro).
 */
function rank(tatica: string | null): number {
  if (!tatica) return 90;
  if (tatica === 'Evasão de defesa') return 100;
  const i = KILL_CHAIN.findIndex((k) => k.tatica === tatica);
  return i < 0 ? 80 : i;
}

/** Técnicas do evento ordenadas: tática → subtécnica primeiro → lexical. */
export function sortTechniques(techs: string[], tacticOf: TacticOf): string[] {
  return [...techs].sort((a, b) => {
    const d = rank(tacticOf(a)) - rank(tacticOf(b));
    if (d) return d;
    const sa = a.includes('.') ? 0 : 1;
    const sb = b.includes('.') ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return a.localeCompare(b);
  });
}

export function primaryTechnique(ev: PeritoEvent, tacticOf: TacticOf): string | null {
  if (ev.mitre.length === 0) return null;
  if (ev.mitre.length === 1) return ev.mitre[0]!;
  return sortTechniques(ev.mitre, tacticOf)[0] ?? null;
}
