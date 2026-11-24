// PROMOVER A ACHADO (brief §10, tecla `a`): no painel de detalhe alargado (60 col.).
// ■EVIDÊNCIA fixa · texto pré-preenchido com os fatos (mín. 20) · chips de técnica
// (marcar = confirmar; a técnica perde o "?" no app inteiro) · raw_ref somente leitura.
// Ctrl+Enter salva (POST /achados com versão); Esc: 1º avisa se houver texto, 2º descarta.
import { useEffect, useRef, useState } from 'react';
import type { PeritoEvent } from '../../lib/types';
import type { Modo } from '../../lib/mode';
import { ACHADO_MAX, textoAchado, validaAchado } from '../../lib/bancada';
import { ApiError, ConflitoError, api, describeError } from '../../lib/api';
import { type TacticOf, sortTechniques, tecnicaPt } from '../../lib/attack-pt';
import { ConflictPanel } from './ConflictPanel';
import type { MsgKind } from '../timeline/Timeline';

interface Props {
  caso: string;
  ev: PeritoEvent;
  modo: Modo;
  tacticOf: TacticOf;
  /** Texto inicial alternativo (ex.: título de hipótese confirmada). */
  textoInicial?: string;
  onSalvo(id: string): void;
  onFechar(): void;
  onMsg(text: string, kind?: MsgKind): void;
}

export function PromoteForm({ caso, ev, modo, tacticOf, textoInicial, onSalvo, onFechar, onMsg }: Props) {
  const guiado = modo === 'guiado';
  const inicial = useRef(textoInicial ? `${textoInicial} — ${textoAchado(ev)}`.slice(0, ACHADO_MAX) : textoAchado(ev));
  const [texto, setTexto] = useState(inicial.current);
  const [techs, setTechs] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [avisoEsc, setAvisoEsc] = useState(false);
  const [base, setBase] = useState<string | null>(null);
  const [conflito, setConflito] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const ordenadas = sortTechniques(ev.mitre, tacticOf);

  // Lê achados.md ao abrir: guarda o conteúdo (base do diff em caso de 409) e a versão.
  useEffect(() => {
    let vivo = true;
    api
      .doc(caso, 'achados')
      .then((d) => vivo && setBase(d.conteudo))
      .catch(() => vivo && setBase(null));
    taRef.current?.focus();
    return () => {
      vivo = false;
    };
  }, [caso]);

  const salvar = async () => {
    const e = validaAchado(texto);
    if (e) {
      setErro(e);
      taRef.current?.focus();
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const r = await api.criarAchado(caso, { idx: ev.idx, achado: texto.trim().replace(/\s+/g, ' '), attack: ordenadas.filter((t) => techs.has(t)) });
      onSalvo(r.id ?? '?');
    } catch (x) {
      if (x instanceof ConflitoError) setConflito(x.conflito.conteudoAtual);
      else if (x instanceof ApiError) {
        setErro(`${x.message}${x.detalhe ? ` — ${x.detalhe}` : ''}`);
        onMsg(`✕ ACHADO não gravado: ${describeError(x)}`, 'err');
        taRef.current?.focus();
      } else setErro(describeError(x));
    } finally {
      setSalvando(false);
    }
  };

  const recarregarEReaplicar = async () => {
    try {
      const d = await api.doc(caso, 'achados'); // nova versão
      setBase(d.conteudo);
      setConflito(null);
      await salvar();
    } catch (x) {
      setErro(describeError(x));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (/^F\d$/.test(e.key)) return;
    e.stopPropagation(); // a bancada tem o teclado só para si
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      void salvar();
      return;
    }
    if (e.key === 'Escape' && !conflito) {
      e.preventDefault();
      const sujo = texto !== inicial.current || techs.size > 0;
      if (sujo && !avisoEsc) {
        setAvisoEsc(true);
        onMsg('há texto digitado: Esc de novo descarta o achado', 'info');
        return;
      }
      onFechar();
    }
  };

  return (
    <section className="bench" aria-label="Promover a achado" onKeyDown={onKeyDown}>
      <header className="bench-h">
        <span className="lbl">PROMOVER A ACHADO</span> <span className="stamp stamp-evid">■EVIDÊNCIA</span>
      </header>
      {conflito !== null ? (
        <ConflictPanel arquivo="achados.md" base={base} atual={conflito} modo={modo} onRecarregar={() => void recarregarEReaplicar()} onManter={() => setConflito(null)} />
      ) : null}
      <label className="bench-l lbl t2" htmlFor="bench-texto">
        ACHADO
      </label>
      {guiado && <p className="bench-help t2">Descreva só o que o registro mostra, sem adjetivos. Vai para a tabela de achados.md.</p>}
      <textarea
        id="bench-texto"
        ref={taRef}
        className="bench-ta"
        rows={5}
        value={texto}
        maxLength={ACHADO_MAX + 50}
        aria-invalid={!!erro}
        aria-describedby="bench-texto-n bench-texto-err"
        onChange={(e) => {
          setTexto(e.target.value);
          setAvisoEsc(false);
        }}
      />
      <div className="bench-meta">
        <span id="bench-texto-n" className={texto.trim().length < 20 || texto.trim().length > ACHADO_MAX ? 'amber' : 't3'}>
          {texto.trim().length}/{ACHADO_MAX} · mín. 20
        </span>
      </div>
      {erro && (
        <p id="bench-texto-err" className="red bench-err" role="alert">
          ✕ {erro}
        </p>
      )}

      <div className="bench-l lbl t2" id="bench-tec">
        TÉCNICAS
      </div>
      {guiado && <p className="bench-help t2">Marque (Espaço) as técnicas que você confirma pelo registro. As marcadas perdem o "?" em todo o app.</p>}
      <div className="chips" role="group" aria-labelledby="bench-tec">
        {ordenadas.length === 0 && <span className="t3">sem técnica sugerida para este evento</span>}
        {ordenadas.map((t) => {
          const on = techs.has(t);
          return (
            <button
              key={t}
              type="button"
              role="checkbox"
              aria-checked={on}
              className={`chip${on ? ' is-on' : ''}`}
              onClick={() =>
                setTechs((s) => {
                  const n = new Set(s);
                  if (n.has(t)) n.delete(t);
                  else n.add(t);
                  return n;
                })
              }
              title={on ? 'confirmada: será gravada no achado' : 'sugerida: marque para confirmar'}
            >
              {on ? '✓' : '·'} {t}
              {on ? '' : '?'} <span className="t2">{tecnicaPt(t)}</span>
            </button>
          );
        })}
      </div>

      <div className="bench-l lbl t2">EVIDÊNCIA</div>
      <p className="bench-ro">
        <span className="stamp stamp-evid">■</span> <span>{ev.raw_ref}</span>
        {(ev.extra.corroborado_por ?? []).length > 0 && <span className="t3"> ; {(ev.extra.corroborado_por ?? []).join('; ')}</span>}
        <span className="t3"> · somente leitura</span>
      </p>

      <p className="bench-actions">
        {guiado ? (
          <>
            <button type="button" className="btn-stamp btn-main" onClick={() => void salvar()} disabled={false}>
              {salvando ? 'GRAVANDO …' : 'Salvar achado (Ctrl+Enter)'}
            </button>{' '}
            <button type="button" className="btn-stamp" onClick={onFechar}>
              Cancelar (Esc)
            </button>
          </>
        ) : (
          <span className="t2">{salvando ? 'GRAVANDO …' : 'Ctrl+Enter salva · Esc cancela · Espaço marca técnica'}</span>
        )}
        {avisoEsc && <span className="amber"> · Esc de novo descarta</span>}
      </p>
    </section>
  );
}
