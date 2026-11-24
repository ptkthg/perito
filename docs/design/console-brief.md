# Brief de design: PERITO // Console de operações

> Autor: agente ui-ux-designer. Fonte de verdade visual da interface. Mudanças aqui exigem revisão.

## 1. Conceito
Painel de sala de controle para quem lê evidência por horas. Tudo segue uma grade rígida de caracteres. A cor serve como sinal, nunca como decoração: âmbar marca a atenção do analista, vermelho marca perigo, ciano marca o que leva a um pivô. Qualquer valor na tela vira filtro, pivô ou achado com uma tecla. O texto da evidência aparece exatamente como veio.

**Nunca faça:**
1. **Alterar dados para ficar bonito.** Nada de `text-transform` em dados, nada de corrigir caixa, nada de "humanizar" timestamps ("há 3 min"). A caixa alta vale só para rótulos de UI. O valor exibido precisa ser idêntico ao do `raw_ref`.
2. **Sombra, raio, blur, gradiente ou glow.** A profundidade vem de linha de 1px e da troca de superfície.
3. **Toast, modal flutuante ou spinner.** O feedback aparece na linha de status ou inline, no ponto do erro. Nada cobre a timeline.
4. **Ícones ilustrativos.** Só glifos tipográficos (◆ ◇ ⧉ ▲ ⊙ ~ ✕), com significado fixo e legenda no `?`.
5. **Animação fora do prompt.** O único movimento é o cursor da linha de comando. Não há transição de página, contador animado nem skeleton pulsante.

## 2. Tokens

### Cores (escuro padrão; contraste sobre `--bg`)
| Token | Hex | Uso | Contraste |
|---|---|---|---|
| `--bg` | `#0B0C0A` | fundo (preto quente) | — |
| `--surface-1` | `#121411` | painéis | — |
| `--surface-2` | `#1A1D18` | cabeçalho de tabela, linha alternada | — |
| `--sel-bg` | `#2A2008` | linha selecionada | — |
| `--grid` | `#2A2E28` | linhas decorativas | 1,5:1 |
| `--grid-strong` | `#5E6558` | bordas de inputs e de elementos focáveis | 3,2:1 |
| `--text` | `#E6E1D3` | dado primário | 14:1 |
| `--text-2` | `#A8A291` | rótulos, colunas secundárias | 7,6:1 |
| `--text-3` | `#86816F` | ms, separadores, placeholder | 5,0:1 |
| `--amber` | `#FFB000` | seleção, fase, foco do analista | 11:1 |
| `--green` | `#5FD068` | OK, custódia verificada, EVIDÊNCIA | 9,7:1 |
| `--red` | `#FF5A4E` | severidade alta, erro, log limpo | 6,3:1 |
| `--cyan` | `#4FD1E8` | pivô, link, anel de foco | 10:1 |

### Fontes de dados
O código de 3 letras aparece sempre; a cor é só reforço.

| Código | Fonte | Hex |
|---|---|---|
| `DEF` | defender | `#6CB6FF` |
| `SEN` | sentinel | `#B79CFF` |
| `ESI` | entra_signin | `#3FD0C0` |
| `EAU` | entra_audit | `#9FD67A` |
| `SPL` | splunk | `#FF8F5C` |
| `ELA` | elastic | `#F5D25C` |
| `WAZ` | wazuh | `#F28AC0` |

Todas ficam acima de 7:1. Na tabela, a cor vai no código e num tique de 2px à esquerda da linha. No histograma, cada linha é rotulada, então nunca é preciso decodificar uma legenda.

### Tags metodológicas (a forma distingue, não só a cor)
| Tag | Visual | Exemplo |
|---|---|---|
| `[EVID]` | verde, **preenchimento sólido** (texto `#0B0C0A` sobre `#5FD068`), glifo ■ | `■EVID def/alerts.json#L212` |
| `[HIP]` | âmbar, **só contorno** de 1px, glifo ◇, confiança obrigatória | `◇HIP·MÉD` |
| `[LIM]` | `#E6E1D3` sobre **hachura** (`repeating-linear-gradient` 45°, 4px), glifo ⊘ | `⊘LIM WAZ sem cobertura 13:00–13:30` |

Hipótese refutada fica tachada e em `--text-3`. Hipótese confirmada ganha contorno duplo.

### Tipografia (OFL, auto-hospedada com `@fontsource`, sem CDN)
- **Dados:** Iosevka (fallback JetBrains Mono). É estreita, então cabem mais colunas, e separa bem `0/O` e `1/l/I`. Usar `font-variant-numeric: tabular-nums slashed-zero`.
- **Rótulos:** IBM Plex Sans Condensed 600, CAIXA ALTA, `letter-spacing: .08em`. Só em abas, cabeçalhos de coluna e status.
- **Escala:** dado 13px/20px (linha fixa) · rótulo 11px · status 12px · ID do caso 14px/700. Nada abaixo de 11px.
- **Densidade:** linhas de 18, 20 (padrão) ou 24px, alternadas com `Ctrl+=` / `Ctrl+-`.

### Grade e linhas
- Base de 4px. Célula com padding `0 8px`. O gutter entre painéis é a própria linha de 1px.
- `border-radius: 0` em tudo.
- Linha de 1px para separar. Linha `3px double` (═) só abaixo da barra de status e acima do prompt.

## 3. Tela principal
```
PERITO//IR-2026-001 ▮ DETECT ▮ 18/50 EVT ▮ 7 SRC ▮ ⊘2 LIM ▮ 1 HOST S/EDR ▮ CUSTÓDIA ✓SHA-256 ▮ UTC ▮ ? AJUDA
════════════════════════════════════════════════════════════════════════════════════════════════════════
 F1 TIMELINE │ F2 ENTIDADES │ F3 ATT&CK │ F4 IOC │ F5 COBERTURA │ F6 HIP/ACH │ F7 ESCOPO │ F8 REVISÃO │ F9 REL
────────────────────────────────────────────────────────────────────────────────────────────────────────
     ▕13:00     13:10     13:20     13:30     13:40     13:50     14:00     14:10     14:20 ▕ JANELA
 DEF ▕▂▇▃ ▁ ▁█ ▁▁ ▁                     ▁                                                ▕ 13:00
 SEN ▕ ▁    ▁    ▁                ▁▁       ▁                                             ▕  →14:30
 ESI ▕           ▃▇▇▇▅▁                                                                  ▕ 4 MARCAS
 EAU ▕                ▁                                                                  ▕
 SPL ▕   ▁ ▂ ▁                ▁                                                          ▕
 ELA ▕░░░░░░░░░░░░░░░░░░░░░░░░░░ SEM DADOS ░░░░░░░░░░░░░░░░░ ▁▅█▃                          ▕
 WAZ ▕                       ▁▃▇▂  ▁▇▂▁        ▅▇ ✕                                      ▕
     ▕══════════════▲═══════════════[▓▓▓▓▓▓ janela visível ▓▓▓▓▓]══════════════════════════▕
──────────────────────────────────────────────────────────────────────────────┬─────────────────────────
 FILTRO host=ws-fin-023 ∨ host=srv-fs-01 ∧ type≠dns                 18/50 EVT │ EVENTO 05/18  DEF·PROC
──────────────────────────────────────────────────────────────────────────────┼─────────────────────────
 TS(UTC)      SRC TIPO HOST        USER     RESUMO             ATT&CK     FLAG│ TS    13:15:30.660Z
 13:08:19.774 DEF PROC ws-fin-023  m.silva  excel→powershell… T1059.001? ◇⧉2 │ HOST  ws-fin-023
 13:08:21.090 DEF NET  ws-fin-023  m.silva  →203.0.113.45:443  T1071.001? ·   │ USER  m.silva
 13:09:02.311 SPL DNS  ws-fin-023  —        upd-cdn-ms[.]net   —          ·⧉3 │ PROC  rundll32.exe
 13:11:47.120 DEF TASK ws-fin-023  SYSTEM   schtasks /create … T1053.005? ◇   │ PAI   powershell.exe
▌13:15:30.660 DEF PROC ws-fin-023  m.silva  rundll32 comsvcs…  T1003.001? ◆⧉2 │ CMD ─────────────────────
 13:21:44.002 ESI SIGN —           m.silva  MFA push ×14 neg.  T1621?     ◇▲  │ rundll32.exe C:\Windows\
 13:34:10.515 WAZ LOGN srv-fs-01   m.silva  RDP de ~ws-fin-023 T1021.001? ◆⧉2 │ System32\comsvcs.dll,
 13:52:03.900 WAZ PROC srv-fs-01   m.silva  rclone copy s3:…   T1567.002? ◆▲  │ MiniDump 624 C:\Users\
 14:05:12.004 WAZ AUD  srv-fs-01   SYSTEM   wevtutil cl Secur… T1070.001? ◆   │ Public\l.dmp full
                                                                              │ ⧉ CORROB WAZ#4471 ELA#88
                                                                              │ ⊙ OBSERV ws-fin-023·EDR
                                                                              │ ATT&CK T1003.001 SUGERIDO
                                                                              │ RAW def/alerts.json#L212
                                                                              │ [a]ACHADO [h]HIP [p]PIVÔ
══════════════════════════════════════════════════════════════════════════════╧═════════════════════════
> filtro host=ws-fin-023 type!=dns█                              Tab completa · ↵ executa · Esc cancela
  host=ws-fin-023 (31)   host=srv-fs-01 (9)   host=dc-01 (6)   host=ws-fin-011 (2)
```
Os dados acima são ilustrativos.

O histograma funciona como um sismógrafo: uma linha por fonte, preenchida só com a cor da fonte.
- **Ausência de dados:** hachura `░` com rótulo, que é a limitação vista a olho.
- `✕`: log limpo.
- `▲`: cursor temporal.
- **Janela:** arraste com o mouse ou use `[`/`]`.

## 4. Visões
| Tecla | Visão | Conteúdo |
|---|---|---|
| F1 | Timeline | tabela virtualizada, histograma, detalhe, filtros ativos |
| F2 | Entidades/pivô | por tipo (host, user, ip, domain, sha256): 1ª/última vez, contagem por fonte em mini-sparkline; Enter abre a timeline filtrada; relação textual (`m.silva → ws-fin-023 → srv-fs-01`) |
| F3 | ATT&CK | colunas por tática, células por técnica com contagem; **heurística tracejada com "?"**, confirmada pelo analista sólida |
| F4 | IOC | candidatos com tipo, 1ª vez e fontes; **defanged por padrão** (`hxxps`, `[.]`), alternável com `D`; status candidato/aprovado/descartado |
| F5 | Cobertura/Limitações | matriz fonte × tempo e fonte × host; hosts sem EDR em vermelho com ⊘; cada lacuna vira `[LIM]` com uma tecla |
| F6 | Hipóteses & Achados | `hipoteses.md`/`achados.md` com tag, confiança, eventos vinculados, status aberta/confirmada/refutada |
| F7 | Escopo | hosts, contas e dados afetados, com a evidência de cada inclusão |
| F8 | Revisão/Conciliação | 3 colunas CLAUDE │ CODEX │ CONCILIADO; divergências marcadas com `≠` e navegadas com `n`/`N` |
| F9 | Relatórios | pré-visualização em modo claro de impressão, com fase NIST/PICERL no cabeçalho |

**Construir primeiro:** F1, F2 e F6. É o ciclo ver → pivotar → registrar com tag. A cobertura já aparece no F1 desde o início, pelas lacunas hachuradas.

## 5. Teclado
| Tecla | Ação |
|---|---|
| F1–F9 | trocar de visão (alternativa `g1`…`g9`) |
| `j`/`k` · `J`/`K` | linha ±1 · ±10; `gg`/`G` início/fim |
| `h`/`l` | cursor de célula dentro da linha |
| `/` | busca incremental; `n`/`N` |
| `>` ou `:` | foca a linha de comando |
| Enter | fixa o evento no detalhe e expande o cmdline |
| `p` | pivô pelo valor da célula focada |
| `f` / `F` | incluir / excluir o valor da célula no filtro; `u` desfaz o último filtro |
| `a` | promover a achado (formulário inline com `raw_ref` e `■EVID`) |
| `H` | vincular a uma hipótese |
| `m` | marcar evento; `[`/`]` pula entre marcas |
| `y` / `x` | copiar valor / copiar `raw_ref` |
| `t` | ir para timestamp |
| Esc | camadas: fecha o detalhe, depois limpa o prompt, depois sai do foco |
| `?` | ajuda em tela cheia com mapa de teclas e legenda de glifos |

**Comandos:** `pivo --ip|--host|--user|--hash X`, `filtro campo=v campo!=v`, `janela 13:00..13:30`, `ir 13:15:30`, `limpar`, `promover`, `hip nova`, `exportar csv`.
- **Autocompletar:** Tab completa comando, campo e valor a partir do índice de entidades, com a contagem entre parênteses.
- **Sugestões:** texto fantasma em `--text-3` e até 8 opções acima do prompt.
- **Histórico:** ↑/↓.

**Marcadores:**
- `⧉n`: corroborado por n fontes; os `raw_ref` ficam no detalhe.
- `▲`: volume alto (glifo na coluna FLAG, sem pintar a linha).
- `~valor`: `src_host` deduzido, em itálico e `--text-2`; o detalhe diz de onde veio.
- `⊙`: observador diferente do host.
- `T1059.001?`: técnica sugerida; o `?` só sai quando o analista confirma.

## 6. Densidade e performance
- **Virtualização:** TanStack Virtual com altura de linha **fixa**. A expansão do conteúdo acontece no painel de detalhe, nunca dentro da linha.
- **Volume:** acima de ~200 mil eventos, o filtro roda no backend com paginação por janela. Abaixo disso, roda num Web Worker. O histograma é pré-agregado pela API.
- **cmdline:** truncado **no meio**, preservando o executável e o final.
- **Tempo:** ms em `--text-3`; na virada do dia, uma linha `── 2026-03-14 SEX ──`.
- **Hash:** mostrado como `a3f9c2e1…7d04`; `y` copia o valor completo.

**Estados inline em texto:**
```
CARREGANDO timeline.jsonl  ▮▮▮▮▮▮▮▯▯▯  84 120/120 000 EVT
0 EVENTOS para host=dc-01 ∧ src=ELA   ⊘ ELA sem dados 13:00–13:30   [u] desfaz último filtro
ERRO E-PARSE timeline.jsonl:4812 JSON inválido — 4811 eventos carregados   [x] ver linha bruta
```
O estado vazio sempre cruza com a cobertura: "não houve evento" ≠ "não havia coleta".

## 7. Microdetalhes
**Fazer:**
- Cursor de bloco piscando (1s, `steps(1)`) **só no prompt**, fixo com `prefers-reduced-motion`.
- Cabeçalhos em CAIXA ALTA com tracking.
- Tags como carimbos (borda de 1px, sem raio).
- `▮` como separador na barra de status.
- Fase atual em âmbar invertido.
- Tique de 2px na cor da fonte à esquerda de cada linha.

**Scanline: não.** Ela reduz o contraste, gera moiré em LCD e cansa em sessões longas. Também estão vetados:
- glow e `text-shadow`;
- curvatura de CRT;
- verde em tudo;
- efeito de digitação;
- chuva de caracteres;
- "ACCESS GRANTED".

A referência é um painel de subestação, não um filme sobre hackers.

## 8. Acessibilidade
- **Foco ≠ seleção.** Seleção: barra âmbar + `--sel-bg`. Foco: outline ciano de 2px com `outline-offset: -2px`. Os dois podem coexistir.
- `role="grid"` com roving tabindex e `aria-rowcount` real, mesmo virtualizado. `aria-live="polite"` na linha de status.
- Mínimo de 11px. Zoom de 200% com o detalhe em tela cheia. Alvos de 24px ou mais (WCAG 2.2 AA).
- `prefers-contrast: more`: texto `#FFFFFF`, `--grid` `#5E6558`, hachura mais densa.
- **Modo claro / impressão** (`Shift+L`; automático no F9 e em `@media print`):

  | Elemento | Hex |
  |---|---|
  | fundo | `#FAFAF7` |
  | texto | `#141412` |
  | âmbar | `#8A5A00` |
  | vermelho | `#B3261E` |
  | verde | `#2E6B34` |
  | ciano | `#0B6A7A` |

  Todos ficam acima de 4,5:1. Na impressão, o histograma usa padrões em vez de cor, e os glifos ■ ◇ ⊘ mantêm a forma.
