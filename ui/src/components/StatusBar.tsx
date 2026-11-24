// Barra de status superior (brief §3):
// PERITO//<ID> ▮ <FASE> ▮ f/t EVT ▮ n SRC ▮ ⊘n LIM ▮ n HOST S/EDR ▮ CUSTÓDIA ✓SHA-256 ▮ UTC ▮ MODO ▮ ? AJUDA
// Cada indicador tem title explicando o significado (ajuda quem não é do ramo).
import type { Resumo } from '../lib/types';
import { shortPhase } from '../lib/format';
import type { Modo } from '../lib/mode';

interface Props {
  caso: string;
  resumo: Resumo | null;
  filtrados: number | null;
  total: number | null;
  modo: Modo;
  onModo(): void;
  onHelp(): void;
}

const Sep = () => (
  <span className="sep" aria-hidden>
    ▮
  </span>
);

export function StatusBar({ caso, resumo, filtrados, total, modo, onModo, onHelp }: Props) {
  const nSrc = resumo ? Object.keys(resumo.por_fonte).length : null;
  const nLim = resumo?.contagens.limitacoes ?? null;
  const semEdr = resumo?.hosts_sem_edr ?? null;
  const cust = resumo?.custodia ?? null;
  const tot = total ?? resumo?.total_eventos ?? null;
  return (
    <header className="status" role="banner">
      <a className="status-id" href="#/" title="Caso aberto. Clique para voltar à lista de casos.">
        PERITO//{caso}
      </a>
      <Sep />
      {resumo ? (
        <span className="phase lbl" title={`Fase atual da resposta ao incidente: ${resumo.fase}`}>
          {shortPhase(resumo.fase)}
          <span className="sr-only"> fase {resumo.fase}</span>
        </span>
      ) : (
        <span className="lbl t3">—</span>
      )}
      <Sep />
      <span className="lbl" title="EVT = eventos: quantos aparecem com os filtros atuais / total do caso">
        <span className="num-data">
          {filtrados ?? '—'}/{tot ?? '—'}
        </span>{' '}
        EVT
      </span>
      <Sep />
      <span className="lbl" title="SRC = fontes de dados (Defender, Sentinel, Entra, Splunk, Elastic, Wazuh…) com registros neste caso">
        <span className="num-data">{nSrc ?? '—'}</span> SRC
      </span>
      <Sep />
      <span className="lbl" title="LIM = limitações registradas: o que não temos dados para saber (veja F5 COBERTURA)">
        ⊘<span className="num-data">{nLim ?? '—'}</span> LIM
      </span>
      <Sep />
      <span
        className={`lbl${semEdr && semEdr.length ? ' red' : ''}`}
        title={`HOST S/EDR = máquinas sem antivírus avançado (EDR); o que aconteceu nelas pode não ter sido registrado${
          semEdr?.length ? `. Sem EDR: ${semEdr.join(', ')}` : ''
        }`}
      >
        <span className="num-data">{semEdr ? semEdr.length : '—'}</span> HOST S/EDR
      </span>
      <Sep />
      {cust ? (
        cust.integra ? (
          <span className="lbl" title={`CUSTÓDIA = as ${cust.arquivos} evidências originais conferem com o SHA-256 registrado na coleta (não foram alteradas)`}>
            CUSTÓDIA <span className="green">✓SHA-256</span>
          </span>
        ) : (
          <span className="lbl red" title={`CUSTÓDIA com problema: alguma evidência não confere com o SHA-256 da coleta.\n${cust.problemas.join('\n')}`}>
            CUSTÓDIA ✕SHA-256 <span className="num-data">({cust.problemas.length})</span>
          </span>
        )
      ) : (
        <span className="lbl t3">CUSTÓDIA —</span>
      )}
      <Sep />
      <span className="lbl" title="UTC = todos os horários estão em UTC (horário de Brasília = UTC−3)">
        UTC
      </span>
      <Sep />
      <button
        type="button"
        className="lbl status-btn"
        onClick={onModo}
        aria-keyshortcuts="Shift+M"
        title={
          modo === 'guiado'
            ? 'GUIADO: rótulos por extenso, botões e dicas. Clique (ou M) para o modo ANALISTA, denso e só teclado.'
            : 'ANALISTA: tela densa do console. Clique (ou M) para o modo GUIADO, com rótulos por extenso.'
        }
      >
        MODO: <span className="amber">{modo === 'guiado' ? 'GUIADO' : 'ANALISTA'}</span>
      </button>
      <Sep />
      <button type="button" className="lbl status-btn" onClick={onHelp} aria-keyshortcuts="?" title="Mapa de teclas, comandos e legenda dos símbolos">
        ? AJUDA
      </button>
    </header>
  );
}
