# Resultado da spec 08 — demonstração pública para recrutador

Implementação concluída, sem commit nem push.

## O que foi implementado

- `npm --prefix ui run build:demo`, com `.env.demo` e saída independente em `ui/dist-demo/`. Os arquivos públicos, fixtures e capturas entram nessa saída. `VITE_DEMO=1` também seleciona a API de fixtures.
- Configuração da Vercel com os seis headers solicitados, incluindo a CSP completa da spec. Root Directory esperado: `ui`.
- Apresentação em `#/`, em português, com problema, quatro capacidades, construção, totais de testes, links e aviso de dados sintéticos. Constantes de testes centralizadas em `ui/src/demo/conteudo.ts`.
- Faixa no topo do console com Tour, Glossário e Sobre, sem sobrepor a barra de status. A faixa ocupa uma linha própria no layout.
- Tour de sete passos com recorte do alvo, navegação por rota, botões, setas, Enter, Esc, foco dentro do diálogo e texto anunciado por `aria-live`. Alvo ausente por dois segundos produz balão centralizado. Visita persistida em `perito-demo-tour=visto` e reinício pelo botão ou pela tecla `t` fora de campos de texto.
- No passo da timeline, seleção e fixação do PowerShell iniciado pelo Excel, limpeza de filtros se necessário e rolagem do detalhe para mostrar a referência original. A extensão do handle `focusEvents` é opcional e preserva o comportamento anterior das chamadas existentes.
- Glossário alfabético, com definições e aliases em `ui/src/demo/glossario.ts`. Dicas `role="tooltip"` nos rótulos da barra de status e das abas: hover, foco, `aria-describedby` e saída por Esc. Os atributos adicionados às dicas são restaurados ao desmontar a demo.
- Aviso para largura inferior a 1024 px, com duas capturas reais, botão Abrir mesmo assim e retorno à apresentação.
- Testes Vitest para alvos estáticos nas respectivas visões, glossário, limites da navegação, persistência, armazenamento bloqueado e App normal na raiz e na rota do console.

O import da demo é condicional e lazy. O build normal elimina os módulos, textos e CSS da demo. Os `data-tour` permanecem inofensivos nas visões existentes.

## Comandos e resultados

Todos os comandos abaixo terminaram com código 0 na validação final correspondente.

| Comando | Saída relevante |
|---|---|
| `uv run pytest -q -p no:cacheprovider --basetemp <pasta temporária>` | `178 passed in 53.56s` |
| `npm --prefix ui run typecheck` | `tsc --noEmit`, sem erros |
| `npm --prefix ui test -- --reporter=dot` | `Test Files 11 passed (11)`; `Tests 79 passed (79)`; última execução: 1,46 s |
| `npm --prefix ui run build` | `97 modules transformed`; `built in 425ms`; postbuild recriou `.gitkeep` |
| `npm --prefix ui run build:demo` | `105 modules transformed`; `built in 562ms`; fixtures e PNGs presentes em `dist-demo/` |
| `git diff --check` | Sem erros |

Os totais usados na apresentação são **178 testes Python e 79 testes Vitest**. A UI tinha 73 testes antes desta tarefa; foram acrescentados seis testes.

Preparação do ambiente: `npm ci` instalou as dependências do lockfile, sem alterações de dependências ou do lockfile. Como `uv` não estava acessível no PATH, foi obtido um executável em `<pasta temporária>`, acrescentado ao PATH apenas do processo. Cache do uv em diretório temporário próprio. Todos os comandos Python foram executados por `uv run`, na raiz do repositório.

O teste inicial dos alvos falhou por ausência dos atributos, antes da integração. Durante a implementação, o typecheck identificou o campo correto `parent` e um conflito de nomes de arquivos no Windows, resolvido com `passos.ts`. Uma execução intermediária do teste de App excedeu o timeout ao importar todo o console; o teste passou a substituir apenas o console, que não é usado na seleção de casos, e também verifica o ramo normal da rota do caso. A suíte final passou integralmente.

## Verificação no navegador e dos artefatos

Build demo servido com `vite preview --outDir dist-demo --port 4178`, sem backend. Verificação automatizada com Playwright e Chromium headless, com inspeção visual dos PNGs:

- Sete passos percorridos; rotas corretas; foco dentro do tour; anterior, próximo por Enter/setas, conclusão e Esc. Retorno do foco ao botão Tour verificado por Sair e por Esc no build final.
- Passo 4 selecionou o evento de `2026-11-10T13:08:19.774Z`, com `powershell.exe` aberto por `excel.exe`, comando `-nop -w hidden -enc …` e `raw_ref` **`defender_advanced_hunting.csv:9`**.
- Persistência após recarregar, reabertura por `t`, abertura/saída do glossário, tooltip por hover e foco, saída do tooltip por Esc e manutenção de `t` como texto em campo de entrada.
- Remoção deliberada do atributo do alvo durante o teste: balão centralizado após dois segundos, sem bloquear os controles.
- Apresentação sem overflow horizontal em 360, 768, 1024 e 1920 px. Aviso em 360 px e botão Abrir mesmo assim funcionando.
- **Zero requisições externas, zero erros JavaScript e zero erros HTTP** na verificação completa do build. Fontes, módulos, fixtures e PNGs são locais.
- Verificação adicional com a CSP de `vercel.json` aplicada às respostas: apresentação e PNGs carregaram sem violações de CSP, recursos externos ou erros HTTP.
- Build normal servido separadamente na porta 4179: `#/` mostrou SELEÇÃO DE CASO, sem apresentação, faixa ou tour. Busca em todos os JS/CSS do bundle normal não encontrou `DEMO ·`, `Abrir a demonstração`, `perito-demo-tour`, `demo-tour-card` nem o texto do aviso para telas pequenas.

Capturas do build demo em 1440 × 900, recomprimidas sem perda (IDAT/zlib), conferidas visualmente:

| Arquivo | Tamanho |
|---|---:|
| `ui/public/demo/visao-geral.png` | 127.332 bytes |
| `ui/public/demo/timeline.png` | 247.039 bytes |

Ambas ficam abaixo de 250.000 bytes, inclusive pelo limite decimal mais restritivo.

## Escolhas, desvios e limitações

- O passo 7 usa **Escopo**, permitido pela spec: `docs.json` lista `escopo` e `doc-escopo.json` tem conteúdo. Não há relatório final nos fixtures; o tour informa essa ausência e não inventa um relatório.
- `postbuild.mjs` permaneceu intacto: o hook npm `postbuild` roda apenas após `build`, não após `build:demo`. A demo não escreve na saída do servidor Python.
- O comando de build normal gera arquivos no caminho legado `src/perito/ui/static/`. Após validar o bundle, os arquivos versionados foram restaurados ao estado inicial e o JS gerado foi removido. O diff entregue não altera `src/perito/`, `samples/`, `casos/` nem os fixtures.
- Os builds emitem o aviso de chunk principal acima de 500 kB (cerca de 590–591 kB antes de gzip). Não houve mudança de empacotamento fora do escopo.
- Se o navegador bloquear `localStorage`, o tour continua funcional, mas não consegue lembrar a visita entre carregamentos.
- Verificação de navegador feita em Chromium. Não houve publicação na Vercel nem validação de uma implantação remota; os headers estão configurados para a publicação.

Orientação web aplicada: diálogos nativos com `showModal()` para foco e Esc, seguindo o guia `dialog` do Modern Web Guidance: “DON'T add role="dialog", aria-modal, a focus trap”. O glossário e o tour usam a semântica nativa e contenção de rolagem no diálogo/backdrop. A identidade visual foi preservada a partir dos tokens existentes; a verificação mecânica Impeccable dos componentes novos retornou `[]`.

Os arquivos preexistentes não rastreados `docs/tasks/08-demo-recrutador.md` e `docs/tasks/08-resultado-codex.md` foram preservados. Nenhum commit, push ou publicação foi feito.
