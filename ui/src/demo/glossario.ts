// Fonte única das definições, inclusive das dicas da barra de status e das abas.
export const GLOSSARIO: Record<string, string> = {
  'ATT&CK': 'Catálogo público de técnicas usadas por invasores. Uma regra sugere a técnica; o analista verifica a evidência antes de confirmá-la.',
  'Cadeia de custódia': 'Registro de quem coletou cada arquivo, quando e de sua impressão digital. Ajuda a demonstrar que a evidência foi preservada.',
  'DFIR': 'Investigação digital e resposta a incidentes: descobrir o que aconteceu e orientar a recuperação.',
  'EDR': 'Ferramenta que registra atividades em computadores e servidores para detectar e investigar ataques.',
  'Evidência × hipótese': 'Evidência é um fato ligado a um registro original. Hipótese é uma explicação possível, com confiança e critérios para confirmar ou refutar.',
  'IOC': 'Indicador de comprometimento: endereço, domínio ou arquivo que pode ajudar a localizar atividade suspeita. Precisa de contexto antes de ser aprovado.',
  'LIM': 'Limitação: algo que não conseguimos saber com os dados disponíveis. Ausência de registro não prova ausência de ataque.',
  'Pivô': 'Partir de uma pista, como uma conta ou endereço, para encontrar outros registros relacionados.',
  'SHA-256': 'Algoritmo que calcula uma impressão digital do arquivo. Se o conteúdo mudar, a impressão digital também muda.',
  'SIEM': 'Sistema que reúne registros de ferramentas diferentes para pesquisar e detectar atividade suspeita.',
  'Timeline': 'Linha do tempo que coloca os registros de todas as fontes na mesma sequência.',
  'UTC': 'Referência mundial de horário. Usar o mesmo fuso permite comparar registros de ferramentas diferentes.',
  'Defender': 'Ferramenta de segurança da Microsoft. Neste caso registra processos, arquivos e conexões dos computadores.',
  'Sentinel': 'SIEM da Microsoft que reúne registros e alertas de segurança.',
  'Entra ID': 'Serviço de identidade da Microsoft. Registra entradas em contas e alterações administrativas; são duas fontes no Perito.',
  'Splunk': 'Plataforma para pesquisar e correlacionar registros de sistemas.',
  'Elastic': 'Plataforma de busca e análise de registros. Neste caso traz observações de rede.',
  'Wazuh': 'Plataforma de monitoramento de segurança que registra atividades e alterações nos sistemas.',
  'EVT': 'Eventos: quantidade de registros exibidos com os filtros atuais e total do caso.',
  'SRC': 'Fontes: ferramentas ou tipos de exportação que forneceram registros para este caso.',
  'HOST S/EDR': 'Computadores sem registro de um EDR. Isso limita o que podemos concluir sobre a atividade neles.',
  'Fase': 'Etapa atual da resposta ao incidente: preparar, detectar, conter, erradicar, recuperar ou aprender.',
  'Modo': 'Guiado mostra explicações e botões. Analista oferece uma apresentação mais densa para uso frequente.',
  'Ajuda': 'Mapa de teclas e comandos do console. O glossário da demonstração explica os termos.',
  'Visão geral': 'Resumo do caso, caminho do ataque, fases e qualidade dos dados.',
  'Mapa': 'Relações entre máquinas, contas e endereços, com o caminho observado no ataque.',
  'Agentes': 'Apoio de agentes à investigação, com revisão do analista. Na demo não há execução nem escrita.',
  'Entidades': 'Máquinas, contas e endereços encontrados nos registros.',
  'Cobertura': 'Fontes e períodos disponíveis para investigar, junto das lacunas conhecidas.',
  'Escopo': 'Quais máquinas, contas e dados foram afetados, com evidência e grau de certeza.',
  'Revisão': 'Uma segunda leitura da investigação procura lacunas e conclusões sem sustentação.',
  'Relatórios': 'Documentos que traduzem a investigação em decisões técnicas e de negócio.',
};

export const STATUS_TERMOS = ['PREP', 'DETECT', 'CONTER', 'ERRAD', 'RECUP', 'LIÇÕES', 'EVT', 'SRC', 'LIM', 'HOST S/EDR', 'CUSTÓDIA', 'SHA-256', 'UTC', 'MODO', 'AJUDA'];
const ALIASES: Record<string, string> = {
  PREP: 'Fase', DETECT: 'Fase', CONTER: 'Fase', ERRAD: 'Fase', RECUP: 'Fase', 'LIÇÕES': 'Fase',
  'CUSTÓDIA': 'Cadeia de custódia', MODO: 'Modo', AJUDA: 'Ajuda', 'HIP/ACH': 'Evidência × hipótese', REL: 'Relatórios',
};
export function termoParaRotulo(rotulo: string): string | undefined {
  const normal = rotulo.trim().toLocaleUpperCase('pt-BR');
  return ALIASES[normal] ?? Object.keys(GLOSSARIO).find(k => k.toLocaleUpperCase('pt-BR') === normal);
}
