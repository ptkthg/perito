# Spec 08: demonstração pública para recrutador (apresentação, tour guiado, glossário)

**Implementador:** Codex. **Revisor:** Claude.
**Leia antes:**
- `AGENTS.md`;
- `ui/src/lib/api.ts` (modo fixtures, `VITE_FIXTURES`);
- `ui/src/lib/route.ts` (rotas por hash, `VISOES`);
- `ui/src/lib/mode.ts` (modos guiado e analista);
- `ui/src/components/{CaseShell,StatusBar,Tabs,HelpOverlay}.tsx`;
- `ui/src/views/overview/Overview.tsx`, `ui/src/views/timeline/*`;
- `ui/vite.config.ts`.

**Não toque em** `src/perito/` (Python), `samples/` e `casos/`. Os fixtures do `ui/public/fixtures/TESTE-001/`
podem ser lidos, mas não alterados.

## Objetivo
O console do Perito é denso e feito para analistas: teclas F0 a F9, siglas, timeline com 50 eventos. Um
recrutador ou gestor técnico que abra a demo pública precisa entender **em 2 minutos** o que é o projeto,
o que olhar e por que aquilo mostra competência, sem precisar saber DFIR.

**Princípio:** o console do analista não muda. Tudo o que esta spec cria só existe quando `VITE_DEMO=1`,
que também liga o modo fixtures. O build normal (`npm run build`, servido por `perito ui`) precisa sair
com o mesmo comportamento de hoje.

## 1. Build de demonstração
- Script `build:demo` em `ui/package.json`: `tsc --noEmit && vite build --mode demo`.
- `ui/.env.demo` com `VITE_DEMO=1`, `VITE_FIXTURES=1` e `VITE_FIXTURES_CASO=TESTE-001`.
- `vite.config.ts`: em `mode === 'demo'`, a saída vai para `ui/dist-demo/` e `copyPublicDir: true`, para os
  fixtures entrarem. Nos outros modos, nada muda.
- O `postbuild.mjs` atual não pode quebrar o build demo: ajuste para ele só agir no build normal, se for o caso.
- `ui/vercel.json`, usado na publicação com Root Directory `ui`:
  - `buildCommand`: `npm run build:demo`; `outputDirectory`: `dist-demo`;
  - `headers` para `/(.*)`:
    - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`;
    - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
      `Referrer-Policy: strict-origin-when-cross-origin`,
      `Permissions-Policy: camera=(), microphone=(), geolocation=()`,
      `Cross-Origin-Opener-Policy: same-origin`.
  - A demo não pode depender de nenhum recurso externo.
- `.gitignore`: acrescentar `ui/dist-demo/`.

## 2. Página de apresentação (rota `#/` no modo demo)
No modo demo, `#/` mostra a apresentação no lugar da lista de casos. Ela segue a estética do console
(mesmas fontes, tokens e cores de `styles/tokens.css`) e é **responsiva**, de 360 a 1920 px. Conteúdo em
pt-BR, frases curtas, sem jargão sem explicação:

1. **Topo:**
   - "PERITO // console de resposta a incidentes";
   - frase: "Junta as evidências de 7 ferramentas de segurança numa linha do tempo única, com prova de
     integridade e mapeamento de técnicas de ataque";
   - aviso: "Caso fictício · dados 100% sintéticos · somente leitura".
2. **O problema** (3 itens):
   - num incidente real, as pistas estão espalhadas em ferramentas diferentes, cada uma com seu formato;
   - os horários vêm em fusos diferentes;
   - o que se conclui precisa resistir a auditoria e ao jurídico.
3. **O que o Perito faz** (4 cartões):
   - normaliza 7 fontes (Defender, Sentinel, Entra ID, Splunk, Elastic, Wazuh);
   - monta uma timeline única em UTC;
   - preserva a cadeia de custódia com SHA-256;
   - sugere técnicas do MITRE ATT&CK, que o analista confirma.
4. **Como foi construído:**
   - Python só com biblioteca padrão nos parsers e na CLI;
   - console React 19 + TypeScript;
   - números de testes;
   - desenvolvimento guiado por specs, com Claude Code e Codex se revisando
     (link para `docs/tasks/` no GitHub).
   Os números de testes vêm de constantes em um único arquivo (`ui/src/demo/conteudo.ts`), com um
   comentário dizendo como atualizar. Use os valores medidos no fim desta tarefa: `pytest` e `vitest`.
5. **Botões:**
   - "Abrir a demonstração" → `#/caso/TESTE-001/visao`, que inicia o tour na primeira visita;
   - "Código no GitHub" → `https://github.com/ptkthg/perito`;
   - "Portfólio do autor" → `https://portfolioptk.vercel.app`.
6. **Rodapé:** licença MIT e o aviso de dados sintéticos.

## 3. Faixa de demonstração no console
Barra fina fixa no topo do console, só no modo demo: "DEMO · caso fictício · somente leitura", mais os
botões **Tour (t)**, **Glossário (?)** e **Sobre** (volta para `#/`).
- Ela não pode cobrir a barra de status nem roubar teclas do console.
- O atalho `t` só funciona quando o foco não está num campo de texto.

## 4. Tour guiado (7 passos)
- Componente de "spotlight": escurece a tela, recorta o elemento alvo e mostra um balão.
- Os alvos usam atributos `data-tour="<id>"`, acrescentados aos elementos existentes. Esses atributos são
  inofensivos fora do demo e podem ficar sempre.
- O balão tem:
  - passo N/7;
  - título;
  - "o que você está vendo" (1 ou 2 frases);
  - "por que isso importa" (1 frase, ligando a uma competência);
  - botões Voltar, Próximo e Sair.
- Teclado: setas e Enter navegam, Esc sai. Foco gerenciado e `aria-live` no texto do passo.
- O tour navega pela rota (`location.hash`) até a visão do passo antes de destacar o alvo. Se o alvo
  não existir em até 2 s, o passo mostra o balão centralizado em vez de travar.
- Abre sozinho na primeira entrada no console da demo (`localStorage`: `perito-demo-tour=visto`) e
  pode ser reaberto pela faixa ou pela tecla `t`.

Passos (as explicações são para leigos):
1. **Visão geral: o mapa do ataque.** O caminho do invasor em 8 passos, da entrada à saída de dados.
   *Importa:* transformar 50 eventos soltos numa história que a gestão entende.
2. **Fases do ataque.** Cada coluna é uma etapa típica de ataque; "não observado" é dito explicitamente.
   *Importa:* honestidade sobre o que os dados mostram e o que não mostram.
3. **Dá para confiar nos dados?** Custódia SHA-256 e a janela de cobertura de cada fonte.
   *Importa:* evidência que resiste a auditoria.
4. **Timeline.** Destacar o evento `powershell.exe -nop -w hidden -enc …` iniciado pelo `excel.exe` e o
   painel de detalhe com a referência à evidência bruta (arquivo:linha). Se houver como selecionar o
   evento por código, selecione; se não, destaque a linha e peça o clique.
   *Importa:* cada afirmação aponta para a linha exata do log original.
5. **ATT&CK.** Técnicas "sugeridas" pela regra automática × confirmadas pelo analista.
   *Importa:* automação que ajuda sem substituir o julgamento humano.
6. **Hipóteses e achados.** A diferença entre EVIDÊNCIA (fato com prova) e HIPÓTESE (inferência com o que a
   confirmaria e o que a refutaria).
   *Importa:* método de investigação, não só ferramenta.
7. **Relatórios.** Use a visão com o conteúdo de relatório ou escopo que **realmente existe** nos fixtures
   do TESTE-001. Confira antes e não invente conteúdo.
   *Importa:* o fim do trabalho é uma decisão de negócio, não uma lista de alertas.

## 5. Glossário
- Componente de dica acessível (`role="tooltip"`, aparece com hover **e** foco, fecha com Esc), aplicado às
  siglas da barra de status e aos rótulos das abas, só no modo demo.
- Painel "Glossário" (aberto pela faixa), com termos em ordem alfabética:
  - ATT&CK, cadeia de custódia, DFIR, EDR, evidência × hipótese, IOC, LIM (limitação), pivô, SHA-256,
    SIEM, timeline, UTC;
  - mais as fontes (Defender, Sentinel, Entra ID, Splunk, Elastic, Wazuh).
  Cada termo em 1 ou 2 frases para leigos.
- Fonte única dos textos: `ui/src/demo/glossario.ts`.

## 6. Telas pequenas
Abaixo de 1024 px de largura, o console da demo mostra um aviso no lugar do console: "O console foi feito
para telas grandes". O aviso traz:
- 2 ou 3 capturas reais da interface (gere PNGs otimizados a partir do build demo e coloque em
  `ui/public/demo/`, com no máximo 250 KB cada);
- o link "abrir mesmo assim";
- o link de volta para a apresentação.
A apresentação funciona em qualquer largura.

## 7. Testes (vitest)
- Cada passo do tour declara a visão e um `data-tour` que existe no código-fonte da visão correspondente
  (teste estático que procura o atributo nos arquivos `.tsx`).
- O glossário cobre todas as siglas exibidas na barra de status do modo demo.
- Com `VITE_DEMO` desligado, `App` não renderiza a faixa, o tour nem a apresentação, e `#/` continua sendo
  a lista de casos.
- A lógica de navegação do tour (próximo, anterior, limites, persistência em `localStorage`) é pura e testada.

## Critérios de aceite
- Tudo isto passa:
  ```
  uv run pytest -q -p no:cacheprovider --basetemp <pasta temporária>
  npm --prefix ui run typecheck
  npm --prefix ui test
  npm --prefix ui run build
  npm --prefix ui run build:demo
  ```
- `ui/dist-demo/` abre servido como estático, sem backend e sem nenhuma requisição externa.
- O build normal não tem nenhum texto ou componente da demo (confira por busca no bundle).
- Resultado em `docs/tasks/08-resultado.md`: o que foi feito, a saída dos comandos, os números de testes
  usados na apresentação, os desvios e as limitações.
- Não faça commit nem push.
