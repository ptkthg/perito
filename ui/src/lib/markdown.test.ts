import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('markdown seguro', () => {
  it('HTML bruto vira texto (html:false)', () => {
    const h = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(h).not.toContain('<script>');
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;script&gt;');
  });
  it('links externos desativados, internos mantidos, imagens desligadas', () => {
    const h = renderMarkdown('[fora](https://exemplo.test/x) e [dentro](#/caso/X/timeline) e ![i](https://exemplo.test/i.png)');
    expect(h).not.toContain('href="https://exemplo.test/x"');
    expect(h).toContain('class="link-off"');
    expect(h).toContain('href="#/caso/X/timeline"');
    expect(h).not.toContain('<img');
  });
  it('tabelas e tags como carimbos', () => {
    const h = renderMarkdown('| a | b |\n|---|---|\n| x [EVIDÊNCIA] | y [HIPÓTESE] |\n\nfim [LIMITAÇÃO]');
    expect(h).toContain('<table>');
    expect(h).toContain('■EVID');
    expect(h).toContain('◇HIP');
    expect(h).toContain('⊘LIM');
  });
});
