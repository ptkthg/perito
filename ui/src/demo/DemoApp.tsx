import { useEffect, useState } from 'react';
import { CaseShell } from '../components/CaseShell';
import type { Modo } from '../lib/mode';
import type { Route } from '../lib/route';
import { PROJETO, TESTES } from './conteudo';
import { DemoConsole } from './DemoConsole';
import './demo.css';

function Apresentacao() {
  return <main className="demo-page">
    <header className="demo-intro">
      <h1>PERITO <span>// console de resposta a incidentes</span></h1>
      <p className="demo-lead">Junta as evidências de 7 ferramentas de segurança numa linha do tempo única, com prova de integridade e mapeamento de técnicas de ataque</p>
      <p className="demo-notice">Caso fictício · dados 100% sintéticos · somente leitura</p>
      <nav className="demo-actions" aria-label="Conheça o Perito">
        <a className="demo-primary" href="#/caso/TESTE-001/visao">Abrir a demonstração</a>
        <a href={PROJETO}>Código no GitHub</a>
        <a href="https://portfolioptk.vercel.app">Portfólio do autor</a>
      </nav>
      <figure className="demo-shot">
        <a href="#/caso/TESTE-001/visao" aria-label="Abrir a demonstração a partir da captura da visão geral">
          <img src="/demo/visao-geral.png" width={1440} height={900} alt="Console do Perito na visão geral do caso fictício: mapa do ataque em 8 passos, fases do ataque, máquinas e contas afetadas e a conferência de custódia" />
        </a>
        <figcaption>Visão geral do caso fictício: o resumo em linguagem simples, com cada frase marcada como comprovada, suposição ou sem dados.</figcaption>
      </figure>
    </header>
    <section className="demo-problema"><h2>O problema</h2><ul>
      <li>Num incidente real, as pistas estão espalhadas em ferramentas diferentes, cada uma com seu formato.</li>
      <li>Os horários vêm em fusos diferentes.</li>
      <li>O que se conclui precisa resistir a auditoria e ao jurídico.</li>
    </ul></section>
    <section><h2>O que o Perito faz</h2><div className="demo-cards">
      <article><h3>Reúne as fontes</h3><p>Normaliza 7 fontes: Defender, Sentinel, Entra ID (entradas e auditoria), Splunk, Elastic e Wazuh.</p></article>
      <article><h3>Organiza o tempo</h3><p>Monta uma timeline única em UTC, uma referência mundial de horário.</p></article>
      <article><h3>Preserva a prova</h3><p>Registra a cadeia de custódia com SHA-256, a impressão digital de cada arquivo.</p></article>
      <article><h3>Ajuda a investigar</h3><p>Sugere técnicas do MITRE ATT&CK, um catálogo de comportamentos de ataque, que o analista confirma.</p></article>
    </div></section>
    <section className="demo-construcao"><h2>Como foi construído</h2>
      <p>Python só com biblioteca padrão nos parsers e na CLI, a ferramenta de linha de comando. Console React 19 + TypeScript.</p>
      <p><strong>{TESTES.pytest} testes Python</strong> e <strong>{TESTES.vitest} testes da interface</strong>.</p>
      <p>Desenvolvimento guiado por specs, com Claude Code e Codex se revisando. <a href={`${PROJETO}/tree/main/docs/tasks`}>Veja as especificações e revisões</a>.</p>
    </section>
    <footer>Licença MIT · Caso fictício · dados 100% sintéticos · somente leitura</footer>
  </main>;
}

function TelaPequena({ onAbrir }: { onAbrir(): void }) {
  return <main className="demo-page demo-small">
    <h1>O console foi feito para telas grandes</h1>
    <p>Em uma tela de pelo menos 1024 px, você pode comparar as evidências lado a lado. Estas são capturas reais da demonstração:</p>
    <figure><img src="/demo/visao-geral.png" width="1440" height="900" alt="Visão geral do caso fictício, com mapa do ataque e fases observadas" /><figcaption>Do resumo ao caminho do ataque.</figcaption></figure>
    <figure><img src="/demo/timeline.png" width="1440" height="900" alt="Timeline com PowerShell iniciado pelo Excel e detalhe com referência ao registro original" /><figcaption>Cada evento aponta para sua evidência.</figcaption></figure>
    <nav className="demo-actions"><button type="button" onClick={onAbrir}>Abrir mesmo assim</button><a href="#/">Voltar à apresentação</a></nav>
  </main>;
}

export default function DemoApp({ route, modo, onModo }: { route: Route; modo: Modo; onModo(m: Modo): void }) {
  const [pequena, setPequena] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  const [forcar, setForcar] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const change = () => setPequena(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  if (!route.caso) return <Apresentacao />;
  if (pequena && !forcar) return <TelaPequena onAbrir={() => setForcar(true)} />;
  // A demo pública expõe um único caso sintético, mesmo se o hash for alterado.
  if (route.caso !== 'TESTE-001') return <main className="demo-page"><h1>Caso indisponível</h1><a href="#/caso/TESTE-001/visao">Abrir o caso fictício TESTE-001</a></main>;
  return <DemoConsole visao={route.visao ?? 'visao'}>{(passo) =>
    <CaseShell caso="TESTE-001" visao={route.visao ?? 'visao'} modo={modo} onModo={onModo} selecionarEvento={passo === 3} />
  }</DemoConsole>;
}
