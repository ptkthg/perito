// Abas F1…F9. Teclas F1–F9 e g1…g9 (tratadas no CaseShell).
import type { Visao } from '../lib/types';
import { VISOES, hrefFor } from '../lib/route';

export function Tabs({ caso, visao }: { caso: string; visao: Visao }) {
  return (
    <nav className="tabs" aria-label="Visões">
      {VISOES.map((v, i) => (
        <span key={v.key} className="tab-wrap">
          {i > 0 && (
            <span className="t3" aria-hidden>
              │
            </span>
          )}
          <a
            href={hrefFor(caso, v.key)}
            className={`tab lbl${v.key === visao ? ' is-active' : ''}`}
            aria-current={v.key === visao ? 'page' : undefined}
            aria-keyshortcuts={v.tecla}
          >
            <span className="tab-key">{v.tecla}</span> {v.rotulo}
          </a>
        </span>
      ))}
    </nav>
  );
}
