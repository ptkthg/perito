---
name: relatorio
description: Gera os relatórios de um caso do Perito (técnico, executivo, análise de causa raiz, recomendações de remediação e melhorias de detecção, nota para DPO/Jurídico conforme LGPD/ANPD) a partir de achados, hipóteses, escopo e limitações. Use quando o usuário pedir "relatório", "RCA", "resumo executivo", "comunicar DPO/Jurídico", "lições aprendidas".
---

# Relatórios

Fontes: `caso.md`, `achados.md`, `hipoteses.md`, `escopo.md`, `limitacoes.md`, `acoes.md`, `iocs.csv`, `timeline/` e `revisoes/conciliacao.md` (se houver). Templates em `templates/`. Saída em `casos/<ID>/relatorios/`.

## Regras de redação
- **Nada novo no relatório:** toda afirmação tem que estar nos arquivos do caso. Se faltar, volte para `investigar`.
- **As tags se convertem em linguagem:** [EVIDÊNCIA] → "foi observado", "os registros mostram". [HIPÓTESE] → "é provável que", "a hipótese mais consistente é", sempre com a confiança. [LIMITAÇÃO] → seção própria, sem esconder.
- Horários em UTC, com o horário de Brasília entre parênteses no executivo.
- Relatório técnico: preciso e reproduzível (raw_ref, consultas). Executivo: sem jargão, foco em impacto, risco e decisão.
- Se a revisão cruzada não foi feita, recomende fazê-la antes de enviar o relatório final (`revisao-cruzada`).

## Entregáveis
1. **`relatorio-tecnico.md`** (template `templates/relatorio-tecnico.md`): sumário, escopo, timeline detalhada, achados por fase com ATT&CK, IOCs, hipóteses e o seu status, limitações, ações realizadas, recomendações e anexos (consultas, custódia).
2. **`relatorio-executivo.md`** (template `templates/relatorio-executivo.md`): no máximo 1–2 páginas. O que aconteceu, impacto no negócio, situação atual, decisões necessárias, próximos passos com dono e prazo.
3. **`rca.md`** (template `templates/rca.md`): causa raiz com **5 porquês** e **árvore de causas** separando a causa técnica imediata, as falhas de controle (preventivo, detectivo, resposta) e os fatores organizacionais. Sem culpar indivíduos: o foco é controle e processo.
4. **Recomendações** (dentro do técnico e da RCA), em três horizontes: **imediato** (até 7 dias: conter e erradicar), **curto prazo** (até 90 dias: fechar a causa raiz) e **estrutural**. Cada uma com dono, prazo, controle CIS/NIST CSF relacionado e como verificar que foi feita.
5. **Melhorias de detecção:** para cada técnica observada que **não** gerou alerta (ou gerou tarde), proponha uma detecção (lógica em KQL/SPL, fonte, campos, falsos positivos esperados) e um teste de validação (ex.: Atomic Red Team T1003.001).
6. **`nota-dpo-juridico.md`** (template `templates/nota-dpo-juridico.md`), **somente** se houver possibilidade de dados pessoais afetados: fatos, categorias de dados e de titulares (sem expor os dados), volume estimado, se houve exfiltração confirmada ou provável, medidas adotadas, riscos aos titulares e o que ainda é desconhecido. Lembre que a avaliação sobre comunicar a ANPD e os titulares cabe ao controlador (DPO/Jurídico) e que a Resolução CD/ANPD nº 15/2024 fixa prazo de **3 dias úteis** a partir do conhecimento do incidente que possa acarretar risco ou dano relevante. **Não emita parecer jurídico**: forneça os fatos técnicos.

## Público e tom
| Público | Documento | Foco |
|---|---|---|
| Segurança / SOC | técnico + detecções | reprodutibilidade, IOCs, lacunas de detecção |
| Infra / Engenharia | técnico (seções de ações) + RCA | o que corrigir, onde, como verificar |
| Diretoria | executivo | impacto, risco residual, decisões, custo |
| DPO / Jurídico | nota DPO/Jurídico + executivo | fatos, dados pessoais, prazos, incertezas |

## Saída para o usuário
Caminhos gerados, decisões pendentes que o relatório expõe e lacunas que enfraquecem conclusões. Ofereça converter para .docx/.pdf se ele precisar enviar.
