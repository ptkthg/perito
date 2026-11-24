// REGISTRAR LIMITAÇÃO ([l], brief §10): limitação, impacto e mitigação pré-preenchidos,
// 3–400 caracteres cada → POST /limitacoes (com versão; 409 no padrão da bancada).
import { useEffect, useRef, useState } from 'react';
import { ApiError, ConflitoError, api, describeError } from '../../lib/api';
import type { Modo } from '../../lib/mode';
import { ConflictPanel } from './ConflictPanel';
import type { MsgKind } from '../../lib/msg';

export interface LimPrefill {
  limitacao: string;
  impacto: string;
  mitigacao: string;
}

interface Props {
  caso: string;
  modo: Modo;
  prefill: LimPrefill;
  onSalvo(msg: string): void;
  onFechar(): void;
  onMsg(text: string, kind?: MsgKind): void;
}

const CAMPOS: { k: keyof LimPrefill; rot: string; ajuda: string }[] = [
  { k: 'limitacao', rot: 'LIMITAÇÃO', ajuda: 'o que não temos dados para saber' },
  { k: 'impacto', rot: 'IMPACTO', ajuda: 'o que isso pode esconder na investigação' },
  { k: 'mitigacao', rot: 'MITIGAÇÃO', ajuda: 'como reduzir ou contornar a lacuna' },
];

export function LimForm({ caso, modo, prefill, onSalvo, onFechar, onMsg }: Props) {
  const guiado = modo === 'guiado';
  const [v, setV] = useState<LimPrefill>(prefill);
  const [erro, setErro] = useState<{ k: keyof LimPrefill | null; msg: string } | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [conflito, setConflito] = useState<string | null>(null);
  const refs = useRef<Partial<Record<keyof LimPrefill, HTMLTextAreaElement | null>>>({});

  useEffect(() => {
    let vivo = true;
    api
      .doc(caso, 'limitacoes')
      .then((d) => vivo && setBase(d.conteudo))
      .catch(() => vivo && setBase(null));
    refs.current.limitacao?.focus();
    return () => {
      vivo = false;
    };
  }, [caso]);

  const salvar = async () => {
    for (const c of CAMPOS) {
      const n = v[c.k].trim().length;
      if (n < 3 || n > 400) {
        setErro({ k: c.k, msg: `${c.rot.toLowerCase()} com 3 a 400 caracteres (tem ${n})` });
        refs.current[c.k]?.focus();
        return;
      }
    }
    setErro(null);
    try {
      const r = await api.criarLimitacao(caso, { limitacao: v.limitacao.trim(), impacto: v.impacto.trim(), mitigacao: v.mitigacao.trim() });
      onSalvo(`✓ LIMITAÇÃO ${r.id ?? ''} registrada → limitacoes.md`);
    } catch (x) {
      if (x instanceof ConflitoError) setConflito(x.conflito.conteudoAtual);
      else {
        const m = x instanceof ApiError ? `${x.message}${x.detalhe ? ` — ${x.detalhe}` : ''}` : describeError(x);
        setErro({ k: null, msg: m });
        onMsg(`✕ limitação não gravada: ${m}`, 'err');
      }
    }
  };

  return (
    <div
      className="bench cob-form"
      role="group"
      aria-label="Registrar limitação"
      onKeyDown={(e) => {
        if (/^F\d$/.test(e.key)) return;
        e.stopPropagation();
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          void salvar();
        } else if (e.key === 'Escape' && conflito === null) {
          e.preventDefault();
          onFechar();
        }
      }}
    >
      <p className="bench-h">
        <span className="lbl">REGISTRAR LIMITAÇÃO</span> <span className="stamp stamp-lim hatch">⊘LIM</span>
      </p>
      {conflito !== null && (
        <ConflictPanel
          arquivo="limitacoes.md"
          base={base}
          atual={conflito}
          modo={modo}
          onRecarregar={() =>
            void api.doc(caso, 'limitacoes').then((d) => {
              setBase(d.conteudo);
              setConflito(null);
              void salvar();
            })
          }
          onManter={() => setConflito(null)}
        />
      )}
      {CAMPOS.map((c) => (
        <div key={c.k}>
          <label className="bench-l lbl t2" htmlFor={`lim-${c.k}`}>
            {c.rot}
          </label>
          {guiado && <p className="bench-help t2">{c.ajuda}</p>}
          <textarea
            id={`lim-${c.k}`}
            ref={(el) => {
              refs.current[c.k] = el;
            }}
            className="bench-ta"
            rows={2}
            value={v[c.k]}
            aria-invalid={erro?.k === c.k}
            onChange={(e) => setV({ ...v, [c.k]: e.target.value.replace(/[\r\n]+/g, ' ') })}
          />
          {erro?.k === c.k && <p className="red bench-err">✕ {erro.msg}</p>}
        </div>
      ))}
      {erro && erro.k === null && <p className="red bench-err">✕ {erro.msg}</p>}
      <p className="bench-actions">
        <button type="button" className="btn-stamp btn-main" onClick={() => void salvar()}>
          {guiado ? 'Registrar limitação (Ctrl+Enter)' : 'Ctrl+Enter grava'}
        </button>{' '}
        <button type="button" className="btn-stamp" onClick={onFechar}>
          {guiado ? 'Cancelar (Esc)' : 'Esc'}
        </button>
      </p>
    </div>
  );
}
