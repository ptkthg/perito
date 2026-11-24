// VINCULAR A HIPÓTESE (brief §10, tecla `H`): lista filtrável, relação apoia/contradiz
// obrigatória; [n] cria hipótese nova a partir do evento.
// PATCH /hipoteses/Hn {refs_add:[{ref, relacao}]} ou POST /hipoteses — sempre com versão.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Hipotese, PeritoEvent } from '../../lib/types';
import type { Modo } from '../../lib/mode';
import { ApiError, ConflitoError, api, describeError } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';
import { ConflictPanel } from './ConflictPanel';
import type { MsgKind } from '../timeline/Timeline';

interface Props {
  caso: string;
  ev: PeritoEvent;
  modo: Modo;
  rev: number;
  onSalvo(msg: string): void;
  onFechar(): void;
  onMsg(text: string, kind?: MsgKind): void;
}

type Rel = 'apoia' | 'contradiz';
const CONF = [
  { k: 'b', v: 'baixa' },
  { k: 'm', v: 'média' },
  { k: 'l', v: 'alta' },
] as const;

export function LinkHypForm({ caso, ev, modo, rev, onSalvo, onFechar, onMsg }: Props) {
  const guiado = modo === 'guiado';
  const hips = useLoad(() => api.hipoteses(caso), [caso, rev]);
  const [filtro, setFiltro] = useState('');
  const [sel, setSel] = useState(0);
  const [rel, setRel] = useState<Rel | null>(null);
  const [nova, setNova] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [conf, setConf] = useState<string>('baixa');
  const [erro, setErro] = useState<{ campo: string; msg: string } | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [conflito, setConflito] = useState<string | null>(null);
  const [avisoEsc, setAvisoEsc] = useState(false);
  const filtroRef = useRef<HTMLInputElement>(null);
  const tituloRef = useRef<HTMLInputElement>(null);
  const relRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    api
      .doc(caso, 'hipoteses')
      .then((d) => vivo && setBase(d.conteudo))
      .catch(() => vivo && setBase(null));
    filtroRef.current?.focus();
    return () => {
      vivo = false;
    };
  }, [caso]);

  const lista = useMemo(() => {
    const t = filtro.toLowerCase();
    const xs: Hipotese[] = hips?.ok ? hips.v : [];
    return xs.filter((h) => !t || `${h.id} ${h.titulo} ${h.status}`.toLowerCase().includes(t));
  }, [hips, filtro]);
  const alvo = lista[Math.min(sel, lista.length - 1)] ?? null;

  const salvar = async () => {
    setErro(null);
    try {
      if (nova) {
        if (titulo.trim().length < 3) {
          setErro({ campo: 'titulo', msg: 'título com pelo menos 3 caracteres' });
          tituloRef.current?.focus();
          return;
        }
        const r = await api.criarHipotese(caso, {
          titulo: titulo.trim(),
          confianca: conf,
          sustentacao: `[EVIDÊNCIA] ${ev.raw_ref}`,
        });
        onSalvo(`✓ HIPÓTESE ${r.id ?? ''} criada a partir de ${ev.raw_ref} → hipoteses.md`);
        return;
      }
      if (!alvo) {
        setErro({ campo: 'lista', msg: 'escolha uma hipótese (ou [n] nova)' });
        filtroRef.current?.focus();
        return;
      }
      if (!rel) {
        setErro({ campo: 'rel', msg: 'escolha a relação: apoia ou contradiz' });
        relRef.current?.querySelector<HTMLElement>('button')?.focus();
        return;
      }
      await api.patchHipotese(caso, alvo.id, { refs_add: [{ ref: ev.raw_ref, relacao: rel }] });
      onSalvo(`✓ EVIDÊNCIA ${ev.raw_ref} vinculada a ${alvo.id} (${rel}) → hipoteses.md`);
    } catch (x) {
      if (x instanceof ConflitoError) setConflito(x.conflito.conteudoAtual);
      else {
        const m = x instanceof ApiError ? `${x.message}${x.detalhe ? ` — ${x.detalhe}` : ''}` : describeError(x);
        setErro({ campo: nova ? 'titulo' : 'rel', msg: m });
        onMsg(`✕ hipótese não gravada: ${m}`, 'err');
      }
    }
  };

  const recarregar = async () => {
    try {
      const d = await api.doc(caso, 'hipoteses');
      setBase(d.conteudo);
      setConflito(null);
      await salvar();
    } catch (x) {
      setErro({ campo: 'rel', msg: describeError(x) });
    }
  };

  const emTexto = (t: EventTarget) => t instanceof HTMLInputElement;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (/^F\d$/.test(e.key)) return;
    e.stopPropagation();
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      void salvar();
      return;
    }
    if (e.key === 'Escape' && !conflito) {
      e.preventDefault();
      const sujo = !!filtro || !!titulo || rel !== null;
      if (sujo && !avisoEsc) {
        setAvisoEsc(true);
        onMsg('há escolhas feitas: Esc de novo fecha sem gravar', 'info');
        return;
      }
      onFechar();
      return;
    }
    if (!nova && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setSel((s) => Math.max(0, Math.min(lista.length - 1, s + (e.key === 'ArrowDown' ? 1 : -1))));
      return;
    }
    if (emTexto(e.target)) return;
    if (e.key === 'n' && !nova) {
      e.preventDefault();
      setNova(true);
      setTitulo((ev.description ?? '').slice(0, 120));
      requestAnimationFrame(() => tituloRef.current?.focus());
    } else if (!nova && (e.key === 'a' || e.key === 'c')) {
      setRel(e.key === 'a' ? 'apoia' : 'contradiz');
    } else if (nova) {
      const c = CONF.find((x) => x.k === e.key);
      if (c) setConf(c.v);
    }
  };

  return (
    <section className="bench" aria-label="Vincular a hipótese" onKeyDown={onKeyDown}>
      <header className="bench-h">
        <span className="lbl">{nova ? 'NOVA HIPÓTESE' : 'VINCULAR A HIPÓTESE'}</span> <span className="stamp stamp-hip">◇HIP</span>
        <span className="t3"> · {ev.raw_ref}</span>
      </header>
      {conflito !== null && (
        <ConflictPanel arquivo="hipoteses.md" base={base} atual={conflito} modo={modo} onRecarregar={() => void recarregar()} onManter={() => setConflito(null)} />
      )}
      {!nova ? (
        <>
          <label className="bench-l lbl t2" htmlFor="hip-filtro">
            HIPÓTESE
          </label>
          {guiado && <p className="bench-help t2">Escolha a hipótese que este evento apoia ou contradiz. ↑/↓ escolhe; digite para filtrar.</p>}
          <input
            id="hip-filtro"
            ref={filtroRef}
            className="bench-in"
            value={filtro}
            placeholder="filtrar por título ou H#"
            onChange={(e) => {
              setFiltro(e.target.value);
              setSel(0);
              setAvisoEsc(false);
            }}
            aria-controls="hip-lista"
          />
          <ul id="hip-lista" className="bench-list" role="listbox" aria-label="Hipóteses">
            {!hips && <li className="t3">CARREGANDO hipoteses.md ...</li>}
            {hips?.ok && hips.v.length === 0 && <li className="t3">nenhuma hipótese ainda · [n] criar a partir deste evento</li>}
            {lista.map((h, i) => (
              <li key={h.id} role="option" aria-selected={h === alvo} className={h === alvo ? 'is-sel' : ''} onClick={() => setSel(i)}>
                <span className="selbar">{h === alvo ? '▌' : ' '}</span>
                <span className="stamp stamp-hip">◇{h.id}</span> {h.titulo} <span className="t3">· {h.status ?? '—'}</span>
              </li>
            ))}
          </ul>
          {erro?.campo === 'lista' && <p className="red bench-err">✕ {erro.msg}</p>}
          <div className="bench-l lbl t2" id="hip-rel">
            RELAÇÃO (obrigatória)
          </div>
          <div className="chips" role="radiogroup" aria-labelledby="hip-rel" ref={relRef}>
            {(['apoia', 'contradiz'] as const).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={rel === r} className={`chip${rel === r ? ' is-on' : ''}`} onClick={() => setRel(r)}>
                ({rel === r ? '•' : ' '}) {r} <span className="t3">[{r[0]}]</span>
              </button>
            ))}
          </div>
          {erro?.campo === 'rel' && <p className="red bench-err">✕ {erro.msg}</p>}
          <p className="bench-actions">
            {guiado ? (
              <>
                <button type="button" className="btn-stamp btn-main" onClick={() => void salvar()}>
                  Vincular (Ctrl+Enter)
                </button>{' '}
                <button
                  type="button"
                  className="btn-stamp"
                  onClick={() => {
                    setNova(true);
                    setTitulo((ev.description ?? '').slice(0, 120));
                  }}
                >
                  [n] Nova hipótese
                </button>{' '}
                <button type="button" className="btn-stamp" onClick={onFechar}>
                  Cancelar (Esc)
                </button>
              </>
            ) : (
              <span className="t2">↑↓ escolhe · a apoia · c contradiz · n nova · Ctrl+Enter grava · Esc fecha</span>
            )}
          </p>
        </>
      ) : (
        <>
          <label className="bench-l lbl t2" htmlFor="hip-titulo">
            TÍTULO
          </label>
          {guiado && <p className="bench-help t2">Uma frase curta com o que você acha que aconteceu. O evento entra como [EVIDÊNCIA] na sustentação.</p>}
          <input id="hip-titulo" ref={tituloRef} className="bench-in" value={titulo} onChange={(e) => setTitulo(e.target.value)} aria-invalid={erro?.campo === 'titulo'} />
          {erro?.campo === 'titulo' && <p className="red bench-err">✕ {erro.msg}</p>}
          <div className="bench-l lbl t2" id="hip-conf">
            CONFIANÇA
          </div>
          <div className="chips" role="radiogroup" aria-labelledby="hip-conf">
            {CONF.map((c) => (
              <button key={c.v} type="button" role="radio" aria-checked={conf === c.v} className={`chip${conf === c.v ? ' is-on' : ''}`} onClick={() => setConf(c.v)}>
                [{c.k}] {c.v.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="bench-ro">
            <span className="lbl t2">SUSTENTAÇÃO</span> [EVIDÊNCIA] {ev.raw_ref}
          </p>
          <p className="bench-actions">
            <button type="button" className="btn-stamp btn-main" onClick={() => void salvar()}>
              {guiado ? 'Criar hipótese (Ctrl+Enter)' : 'Ctrl+Enter cria'}
            </button>{' '}
            <button type="button" className="btn-stamp" onClick={() => setNova(false)}>
              {guiado ? 'Voltar à lista' : '◀ lista'}
            </button>
          </p>
        </>
      )}
      {avisoEsc && <p className="amber">Esc de novo fecha sem gravar</p>}
    </section>
  );
}
