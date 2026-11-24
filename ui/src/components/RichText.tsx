// Texto do analista (markdown leve) com tags metodológicas como carimbos e refs clicáveis.
//   [EVIDÊNCIA] → ■EVID   [HIPÓTESE] → ◇HIP   [LIMITAÇÃO] → ⊘LIM
//   arquivo.csv:15-17 / arquivo.json#3 / A6 → link ciano que abre a F1 nos eventos
import { Fragment } from 'react';
import { splitRefs } from '../lib/refs';

const TOKEN = /(\[(?:EVID[EÊ]NCIA|HIP[OÓ]TESE|LIMITA[CÇ][AÃ]O)\]|\*\*[^*]+\*\*|`[^`]+`)/giu;

interface Props {
  text: string;
  /** Sem callback, refs aparecem como texto comum. */
  onRef?(ref: string): void;
}

function Refs({ text, onRef }: Props) {
  if (!onRef) return <>{text}</>;
  return (
    <>
      {splitRefs(text).map((p, i) =>
        p.tipo === 'texto' ? (
          <Fragment key={i}>{p.v}</Fragment>
        ) : (
          <button key={i} type="button" className="pivot" onClick={() => onRef(p.v)} title={p.tipo === 'achado' ? `abrir evidências de ${p.v} na timeline` : `abrir ${p.v} na timeline`}>
            {p.v}
          </button>
        ),
      )}
    </>
  );
}

export function RichText({ text, onRef }: Props) {
  const parts = text.split(TOKEN);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        const up = p.toUpperCase();
        if (/^\[EVID/.test(up)) return <span key={i} className="stamp stamp-evid" title="comprovado nos registros">■EVID</span>;
        if (/^\[HIP/.test(up)) return <span key={i} className="stamp stamp-hip" title="suposição ainda não comprovada">◇HIP</span>;
        if (/^\[LIMITA/.test(up)) return <span key={i} className="stamp stamp-lim hatch" title="não temos dados para saber">⊘LIM</span>;
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}><Refs text={p.slice(2, -2)} onRef={onRef} /></strong>;
        if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
        return <Refs key={i} text={p} onRef={onRef} />;
      })}
    </>
  );
}
