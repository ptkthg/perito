# Pacotes de consulta por fase

Consultas prontas para rodar **no seu SIEM/EDR**. Exporte o resultado (CSV/JSON) e ingira com `uv run perito ingerir <ID> <arquivo>`.

| Fase | KQL (Defender XDR / Sentinel) | SPL (Splunk) |
|---|---|---|
| 00 Linha do tempo de host/conta | `kql/00-timeline-entidade.kql` | `spl/00-timeline-entidade.spl` |
| 01 Acesso inicial | `kql/01-acesso-inicial.kql` | `spl/01-acesso-inicial.spl` |
| 02 Execução | `kql/02-execucao.kql` | `spl/02-execucao.spl` |
| 03 Persistência | `kql/03-persistencia.kql` | `spl/03-persistencia.spl` |
| 04 Acesso a credenciais | `kql/04-credenciais.kql` | `spl/04-credenciais.spl` |
| 05 Movimentação lateral | `kql/05-movimentacao-lateral.kql` | `spl/05-movimentacao-lateral.spl` |
| 06 Coleta / exfiltração / evasão | `kql/06-exfiltracao-evasao.kql` | `spl/06-exfiltracao-evasao.spl` |
| 07 Identidade (Entra ID) | `kql/07-identidade-entra.kql` | `spl/07-identidade-entra.spl` |

ES|QL (Elastic) fica para a fase 2. Por enquanto, exporte do Discover/Timeline em NDJSON: o parser `elastic` já entende ECS.

## Convenções
- Placeholders: `{{host}}`, `{{user}}`, `{{upn}}`, `{{ip}}`, `{{sha256}}`, `{{inicio}}`, `{{fim}}` (ISO 8601 UTC). Troque antes de rodar. As skills `investigar` e `timeline` já preenchem os placeholders com os dados do caso.
- Cada bloco começa com `// [Qn.m] título` (KQL) ou `` `comment("[Qn.m] título")` `` (SPL), seguido do **porquê** e de **como interpretar**.
- **Exporte com `Timestamp`/`TimeGenerated`/`_time` e os campos originais** (não renomeie), para o parser reconhecer.
- No Defender XDR, para unir tabelas, use `union withsource=TableName ...` (o parser usa `TableName`).
- No Splunk, os nomes de índice e sourcetype variam por ambiente: ajuste `index=` e `sourcetype=`. As consultas assumem o Splunk Add-on for Microsoft Windows (`XmlWinEventLog`), o add-on do Sysmon e firewall `pan:traffic`.
- Ausência de resultado **não** prova ausência de atividade. Registre retenção e cobertura em `limitacoes.md`.
