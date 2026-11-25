import { useEffect, useRef, useState } from 'react';
import { GLOSSARIO, STATUS_TERMOS, termoParaRotulo } from './glossario';

/** Enriquece os rótulos existentes sem acrescentar imports da demo ao console normal. */
export function DemoTooltips() {
  const [tip, setTip] = useState<{ termo: string; x: number; y: number } | null>(null);
  const current = useRef<HTMLElement | null>(null);
  const dismiss = useRef<() => void>(() => {});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const originals = new Map<HTMLElement, { tabindex: string | null; describedby: string | null; title: string | null }>();
    const refresh = () => {
      document.querySelectorAll<HTMLElement>('.status .lbl, .tabs .tab').forEach(el => {
        if (el.parentElement?.closest('.status .lbl')) return;
        const text = el.textContent?.trim() ?? '';
        const label = el.matches('.tab') ? text.replace(/^\S+\s+/, '') : STATUS_TERMOS.find(s => text.includes(s)) ?? '';
        const termo = termoParaRotulo(label);
        if (!termo) return;
        if (!originals.has(el)) originals.set(el, { tabindex: el.getAttribute('tabindex'), describedby: el.getAttribute('aria-describedby'), title: el.getAttribute('title') });
        el.dataset.demoTermo = termo;
        if (!el.matches('a, button')) el.tabIndex = 0;
        el.removeAttribute('title');
      });
    };
    const hide = () => {
      if (timer.current) clearTimeout(timer.current);
      const el = current.current;
      if (el) {
        const original = originals.get(el)?.describedby;
        if (original) el.setAttribute('aria-describedby', original); else el.removeAttribute('aria-describedby');
      }
      current.current = null;
      setTip(null);
    };
    const show = (e: Event) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-demo-termo]') : null;
      if (!el) return;
      hide();
      current.current = el;
      el.setAttribute('aria-describedby', [originals.get(el)?.describedby, 'demo-tooltip'].filter(Boolean).join(' '));
      const rect = el.getBoundingClientRect();
      setTip({ termo: el.dataset.demoTermo!, x: Math.max(8, Math.min(rect.left, window.innerWidth - 328)), y: rect.bottom + 8 });
    };
    dismiss.current = hide;
    const leave = (e: Event) => {
      const related = (e as MouseEvent | FocusEvent).relatedTarget;
      if (related instanceof Element && (related.closest('#demo-tooltip') || related.closest('[data-demo-termo]') === current.current)) return;
      timer.current = setTimeout(hide, 150);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && current.current) { e.preventDefault(); e.stopImmediatePropagation(); hide(); }
    };
    refresh();
    const observer = new MutationObserver(refresh);
    document.querySelectorAll('.status, .tabs').forEach(el => observer.observe(el, { childList: true, subtree: true, characterData: true }));
    document.addEventListener('mouseover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('mouseout', leave);
    document.addEventListener('focusout', leave);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', hide);
    return () => {
      observer.disconnect();
      hide();
      document.removeEventListener('mouseover', show);
      document.removeEventListener('focusin', show);
      document.removeEventListener('mouseout', leave);
      document.removeEventListener('focusout', leave);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', hide);
      for (const [el, attrs] of originals) {
        delete el.dataset.demoTermo;
        for (const [name, value] of [['tabindex', attrs.tabindex], ['aria-describedby', attrs.describedby], ['title', attrs.title]]) {
          if (value === null) el.removeAttribute(name!); else el.setAttribute(name!, value!);
        }
      }
    };
  }, []);
  return tip && <div id="demo-tooltip" role="tooltip" className="demo-tooltip" style={{ left: tip.x, top: tip.y }}
    onMouseEnter={() => { if (timer.current) clearTimeout(timer.current); }} onMouseLeave={() => dismiss.current()}>
    <strong>{tip.termo}</strong><p>{GLOSSARIO[tip.termo]}</p>
  </div>;
}
