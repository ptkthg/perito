// Ajuda em tela cheia (`?`): mapa de teclas, comandos e legenda de glifos.
// Sem raio nem sombra; borda de 1px; ocupa a tela inteira (não é modal flutuante).
import { useEffect, useRef } from 'react';
import { COMMANDS } from '../lib/commands';

const TECLAS: [string, string][] = [
  ['F1–F9 · g0…g9', 'trocar de visão (g0 = F0 VISÃO GERAL)'],
  ['M (Shift+m)', 'alterna modo GUIADO / ANALISTA'],
  ['j / k · J / K', 'linha ±1 · ±10'],
  ['gg / G', 'início / fim da timeline'],
  ['h / l', 'cursor de célula na linha'],
  ['Enter', 'fixa o evento no detalhe e expande o cmdline (Esc solta)'],
  ['p', 'pivô pelo valor da célula focada (substitui os filtros)'],
  ['f / F', 'incluir / excluir o valor da célula no filtro'],
  ['u', 'desfaz o último filtro'],
  ['y / x', 'copiar valor da célula / copiar raw_ref'],
  ['m · [ / ]', 'marcar evento · marca anterior / próxima'],
  ['/ · n / N', 'busca incremental · próximo / anterior'],
  ['t', 'ir para horário (prompt com "ir ")'],
  ['> ou :', 'foca a linha de comando'],
  ['Tab · ↑ / ↓', 'completa (repita para alternar) · histórico'],
  ['Esc', 'camadas: solta o detalhe, limpa o prompt, sai do foco'],
  ['Ctrl+= / Ctrl+-', 'densidade 18 / 20 / 24 px'],
  ['Shift+L', 'alterna modo claro'],
  ['arrastar no sismógrafo', 'define a janela de tempo; clique vai ao horário'],
  ['[ver caso inteiro]', 'no GUIADO o sismógrafo abre no período suspeito; o botão alterna'],
  ['a · H (F1)', 'bancada: promover a achado · vincular a hipótese (Ctrl+Enter grava)'],
  ['F6 · 1-4 · b/m/l', 'status ABERTA/CONFIRMADA/REFUTADA/INCONCLUSIVA · confiança BAIXA/MÉDIA/ALTA'],
  ['F4 · a · d · m', 'IOC: aprova · descarta com motivo · marca para lote'],
  ['i (F0/F5)', 'ingerir: escolher arquivos (ou arraste para a zona INGERIR)'],
  ['o · a (após gravar)', 'ações da linha de status: abrir no F6 · gerar achado'],
  ['gm · mapa', 'MAPA DO ATAQUE'],
  ['mapa: ←→ ↑↓', 'coluna · nó; 1º clique seleciona, 2º clique/Enter/p pivota na F2'],
  ['mapa: n/N . , c + -', 'passo do caminho · arestas do nó · só o caminho · expandir/recolher grupo'],
  ['F2: Backspace', 'volta ao MAPA quando o pivô veio dele'],
  ['ga · agentes', 'PAINEL AGENTES: 1–6 ação · ←/→ agente · Ctrl+Enter executa · Ctrl+C cancela · h histórico'],
  ['agentes (fim)', 'Espaço marca · a aplica marcados · d descarta · Enter diff · End rola o log · r tenta de novo'],
  ['F3 ATT&CK', '←→↑↓ técnica · Enter abre a F1 filtrada (tecnica=T…); tracejado = sugerida, sólido = confirmada'],
  ['F5 COBERTURA', 'j/k lacuna · l registrar LIM (formulário pré-preenchido) · i ingerir'],
  ['F8 REVISÃO', 'n/N divergências (≠) da conciliação · r revisão cruzada'],
  ['F9 RELATÓRIOS', 'pré-visualização de impressão · Ctrl+P imprime só o papel'],
  ['F2 · j/k h/l ↵ f y /', 'entidades: item · coluna · pivô · filtro · copia · filtra a lista'],
  ['F6 · ↵ · clique em ref', 'hipóteses/achados: abre as evidências (A6, arquivo.csv:15-17) na timeline'],
  ['n / N (após ref)', 'percorre os eventos destacados vindos de uma ref; Esc limpa'],
  ['F4 · D · y · Y', 'IOC: alterna defanged/real · copia o valor real · copia todos visíveis (defanged)'],
  ['r · R (em erro)', 'recarrega a visão · recarrega o app'],
  ['?', 'esta ajuda'],
];

const GLIFOS: { g: React.ReactNode; d: string }[] = [
  { g: <span className="stamp stamp-evid">■EVID</span>, d: 'evidência: preenchimento sólido verde, com raw_ref' },
  { g: <span className="stamp stamp-hip">◇HIP·MÉD</span>, d: 'hipótese: só contorno âmbar, confiança obrigatória' },
  { g: <span className="stamp stamp-lim hatch">⊘LIM</span>, d: 'limitação: texto sobre hachura' },
  { g: <span>≡2</span>, d: '≡n corroborado por n registros de outras fontes (raw_ref no detalhe) · GUIADO: "3 fontes"' },
  { g: <span>▲</span>, d: 'volume alto / grande envio (FLAG e sismógrafo) · na régua inferior, cursor do evento selecionado' },
  { g: <span>⊙</span>, d: 'observador diferente do host (ex.: firewall, DNS)' },
  { g: <em className="t2">~host</em>, d: 'host de origem deduzido (src_host); o detalhe diz de onde veio' },
  { g: <span className="red">✕</span>, d: 'log limpo (audit 1102/104)' },
  { g: <span className="hatch seis-hatch-sample">░░░</span>, d: 'sem dados da fonte nesse intervalo (lacuna de cobertura)' },
  { g: <span>T1059.001?</span>, d: 'técnica sugerida por heurística; o ? sai quando o analista confirma' },
  { g: <span className="amber">*</span>, d: 'evento marcado pelo analista (m)' },
  { g: <span className="amber">▌</span>, d: 'linha selecionada (barra âmbar); foco do teclado = contorno ciano' },
];

export function HelpOverlay({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div
      className="help"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      tabIndex={-1}
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === '?' || e.key === 'q') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="help-head">
        <h1 id="help-title" className="lbl">
          PERITO ▮ AJUDA
        </h1>
        <button type="button" className="lbl help-close" onClick={onClose}>
          [Esc] FECHAR
        </button>
      </header>
      <div className="help-body">
        <section aria-labelledby="h-teclas">
          <h2 id="h-teclas" className="lbl t2">
            TECLAS
          </h2>
          <dl className="help-dl">
            {TECLAS.map(([k, d]) => (
              <div key={k}>
                <dt className="amber">{k}</dt>
                <dd>{d}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-labelledby="h-cmd">
          <h2 id="h-cmd" className="lbl t2">
            COMANDOS
          </h2>
          <dl className="help-dl">
            {COMMANDS.map((c) => (
              <div key={c.name}>
                <dt>
                  <span className="amber">{c.name}</span> <span className="t2">{c.args}</span>
                </dt>
                <dd>{c.help}</dd>
              </div>
            ))}
            <div>
              <dt className="t2">exemplos</dt>
              <dd>
                filtro host=ws-fin-023 fonte!=splunk · pivo --ip 203.0.113.45 · janela 13:00..13:30 · ir 13:15:30
              </dd>
            </div>
            <div>
              <dt className="t2">aliases</dt>
              <dd>src= → fonte · type= → tipo · fonte aceita DEF SEN ESI EAU SPL ELA WAZ · tipo aceita PROC NET DNS …</dd>
            </div>
            <div>
              <dt className="t2">tatica (local)</dt>
              <dd>
                filtro tatica=ENTRADA · tatica=SAÍDA-DE-DADOS · tatica!=DISFARCE · tecnica=T1059 (inclui subtécnicas) · tecnica!=T1027 — aplicados no navegador
                sobre os eventos carregados (o servidor não conhece táticas/técnicas como filtro)
              </dd>
            </div>
          </dl>
          <h2 className="lbl t2 help-gap">GLIFOS</h2>
          <dl className="help-dl help-glyphs">
            {GLIFOS.map((x, i) => (
              <div key={i}>
                <dt>{x.g}</dt>
                <dd>{x.d}</dd>
              </div>
            ))}
          </dl>
          <h2 className="lbl t2 help-gap">MAPA</h2>
          <p className="help-src">
            ┌─┐ máquina · ╔═╗ conta · ┏━┓ aplicativo · ╎╌╎ e-mail · › endereço externo · <span className="chip-passo">[n]</span> passo do ataque ·{' '}
            <span className="red">⊘</span> sem EDR (hachura) · <span className="red">▲</span> volume · ✕ falha ✓ sucesso · tracejado = só falhas · âmbar = caminho do
            atacante
          </p>
          <h2 className="lbl t2 help-gap">FONTES</h2>
          <p className="help-src">
            <span style={{ color: 'var(--src-def)' }}>DEF</span> defender · <span style={{ color: 'var(--src-sen)' }}>SEN</span> sentinel ·{' '}
            <span style={{ color: 'var(--src-esi)' }}>ESI</span> entra_signin · <span style={{ color: 'var(--src-eau)' }}>EAU</span> entra_audit ·{' '}
            <span style={{ color: 'var(--src-spl)' }}>SPL</span> splunk · <span style={{ color: 'var(--src-ela)' }}>ELA</span> elastic ·{' '}
            <span style={{ color: 'var(--src-waz)' }}>WAZ</span> wazuh
          </p>
        </section>
      </div>
    </div>
  );
}
