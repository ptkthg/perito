// Conflito 409 (brief §10): o texto do analista nunca se perde; não existe "sobrescrever".
//   ✕ CONFLITO <arquivo> mudou depois que você abriu
//   diff mínimo (o que você tinha → o que está no disco agora)
//   [r] recarregar e reaplicar meu texto · [d] diff completo · [Esc] manter bancada
import { useEffect, useMemo, useRef, useState } from 'react';
import { diffLinhas, diffMinimo } from '../../lib/bancada';
import type { Modo } from '../../lib/mode';

interface Props {
  arquivo: string;
  /** Conteúdo que você tinha ao abrir (null = desconhecido). */
  base: string | null;
  atual: string;
  modo: Modo;
  onRecarregar(): void;
  onManter(): void;
}

const MAX_MIN = 14;

export function ConflictPanel({ arquivo, base, atual, modo, onRecarregar, onManter }: Props) {
  const [completo, setCompleto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const linhas = useMemo(() => {
    if (completo) return diffLinhas(base ?? '', atual);
    const m = diffMinimo(base ?? '', atual);
    return m.length > MAX_MIN ? [...m.slice(0, MAX_MIN), null] : m;
  }, [base, atual, completo]);
  const mudou = linhas.filter((l) => l && l.op !== ' ').length;

  return (
    <div
      className="conflict"
      role="alert"
      tabIndex={-1}
      ref={ref}
      onKeyDown={(e) => {
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        if (e.key === 'r') {
          e.preventDefault();
          e.stopPropagation();
          onRecarregar();
        } else if (e.key === 'd') {
          e.preventDefault();
          e.stopPropagation();
          setCompleto((c) => !c);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onManter();
        }
      }}
    >
      <p className="conflict-h">
        <span className="red">✕ CONFLITO</span> <span className="lbl">{arquivo}</span> <span>mudou depois que você abriu</span>
      </p>
      {modo === 'guiado' && (
        <p className="t2 bench-help">
          Outra pessoa ou um agente gravou neste arquivo. Seu texto continua aqui; nada foi gravado. Veja abaixo o que mudou e escolha como seguir.
        </p>
      )}
      {base === null && <p className="t3">(versão que você abriu indisponível: mostrando só o conteúdo atual)</p>}
      <pre className="diff" aria-label={`diferenças em ${arquivo}`}>
        {linhas.length === 0 && <span className="t3">sem diferença visível (só metadados mudaram)</span>}
        {linhas.map((l, i) =>
          l === null ? (
            <span key={i} className="t3 diff-gap">
              …{'\n'}
            </span>
          ) : (
            <span key={i} className={l.op === '+' ? 'diff-add' : l.op === '-' ? 'diff-del' : 't3'}>
              {l.op} {l.linha}
              {'\n'}
            </span>
          ),
        )}
      </pre>
      <p className="t2 conflict-sum">
        {mudou} linha(s) diferente(s){completo ? ' · diff completo' : ' · diff mínimo'}
      </p>
      <p className="bench-actions">
        <button type="button" className="btn-stamp" onClick={onRecarregar}>
          [r] recarregar e reaplicar meu texto
        </button>{' '}
        <button type="button" className="btn-stamp" onClick={() => setCompleto((c) => !c)}>
          [d] {completo ? 'diff mínimo' : 'diff completo'}
        </button>{' '}
        <button type="button" className="btn-stamp" onClick={onManter}>
          [Esc] manter bancada
        </button>
      </p>
    </div>
  );
}
