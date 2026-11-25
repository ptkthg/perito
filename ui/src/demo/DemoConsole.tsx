import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Visao } from '../lib/types';
import { GLOSSARIO } from './glossario';
import { primeiraVisita, registrarVisita } from './passos';
import { Tour } from './Tour';
import { DemoTooltips } from './DemoTooltips';

function Glossario({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog className="demo-glossario" ref={ref} onClose={() => { if (!ref.current?.open) onClose(); }} onKeyDown={e => e.stopPropagation()} aria-labelledby="glossario-titulo">
    <header><h1 id="glossario-titulo">Glossário</h1><button autoFocus type="button" onClick={() => ref.current?.close()}>Fechar (Esc)</button></header>
    <dl>{Object.keys(GLOSSARIO).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(termo => <div key={termo}><dt>{termo}</dt><dd>{GLOSSARIO[termo]}</dd></div>)}</dl>
  </dialog>;
}

export function DemoConsole({ children, visao }: { children(passo: number | null): ReactNode; visao: Visao }) {
  const [passo, setPasso] = useState<number | null>(() => {
    try { return primeiraVisita(window.localStorage) ? 0 : null; } catch { return 0; }
  });
  const [glossario, setGlossario] = useState(false);
  const tourButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (passo !== null) {
      try { registrarVisita(window.localStorage); } catch { /* armazenamento bloqueado */ }
    }
  }, [passo]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (passo !== null || glossario) return;
      const el = e.target;
      if (el instanceof HTMLElement && (el.matches('input, textarea, select') || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 't' || e.key === '?') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === 't') setPasso(0); else setGlossario(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [passo, glossario]);
  return <div className="demo-console">
    <aside className="demo-banner" aria-label="Demonstração">
      <span>DEMO · caso fictício · somente leitura</span>
      <nav><button ref={tourButton} type="button" onClick={() => setPasso(0)}>Tour (t)</button><button type="button" onClick={() => setGlossario(true)}>Glossário (?)</button><a href="#/">Sobre</a></nav>
    </aside>
    {children(passo)}
    {passo !== null && <Tour passo={passo} visao={visao} onPasso={setPasso} onSair={() => {
      setPasso(null);
      requestAnimationFrame(() => tourButton.current?.focus());
    }} />}
    {glossario && <Glossario onClose={() => setGlossario(false)} />}
    {passo === null && !glossario && <DemoTooltips />}
  </div>;
}
