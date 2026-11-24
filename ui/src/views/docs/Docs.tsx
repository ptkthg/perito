// F7 ESCOPO, F8 REVISÃO e F9 RELATÓRIOS: documentos do caso renderizados em estilo console.
// Markdown seguro (lib/markdown: html:false, links externos desativados, tags como carimbos).
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { DocItem, Resumo } from '../../lib/types';
import type { Modo } from '../../lib/mode';
import type { ViewHandle } from '../../lib/view';
import { useLoad } from '../../lib/useLoad';
import { renderMarkdown } from '../../lib/markdown';
import { shortPhase } from '../../lib/format';
import type { MsgKind } from '../../lib/msg';

export function Markdown({ texto, onRender }: { texto: string; onRender?: (el: HTMLDivElement) => void }) {
  const html = useMemo(() => renderMarkdown(texto), [texto]);
  const ref = useRef<HTMLDivElement>(null);
  // pós-processamento (ex.: marcar divergências) só quando o HTML muda
  useEffect(() => {
    if (onRender && ref.current) onRender(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);
  return <div className="doc" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---------------------------------------------------------------- F7 ESCOPO
export function Escopo({ caso, rev, modo, onAgente }: { caso: string; rev: number; modo: Modo; onAgente(acao: string): void }) {
  const d = useLoad(() => api.doc(caso, 'escopo'), [caso, rev]);
  const vazio = d?.ok && !d.v.conteudo.replace(/<!--[\s\S]*?-->/g, '').replace(/^#.*$/gm, '').trim();
  return (
    <div className="docv">
      <div className="doc-bar">
        <span className="lbl">F7 ESCOPO</span> <span className="t3">▮ escopo.md</span>
        {d?.ok && <span className="t3"> · atualizado {d.v.mtime.replace('T', ' ').slice(0, 16)} UTC</span>}
        {modo === 'guiado' && <span className="t2"> · quais máquinas, contas e dados foram afetados, e com qual evidência</span>}
      </div>
      {!d && <p className="inline-state t3">CARREGANDO escopo.md ...</p>}
      {d && !d.ok && (
        <p className="inline-state">
          <span className="lbl">ESCOPO AINDA NÃO ESCRITO</span> <span className="t3">▮</span> <span className="t2">{d.err}</span>
        </p>
      )}
      {d?.ok && vazio && (
        <p className="inline-state">
          <span className="lbl">ESCOPO AINDA NÃO ESCRITO</span> <span className="t3">▮</span>{' '}
          <button type="button" className="btn-stamp" onClick={() => onAgente('investigar-fase')}>
            [6] investigar fase com um agente
          </button>
        </p>
      )}
      {d?.ok && !vazio && <Markdown texto={d.v.conteudo} />}
    </div>
  );
}

// ---------------------------------------------------------------- F8 REVISÃO
interface RevProps {
  caso: string;
  rev: number;
  modo: Modo;
  onAgente(acao: string): void;
  onMsg(text: string, kind?: MsgKind): void;
}

const ordem = (a: DocItem, b: DocItem) => (a.mtime < b.mtime ? 1 : -1);

function ColunaDoc({ titulo, opcoes, sel, onSel, caso, rev, vazio, onRender }: {
  titulo: string;
  opcoes: DocItem[];
  sel: string | null;
  onSel(n: string): void;
  caso: string;
  rev: number;
  vazio: React.ReactNode;
  onRender?: (el: HTMLDivElement) => void;
}) {
  const d = useLoad(() => (sel ? api.doc(caso, sel) : Promise.resolve(null)), [caso, sel, rev]);
  return (
    <section className="rev-col" aria-label={titulo}>
      <div className="rev-h">
        <span className="lbl">{titulo}</span>{' '}
        {opcoes.length > 1 ? (
          <select className="bench-in" value={sel ?? ''} onChange={(e) => onSel(e.target.value)} aria-label={`escolher arquivo ${titulo}`}>
            {opcoes.map((o) => (
              <option key={o.nome} value={o.nome}>
                {o.nome.replace('revisoes/', '')} · {o.mtime.slice(0, 16).replace('T', ' ')}
              </option>
            ))}
          </select>
        ) : (
          <span className="t3">{sel ? sel.replace('revisoes/', '') : ''}</span>
        )}
      </div>
      <div className="rev-body">
        {!sel && <p className="inline-state">{vazio}</p>}
        {sel && !d && <p className="inline-state t3">CARREGANDO …</p>}
        {d && !d.ok && <p className="inline-state red">ERRO {d.err}</p>}
        {d?.ok && d.v && <Markdown texto={d.v.conteudo} onRender={onRender} />}
      </div>
    </section>
  );
}

export const Revisao = forwardRef<ViewHandle, RevProps>(function Revisao({ caso, rev, modo, onAgente, onMsg }, ref) {
  const docs = useLoad(() => api.docs(caso), [caso, rev]);
  const revs = useMemo(() => (docs?.ok ? docs.v.filter((d) => d.grupo === 'revisoes').sort(ordem) : []), [docs]);
  const claude = revs.filter((d) => /revisoes\/claude-/.test(d.nome));
  const codex = revs.filter((d) => /revisoes\/codex-/.test(d.nome));
  const conc = revs.filter((d) => /revisoes\/concilia/.test(d.nome));
  const [sel, setSel] = useState<Record<string, string | null>>({});
  const escolha = (k: string, xs: DocItem[]) => sel[k] ?? xs[0]?.nome ?? null;
  const [marcas, setMarcas] = useState<HTMLElement[]>([]);
  const [atual, setAtual] = useState(-1);

  // Marca divergências na conciliação: linhas "Rejeitado"/"Parcialmente" e itens de
  // "Divergências não resolvidas" (exceto "Nenhuma"). Navegação n/N.
  const marcar = (raiz: HTMLDivElement) => {
    const els: HTMLElement[] = [];
    raiz.querySelectorAll('.div-glifo').forEach((g) => g.remove());
    raiz.querySelectorAll('.div-mark').forEach((m) => m.classList.remove('div-mark', 'is-sel'));
    raiz.querySelectorAll('tbody tr').forEach((tr) => {
      if ([...tr.querySelectorAll('td')].some((td) => /^\**\s*(rejeitad|parcialmente)/i.test(td.textContent?.trim() ?? ''))) els.push(tr as HTMLElement);
    });
    const hs = [...raiz.querySelectorAll('h1,h2,h3')];
    for (const h of hs) {
      if (!/diverg[eê]ncias?\s+n[aã]o\s+resolvid/i.test(h.textContent ?? '')) continue;
      for (let el = h.nextElementSibling; el && !/^H[1-3]$/.test(el.tagName); el = el.nextElementSibling) {
        el.querySelectorAll('li').forEach((li) => {
          if (!/^nenhum/i.test(li.textContent?.trim() ?? '')) els.push(li as HTMLElement);
        });
      }
    }
    for (const el of els) {
      el.classList.add('div-mark');
      const alvo = el.tagName === 'TR' ? el.querySelector('td') : el;
      const g = document.createElement('span');
      g.className = 'div-glifo';
      g.textContent = '≠ ';
      g.setAttribute('aria-label', 'divergência');
      alvo?.prepend(g);
    }
    setMarcas(els);
    setAtual(-1);
  };

  useImperativeHandle(ref, () => ({
    onKey(e) {
      if (e.key === 'n' || e.key === 'N') {
        if (!marcas.length) {
          onMsg('nenhuma divergência marcada (≠) na conciliação', 'info');
          return true;
        }
        const i = e.key === 'n' ? (atual + 1) % marcas.length : (atual - 1 + marcas.length) % marcas.length;
        marcas.forEach((m) => m.classList.remove('is-sel'));
        marcas[i]!.classList.add('is-sel');
        marcas[i]!.scrollIntoView({ block: 'center' });
        setAtual(i);
        onMsg(`≠ divergência ${i + 1}/${marcas.length} · n/N navega`, 'info');
        return true;
      }
      if (e.key === 'r') {
        onAgente('revisao-cruzada');
        return true;
      }
      return false;
    },
  }));

  return (
    <div className="revv">
      <div className="doc-bar">
        <span className="lbl">F8 REVISÃO</span> <span className="t3">▮</span>{' '}
        <span className={marcas.length ? 'amber' : 't3'}>≠ {marcas.length} divergência(s)</span> <span className="t3">· n/N navega</span>{' '}
        <button type="button" className="btn-stamp" onClick={() => onAgente('revisao-cruzada')}>
          [r] revisão cruzada
        </button>
        {modo === 'guiado' && <span className="t2"> · um agente revisa o trabalho do outro; a conciliação registra o que foi aceito ou rejeitado</span>}
      </div>
      {!docs && <p className="inline-state t3">CARREGANDO /docs ...</p>}
      <div className="rev">
        <ColunaDoc
          titulo="CLAUDE"
          caso={caso}
          rev={rev}
          opcoes={claude}
          sel={escolha('claude', claude)}
          onSel={(n) => setSel((s) => ({ ...s, claude: n }))}
          vazio={<span className="t3">nenhuma revisão do Claude · [r] revisão cruzada</span>}
        />
        <ColunaDoc
          titulo="CODEX"
          caso={caso}
          rev={rev}
          opcoes={codex}
          sel={escolha('codex', codex)}
          onSel={(n) => setSel((s) => ({ ...s, codex: n }))}
          vazio={<span className="t3">nenhuma revisão do Codex · [r] revisão cruzada</span>}
        />
        <ColunaDoc
          titulo="CONCILIADO"
          caso={caso}
          rev={rev}
          opcoes={conc}
          sel={escolha('conc', conc)}
          onSel={(n) => setSel((s) => ({ ...s, conc: n }))}
          vazio={<span className="t3">nenhuma conciliação ainda (revisoes/conciliacao.md)</span>}
          onRender={marcar}
        />
      </div>
    </div>
  );
});

// ---------------------------------------------------------------- F9 RELATÓRIOS
export function Relatorios({ caso, rev, resumo, onAgente }: { caso: string; rev: number; resumo: Resumo | null; onAgente(acao: string): void }) {
  const docs = useLoad(() => api.docs(caso), [caso, rev]);
  const rels = useMemo(() => (docs?.ok ? docs.v.filter((d) => d.grupo === 'relatorios').sort(ordem) : []), [docs]);
  const [sel, setSel] = useState<string | null>(null);
  const nome = sel ?? rels[0]?.nome ?? null;
  const d = useLoad(() => (nome ? api.doc(caso, nome) : Promise.resolve(null)), [caso, nome, rev]);
  const gerar = (
    <>
      <button type="button" className="btn-stamp" onClick={() => onAgente('relatorio-executivo')}>
        [gerar executivo]
      </button>{' '}
      <button type="button" className="btn-stamp" onClick={() => onAgente('relatorio-tecnico')}>
        [gerar técnico]
      </button>{' '}
      <button type="button" className="btn-stamp" onClick={() => onAgente('nota-dpo')}>
        [gerar nota DPO]
      </button>
    </>
  );
  return (
    <div className="relv">
      <div className="doc-bar">
        <span className="lbl">F9 RELATÓRIOS</span> <span className="t3">▮ pré-visualização de impressão · Ctrl+P imprime só o papel</span> {gerar}
      </div>
      {rels.length > 1 && (
        <p className="doc-bar rel-lista">
          {rels.map((r) => (
            <button key={r.nome} type="button" className={`btn-stamp${r.nome === nome ? ' is-on' : ''}`} onClick={() => setSel(r.nome)}>
              {r.nome.replace('relatorios/', '')}
            </button>
          ))}
        </p>
      )}
      {docs?.ok && rels.length === 0 && (
        <p className="inline-state">
          <span className="lbl">NENHUM RELATÓRIO</span> <span className="t3">▮</span> <span className="t2">gere com um agente:</span> {gerar}
        </p>
      )}
      {nome && (
        <article className="rel-papel" aria-label={`relatório ${nome}`}>
          <header className="rel-cab">
            <span className="lbl">PERITO // {caso}</span>
            <span>{resumo?.titulo ?? ''}</span>
            <span className="lbl">
              FASE {resumo ? shortPhase(resumo.fase) : '—'} <span className="t2">({resumo?.fase ?? '—'})</span>
            </span>
            <span className="t2">
              {nome.replace('relatorios/', '')} · atualizado {d?.ok && d.v ? d.v.mtime.replace('T', ' ').slice(0, 16) : '—'} UTC
            </span>
          </header>
          {!d && <p className="t3">CARREGANDO …</p>}
          {d && !d.ok && <p className="red">ERRO {d.err}</p>}
          {d?.ok && d.v && <Markdown texto={d.v.conteudo} />}
        </article>
      )}
    </div>
  );
}
