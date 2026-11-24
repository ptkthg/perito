---
name: revisao-cruzada
description: Revisão cruzada de uma investigação do Perito por um segundo agente (Codex revisando o trabalho do Claude ou vice-versa), em modo somente leitura, seguida de conciliação das divergências. Use quando o usuário pedir "segunda opinião", "revisão cruzada", "revisar a investigação", "peer review", ou antes de enviar o relatório final.
---

# Revisão cruzada (Claude × Codex)

O revisor **não altera** arquivos do caso: só escreve em `casos/<ID>/revisoes/`.

## A) Claude conduz, Codex revisa
1. Garanta que o caso está salvo (achados, hipóteses, escopo, limitações e timeline gerados).
2. Rode (na raiz do repositório, com timeout longo):
   ```
   codex exec -C "<raiz>\casos\<ID>" -s read-only --skip-git-repo-check -o "<raiz>\casos\<ID>\revisoes\codex-<AAAAMMDD-HHMM>.md" "<PROMPT_REVISOR>"
   ```
   Como `-o` grava a última mensagem do Codex, o arquivo fica completo mesmo em modo `read-only`.
3. Leia a revisão e escreva `revisoes/conciliacao.md` (formato abaixo).
4. Aplique nos arquivos do caso só o que foi **aceito**, citando a revisão.

## B) Codex conduz, Claude revisa
Se o usuário investigou com o Codex, faça a revisão você mesmo, com o mesmo `PROMPT_REVISOR`, sem editar nada fora de `revisoes/`. Grave em `revisoes/claude-<AAAAMMDD-HHMM>.md`.

## PROMPT_REVISOR
```
Você é um revisor sênior de DFIR fazendo peer review cético de uma investigação. O diretório atual é um caso do Perito.
Leia: caso.md, triagem.md, achados.md, hipoteses.md, escopo.md, limitacoes.md, acoes.md, iocs.csv, timeline/timeline.csv e relatorios/ (se existirem). NÃO leia arquivos chamados GABARITO.
NÃO altere nenhum arquivo. Sua resposta final é a revisão completa, em português do Brasil, em Markdown, com estas seções:
1. Veredito geral (a investigação sustenta as conclusões? sim / parcialmente / não) em 3 linhas.
2. Afirmações sem evidência suficiente: cite o trecho, o arquivo e o que faltaria (raw_ref, consulta).
3. Hipóteses alternativas não consideradas, especialmente para o vetor de entrada, a origem das credenciais e o escopo.
4. Inconsistências na timeline: ordem, fuso, IP→host, eventos que contradizem a narrativa.
5. Técnicas ATT&CK mal atribuídas ou faltando.
6. Lacunas de escopo: contas, hosts ou dados que deveriam ter sido verificados; IOCs não pesquisados no ambiente inteiro.
7. Limitações não declaradas.
8. Riscos no relatório: linguagem que transforma hipótese em fato; informação sensível desnecessária.
9. Top 5 ações para fortalecer a investigação, em ordem de prioridade, com a consulta ou coleta sugerida.
Para cada item, use a referência (arquivo:linha ou raw_ref). Seja específico; não elogie.
```

## Formato de `conciliacao.md`
```
# Conciliação da revisão <arquivo>
| # | Ponto do revisor | Decisão (aceito / rejeitado / parcialmente) | Justificativa | Ação no caso |
## Divergências não resolvidas (levar ao responsável pelo caso)
```
Regra: rejeitar um ponto exige uma [EVIDÊNCIA] ou um argumento. "Discordo" sozinho não basta. Divergências não resolvidas vão para o relatório técnico na seção de limitações ou de hipóteses.

## Saída para o usuário
Veredito do revisor, os pontos aceitos (já aplicados), os rejeitados com o motivo e as divergências abertas.
