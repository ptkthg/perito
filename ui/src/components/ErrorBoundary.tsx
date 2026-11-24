// ErrorBoundary no estilo console: nunca deixa a tela preta.
//   ERRO ▮ <visão> ▮ <mensagem> ▮ [r] recarregar visão ▮ [R] recarregar app
// Stack recolhido e expansível. Em dev, ?forcar-erro=<visão> força um erro até o [r] desarmar.
import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Nome exibido (ex.: TIMELINE, VISÃO GERAL, APP). */
  label: string;
  /** Chave usada por ?forcar-erro=<chave> em dev (ex.: timeline, app). */
  chave: string;
  children: ReactNode;
}

interface State {
  err: Error | null;
  componentStack: string | null;
  geracao: number;
}

const desarmados = new Set<string>();

/** Lança enquanto ?forcar-erro=<chave> estiver armado (somente em desenvolvimento). */
function ForcarErro({ chave }: { chave: string }) {
  if (import.meta.env.DEV) {
    const alvo = new URLSearchParams(location.search).get('forcar-erro');
    if (alvo === chave && !desarmados.has(chave)) {
      throw new Error(`erro forçado para teste (?forcar-erro=${chave})`);
    }
  }
  return null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null, componentStack: null, geracao: 0 };

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    console.error(`[perito] erro em ${this.props.label}:`, err);
  }

  // Erro já na montagem: o React chama didMount (não didUpdate) com o estado de erro.
  componentDidMount(): void {
    if (this.state.err) window.addEventListener('keydown', this.onKey, true);
  }

  componentDidUpdate(_: Props, prev: State): void {
    if (this.state.err && !prev.err) window.addEventListener('keydown', this.onKey, true);
    if (!this.state.err && prev.err) window.removeEventListener('keydown', this.onKey, true);
  }

  componentWillUnmount(): void {
    window.removeEventListener('keydown', this.onKey, true);
  }

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'r') {
      e.preventDefault();
      e.stopPropagation();
      this.recarregarVisao();
    } else if (e.key === 'R') {
      e.preventDefault();
      e.stopPropagation();
      location.reload();
    }
  };

  recarregarVisao = () => {
    desarmados.add(this.props.chave);
    this.setState((s) => ({ err: null, componentStack: null, geracao: s.geracao + 1 }));
  };

  render() {
    const { err, componentStack, geracao } = this.state;
    if (!err) {
      return (
        <Fragment key={geracao}>
          <ForcarErro chave={this.props.chave} />
          {this.props.children}
        </Fragment>
      );
    }
    const msg = err.message || String(err);
    return (
      <div className="errb" role="alert">
        <p className="errb-line">
          <span className="lbl errb-tag">ERRO</span> <span className="sep">▮</span> <span className="lbl">{this.props.label}</span>{' '}
          <span className="sep">▮</span> <span className="red errb-msg">{msg}</span> <span className="sep">▮</span>{' '}
          <button type="button" className="btn-stamp" onClick={this.recarregarVisao}>
            [r] recarregar visão
          </button>{' '}
          <span className="sep">▮</span>{' '}
          <button type="button" className="btn-stamp" onClick={() => location.reload()}>
            [R] recarregar app
          </button>
        </p>
        <details className="errb-stack">
          <summary className="t2">stack (para relatar o problema)</summary>
          <pre>
            {err.stack ?? msg}
            {componentStack ? `\n\ncomponentes:${componentStack}` : ''}
          </pre>
        </details>
      </div>
    );
  }
}
