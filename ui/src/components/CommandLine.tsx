// Linha de comando inferior: prompt "> " (ou "/" na busca), cursor de bloco,
// texto fantasma, até 8 sugestões com contagem, Tab completa (repetido: alterna),
// ↑/↓ histórico, Enter executa, Esc em camadas.
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { suggest, type SuggestCtx } from '../lib/commands';

export type PromptMode = 'cmd' | 'search';

export interface CommandLineHandle {
  focus(prefill?: string, mode?: PromptMode): void;
  isFocused(): boolean;
}

interface Props {
  ctx: SuggestCtx;
  /** Executa; devolve true se deu certo (limpa o prompt e devolve o foco à visão). */
  onExecute(text: string): boolean;
  onSearch(term: string): void;
  onSearchCommit(term: string): void;
  onSearchCancel(): void;
  /** Esc com o prompt vazio: devolve o foco à visão ativa. */
  onLeave(): void;
}

interface TabState {
  base: string;
  i: number;
}

export const CommandLine = forwardRef<CommandLineHandle, Props>(function CommandLine(props, ref) {
  const { ctx, onExecute, onSearch, onSearchCommit, onSearchCancel, onLeave } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<PromptMode>('cmd');
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const [tab, setTab] = useState<TabState | null>(null);
  const history = useRef<string[]>([]);
  const hIdx = useRef<number>(-1);
  const draft = useRef('');

  useImperativeHandle(ref, () => ({
    focus(prefill?: string, m: PromptMode = 'cmd') {
      setMode(m);
      if (prefill !== undefined) {
        setValue(prefill);
        setCaret(prefill.length);
      }
      setTab(null);
      hIdx.current = -1;
      // Foco síncrono: teclas digitadas logo após ">" já caem no input, nunca na grade.
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      if (prefill !== undefined) el.value = prefill;
      const n = el.value.length;
      el.setSelectionRange(n, n);
    },
    isFocused: () => document.activeElement === inputRef.current,
  }));

  // Sugestões calculadas sobre o texto-base (antes do ciclo de Tab).
  const sugg = useMemo(() => {
    if (mode !== 'cmd' || !focused) return { items: [], tokenStart: 0, token: '' };
    return suggest(tab ? tab.base : value, ctx);
  }, [mode, value, tab, ctx, focused]);

  const activeIdx = tab ? tab.i % Math.max(1, sugg.items.length) : 0;
  const ghost = useMemo(() => {
    if (!focused || tab || mode !== 'cmd' || caret !== value.length) return '';
    const s = sugg.items[0];
    if (!s) return '';
    if (!s.text.toLowerCase().startsWith(sugg.token.toLowerCase())) return '';
    return s.text.slice(sugg.token.length);
  }, [focused, tab, mode, caret, value, sugg]);

  const set = (v: string) => {
    setValue(v);
    setCaret(v.length);
  };

  const applySuggestion = (i: number) => {
    const base = tab ? tab.base : value;
    const s = suggest(base, ctx);
    const item = s.items[i % Math.max(1, s.items.length)];
    if (!item) return;
    set(base.slice(0, s.tokenStart) + item.text);
    setTab({ base, i });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    // Teclas de função e Ctrl+=/- sobem para o atalho global.
    if (/^F\d$/.test(e.key)) return;
    if (e.ctrlKey && (e.key === '=' || e.key === '+' || e.key === '-')) return;
    if (e.key === 'Tab') {
      if (mode !== 'cmd') return;
      e.preventDefault();
      e.stopPropagation();
      if (sugg.items.length === 0) return;
      applySuggestion(tab ? tab.i + (e.shiftKey ? sugg.items.length - 1 : 1) : 0);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (mode === 'search') {
        onSearchCommit(value);
        setMode('cmd');
        set('');
        onLeave();
        return;
      }
      const text = value.trim();
      if (!text) {
        onLeave();
        return;
      }
      if (history.current[history.current.length - 1] !== text) history.current.push(text);
      hIdx.current = -1;
      setTab(null);
      if (onExecute(text)) {
        set('');
        onLeave();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (tab) {
        set(tab.base);
        setTab(null);
        return;
      }
      if (mode === 'search') {
        onSearchCancel();
        setMode('cmd');
        set('');
        onLeave();
        return;
      }
      if (value) {
        set('');
        return;
      }
      onLeave();
      return;
    }
    if (mode === 'cmd' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      const h = history.current;
      if (!h.length) return;
      if (e.key === 'ArrowUp') {
        if (hIdx.current === -1) {
          draft.current = value;
          hIdx.current = h.length - 1;
        } else hIdx.current = Math.max(0, hIdx.current - 1);
        set(h[hIdx.current] ?? '');
      } else {
        if (hIdx.current === -1) return;
        hIdx.current += 1;
        if (hIdx.current >= h.length) {
          hIdx.current = -1;
          set(draft.current);
        } else set(h[hIdx.current] ?? '');
      }
      setTab(null);
      return;
    }
    if (e.key === 'ArrowRight' && ghost && el.selectionStart === value.length) {
      e.preventDefault();
      set(value + ghost);
      return;
    }
    if (e.key === 'Backspace' && !value && mode === 'search') {
      e.preventDefault();
      onSearchCancel();
      setMode('cmd');
      onLeave();
      return;
    }
    e.stopPropagation();
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    setCaret(e.target.selectionStart ?? v.length);
    setTab(null);
    hIdx.current = -1;
    if (mode === 'search') onSearch(v);
  };

  const syncCaret = () => setCaret(inputRef.current?.selectionStart ?? value.length);

  const before = value.slice(0, caret);
  const atCaret = value.slice(caret, caret + 1) || ' ';
  const after = value.slice(caret + 1);

  return (
    <div className="cmd">
      <div className="cmd-sugg" aria-hidden={sugg.items.length === 0}>
        {mode === 'search' ? (
          <span className="t3">busca incremental no texto da timeline · ↵ confirma · n/N próximo/anterior · Esc cancela</span>
        ) : (
          sugg.items.map((s, i) => (
            <button
              key={s.text}
              type="button"
              tabIndex={-1}
              className={`sugg${tab && i === activeIdx ? ' is-active' : ''}`}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => applySuggestion(i)}
            >
              <span>{s.label}</span>
              {s.count !== undefined && <span className="t3"> ({s.count})</span>}
            </button>
          ))
        )}
      </div>
      <div className={`cmd-line${focused ? ' is-focused' : ''}`}>
        <span className="cmd-prompt amber" aria-hidden>
          {mode === 'search' ? '/' : '>'}
        </span>
        <span className="cmd-field">
          <span className="cmd-mirror" aria-hidden>
            {before}
            <span className={`cursor${focused ? ' is-on' : ''}`}>{atCaret}</span>
            {ghost ? <span className="t3">{ghost}</span> : after}
          </span>
          <input
            ref={inputRef}
            className="cmd-input"
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onSelect={syncCaret}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              setTab(null);
            }}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-label={mode === 'search' ? 'Busca incremental na timeline' : 'Linha de comando'}
            aria-describedby="cmd-hint"
          />
        </span>
        <span id="cmd-hint" className="cmd-hint t3">
          {focused ? 'Tab completa · ↵ executa · Esc cancela' : '> ou : comando · / busca · ? ajuda'}
        </span>
      </div>
    </div>
  );
});
