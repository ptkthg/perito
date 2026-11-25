import type { Visao } from '../lib/types';

export const PASSOS: { visao: Visao; alvo: string; arquivo: string; titulo: string; vendo: string; importa: string }[] = [
  { visao: 'visao', alvo: 'mapa', arquivo: 'overview/Overview.tsx', titulo: 'Visão geral: o mapa do ataque', vendo: 'O caminho do invasor em 8 passos, da entrada à saída de dados. Este é um caso fictício com 50 eventos.', importa: 'Transformar eventos soltos numa história que a gestão entende.' },
  { visao: 'visao', alvo: 'fases', arquivo: 'overview/Overview.tsx', titulo: 'Fases do ataque', vendo: 'Cada coluna representa uma etapa típica de ataque. “Não observado” deixa explícito quando os registros não mostram aquela etapa.', importa: 'Honestidade sobre o que os dados mostram e o que não mostram.' },
  { visao: 'visao', alvo: 'confianca', arquivo: 'overview/Overview.tsx', titulo: 'Dá para confiar nos dados?', vendo: 'A cadeia de custódia confere a impressão digital SHA-256 dos arquivos. A cobertura informa de quais fontes e períodos temos registros.', importa: 'Preservar evidência que resiste a auditoria.' },
  { visao: 'timeline', alvo: 'evento', arquivo: 'timeline/Timeline.tsx', titulo: 'Timeline: da afirmação à prova', vendo: 'O evento selecionado mostra powershell.exe -nop -w hidden -enc … iniciado pelo excel.exe. O detalhe inclui raw_ref: arquivo e linha do registro original.', importa: 'Cada afirmação aponta para a linha exata do log original.' },
  { visao: 'attack', alvo: 'attack', arquivo: 'attack/AttackMatrix.tsx', titulo: 'ATT&CK: sugestão e confirmação', vendo: 'ATT&CK é um catálogo de técnicas usadas em ataques. O contorno tracejado indica uma sugestão automática; o sólido indica confirmação registrada pelo analista.', importa: 'Automação que ajuda sem substituir o julgamento humano.' },
  { visao: 'hipoteses', alvo: 'hipoteses', arquivo: 'hyp/HypAch.tsx', titulo: 'Hipóteses e achados', vendo: 'EVIDÊNCIA é um fato com prova. HIPÓTESE é uma inferência: registra confiança, o que a confirmaria e o que a refutaria.', importa: 'Aplicar um método de investigação, além de construir uma ferramenta.' },
  { visao: 'escopo', alvo: 'escopo', arquivo: 'docs/Docs.tsx', titulo: 'Escopo: preparar a decisão', vendo: 'Este caso tem um escopo preliminar com máquinas, contas, dados e ações necessárias. Nesta demonstração ele é o documento final; num caso real, dele saem o relatório executivo e a nota para o jurídico.', importa: 'O fim do trabalho é uma decisão de negócio, além da lista de alertas.' },
];

export const anterior = (passo: number): number => Math.max(0, passo - 1);
export const avancar = (passo: number): number | null => passo >= PASSOS.length - 1 ? null : passo + 1;
type StorageLeitura = Pick<Storage, 'getItem'>;
type StorageEscrita = Pick<Storage, 'setItem'>;
export function primeiraVisita(storage: StorageLeitura): boolean {
  try { return storage.getItem('perito-demo-tour') !== 'visto'; } catch { return true; }
}
export function registrarVisita(storage: StorageEscrita): void {
  try { storage.setItem('perito-demo-tour', 'visto'); } catch { /* navegação privada */ }
}
