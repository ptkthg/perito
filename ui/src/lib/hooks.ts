// Hooks utilitários: largura de caractere da fonte de dados e tamanho de elemento.
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

/** Largura de 1ch (px) da fonte de dados, medida depois que as fontes carregam. */
export function useCharWidth(): number {
  const [w, setW] = useState(6.5);
  useEffect(() => {
    let vivo = true;
    const measure = () => {
      const span = document.createElement('span');
      span.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-family:var(--font-data);font-size:var(--fs-data)';
      span.textContent = '0'.repeat(100);
      document.body.appendChild(span);
      const px = span.getBoundingClientRect().width / 100;
      span.remove();
      if (vivo && px > 0) setW(px);
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => undefined);
    // A fonte de dados escala com a largura da janela (clamp em tokens.css).
    window.addEventListener('resize', measure);
    return () => {
      vivo = false;
      window.removeEventListener('resize', measure);
    };
  }, []);
  return w;
}

/**
 * Observa largura/altura de um elemento (ResizeObserver) via callback ref,
 * para funcionar também quando o elemento só aparece depois do primeiro render.
 */
export function useElementSize<T extends HTMLElement>(): [(el: T | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const r0 = el.getBoundingClientRect();
    setSize({ w: r0.width, h: r0.height });
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  const ref = useCallback((node: T | null) => setEl(node), []);
  return [ref, size];
}

/**
 * Altura de linha efetiva (px inteiro) = densidade (18/20/24) × tamanho atual da fonte de dados / 13.
 * Escreve --row-h no <html> e devolve o valor para o virtualizador (altura fixa e exata).
 */
export function useEffectiveRowHeight(densidade: number): number {
  const calc = () => {
    const fs = Number.parseFloat(getComputedStyle(document.body).fontSize) || 13;
    return Math.max(densidade, Math.round((densidade * fs) / 13));
  };
  const [h, setH] = useState(calc);
  useLayoutEffect(() => {
    const apply = () => {
      const v = calc();
      document.documentElement.style.setProperty('--row-h', `${v}px`);
      setH(v);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [densidade]);
  return h;
}
