// Markdown dos documentos do caso (escopo, revisões, relatórios) em estilo console.
// Segurança: markdown-it com html:false (HTML bruto vira texto), imagens desligadas,
// links externos viram texto (só links internos "#/..." continuam clicáveis).
// As tags metodológicas viram carimbos (■EVID ◇HIP ⊘LIM), como no RichText.
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });
md.disable(['image']);

const linkOpen = md.renderer.rules.link_open;
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = String(tokens[idx]!.attrGet('href') ?? '');
  if (href.startsWith('#/')) {
    return linkOpen ? linkOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  }
  tokens[idx]!.meta = { ...(tokens[idx]!.meta ?? {}), desativado: true };
  return `<span class="link-off" title="link externo desativado: ${md.utils.escapeHtml(href)}">`;
};
md.renderer.rules.link_close = (tokens, idx, options, _env, self) => {
  // procura o link_open correspondente (mesmo nível) para saber se foi desativado
  let nivel = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.type === 'link_close') nivel++;
    if (t.type === 'link_open') {
      if (nivel === 0) return t.meta?.desativado ? '</span>' : self.renderToken(tokens, idx, options);
      nivel--;
    }
  }
  return self.renderToken(tokens, idx, options);
};

const TAGS: [RegExp, string][] = [
  [/\[EVID[EÊ]NCIA\]/gi, '<span class="stamp stamp-evid" title="comprovado nos registros">■EVID</span>'],
  [/\[HIP[OÓ]TESE\]/gi, '<span class="stamp stamp-hip" title="suposição ainda não comprovada">◇HIP</span>'],
  [/\[LIMITA[CÇ][AÃ]O\]/gi, '<span class="stamp stamp-lim hatch" title="não temos dados para saber">⊘LIM</span>'],
];

/** Markdown → HTML seguro (o texto do documento nunca injeta HTML próprio). */
export function renderMarkdown(texto: string): string {
  let html = md.render(texto.replace(/<!--[\s\S]*?-->/g, ''));
  for (const [re, rep] of TAGS) html = html.replace(re, rep);
  return html;
}
