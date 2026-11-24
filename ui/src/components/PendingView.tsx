// Visão ainda não construída: estado inline em texto, sem ilustração.
import type { Visao } from '../lib/types';
import { VISOES } from '../lib/route';

export function PendingView({ visao }: { visao: Visao }) {
  const v = VISOES.find((x) => x.key === visao);
  if (!v) return null;
  return (
    <section className="pending" aria-label={`${v.rotulo} pendente`}>
      <p>
        <span className="lbl">
          {v.tecla} {v.rotulo}
        </span>{' '}
        <span className="t3">▮</span> <span className="lbl amber">PENDENTE</span>{' '}
        <span className="t2">(entrega {v.entrega})</span>
      </p>
      <p className="t3">F1 volta à timeline · ? mostra o mapa de teclas</p>
    </section>
  );
}
