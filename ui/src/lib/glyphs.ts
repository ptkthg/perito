// FONTE ÚNICA dos glifos da interface (brief §1.4 e Adendo).
// Todo caractere não-ASCII que não seja letra e apareça em src/ precisa estar declarado aqui,
// e todos precisam existir na Iosevka. Verificação: `npm run check:glyphs`
// (uv run --with fonttools --with brotli python scripts/check-glyphs.py).

export const G = {
  // separadores e grade
  sep: '▮',
  barra: '│',
  linha: '─',
  dupla: '═',
  selecao: '▌',
  cursor: '█',
  // marcadores metodológicos
  evid: '■',
  hip: '◇',
  lim: '⊘',
  hatch: '░',
  corrob: '≡',
  volume: '▲',
  observ: '⊙',
  deduz: '~',
  logLimpo: '✕',
  falha: '✕',
  sucesso: '✓',
  marca: '*',
  // mapa: bordas por tipo (o rótulo do tipo fica na borda)
  host: '┌',
  hostFim: '┐',
  conta: '╔',
  contaFim: '╗',
  app: '┏',
  appFim: '┓',
  appTraco: '━',
  email: '╎',
  emailTraco: '╌',
  externo: '›',
  canal: '┊',
  ponta: '▶',
  voltar: '◀',
  // progresso / fila da ingestão
  cheio: '▮',
  vazio: '▯',
  rodando: '▸',
  // texto
  seta: '→',
  setaEsq: '←',
  radio: '•',
  setaCima: '↑',
  setaBaixo: '↓',
  enter: '↵',
  e: '∧',
  diferente: '≠',
  reticencias: '…',
  ponto: '·',
  vezes: '×',
  travessao: '—',
  meiaRisca: '–',
  menos: '−',
  maisMenos: '±',
  menorIgual: '≤',
  maiorIgual: '≥',
  paragrafo: '§',
} as const;

/** Sparkline e barras (▁…█). */
export const BLOCOS = '▁▂▃▄▅▆▇█';

/** Lista completa (lida pelo verificador em Python a partir deste arquivo). */
export const TODOS_GLIFOS: string = [...new Set([...Object.values(G).join(''), ...BLOCOS])].join('');
