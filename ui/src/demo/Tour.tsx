import { useEffect, useRef, useState } from 'react';
import type { Visao } from '../lib/types';
import { navigate } from '../lib/route';
import { PASSOS, anterior, avancar } from './passos';

export function Tour({ passo, visao, onPasso, onSair }: { passo: number; visao: Visao; onPasso(n: number): void; onSair(): void }) {
  const step = PASSOS[passo]!;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [esperando, setEsperando] = useState(true);
  const next = () => { const n = avancar(passo); if (n === null) onSair(); else onPasso(n); };

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    setRect(null); setPos(null); setEsperando(true);
    navigate('TESTE-001', step.visao);
    const start = performance.now();
    let scrolled: Element | null = null;
    let frame = 0;
    const measure = () => {
      const alvo = document.querySelector<HTMLElement>(`[data-tour="${step.alvo}"]`);
      if (visao === step.visao && alvo && alvo.getBoundingClientRect().height > 0) {
        if (scrolled !== alvo) {
          alvo.scrollIntoView({ block: 'center', behavior: 'instant' });
          if (step.visao === 'timeline') {
            const detalhe = alvo.querySelector('.detail-body');
            if (detalhe) detalhe.scrollTop = detalhe.scrollHeight;
          }
          scrolled = alvo;
        }
        const r = alvo.getBoundingClientRect();
        // Recorte fica dentro da área útil, sem cobrir a faixa nem a barra de status.
        const top = Math.max(42, r.top), bottom = Math.min(window.innerHeight - 8, r.bottom);
        const left = Math.max(8, r.left), right = Math.min(window.innerWidth - 8, r.right);
        const nextRect = new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
        setRect(prev => prev && prev.x === nextRect.x && prev.y === nextRect.y && prev.width === nextRect.width && prev.height === nextRect.height ? prev : nextRect);
        setEsperando(false);
        const card = cardRef.current!;
        const w = card.offsetWidth, h = card.offsetHeight;
        // Prefere espaço abaixo, depois acima; em alvos altos, usa o canto inferior.
        const y = window.innerHeight - bottom > h + 24 ? bottom + 12 : top > h + 54 ? top - h - 12 : window.innerHeight - h - 20;
        const pos = { left: Math.max(12, Math.min(left + 16, window.innerWidth - w - 12)), top: Math.max(48, y) };
        setPos(prev => prev?.left === pos.left && prev.top === pos.top ? prev : pos);
      } else if (performance.now() - start >= 2000) {
        setRect(null); setPos(null); setEsperando(false);
      }
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [step, visao]);
  useEffect(() => { dialogRef.current?.querySelector<HTMLButtonElement>('[data-next]')?.focus(); }, [passo]);

  return <dialog ref={dialogRef} className="demo-tour" aria-labelledby="tour-title" onClose={() => { if (!dialogRef.current?.open) onSair(); }}
    onKeyDown={e => {
      e.stopPropagation();
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement))) { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onPasso(anterior(passo)); }
    }}>
    <svg className="demo-shade" width="100%" height="100%" aria-hidden="true">
      <defs><mask id="tour-hole"><rect width="100%" height="100%" fill="white" />{rect && <rect x={rect.left - 4} y={rect.top - 4} width={rect.width + 8} height={rect.height + 8} fill="black" />}</mask></defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,.76)" mask="url(#tour-hole)" />
      {rect && <rect x={rect.left - 4} y={rect.top - 4} width={rect.width + 8} height={rect.height + 8} fill="none" stroke="var(--amber)" />}
    </svg>
    <section ref={cardRef} className={`demo-tour-card${pos ? '' : ' is-centered'}`} style={pos ?? undefined}>
      <div aria-live="polite" aria-atomic="true">
        <p className="demo-step">Passo {passo + 1}/7{esperando ? ' · localizando…' : ''}</p>
        <h1 id="tour-title">{step.titulo}</h1>
        <h2>O que você está vendo</h2><p>{step.vendo}</p>
        <h2>Por que isso importa</h2><p>{step.importa}</p>
        {!esperando && !rect && <p>O destaque não está disponível nesta tela. Você pode continuar o tour.</p>}
      </div>
      <nav aria-label="Navegação do tour">
        <button type="button" disabled={passo === 0} onClick={() => onPasso(anterior(passo))}>Voltar</button>
        <button type="button" data-next onClick={next}>{passo === 6 ? 'Concluir' : 'Próximo'}</button>
        <button type="button" onClick={onSair}>Sair (Esc)</button>
      </nav>
    </section>
  </dialog>;
}
