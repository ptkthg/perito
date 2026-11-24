# Perito

Kit de **Resposta a Incidentes / DFIR** para usar com **Claude Code** e **Codex**. Ele normaliza evidências de EDR, SIEM, identidade e rede em uma timeline única com cadeia de custódia e guia a investigação (NIST SP 800-61r3 / SANS PICERL / MITRE ATT&CK) até os relatórios técnico, executivo, RCA e a nota para DPO/Jurídico.

**Fontes suportadas:** Microsoft Defender XDR (Advanced Hunting), Microsoft Sentinel (SecurityEvent, SigninLogs, AuditLogs, SecurityAlert, CommonSecurityLog, Device*), Entra ID (sign-in e audit), Splunk (Sysmon, Windows Security, firewall/proxy), Elastic (ECS) e Wazuh (alerts.json).

## Como usar
Abra o Claude Code (`claude`) ou o Codex (`codex`) na raiz do repositório e peça em linguagem natural. As skills são carregadas automaticamente:

| Você diz | Skill |
|---|---|
| "Recebi este alerta do Defender: ..." | `triagem-alerta` |
| "Abre um caso para o incidente do Financeiro" | `novo-caso` |
| "Ingere estes exports" (arraste os arquivos) | `ingerir` |
| "Monta a timeline / quem foi o paciente zero?" | `timeline` |
| "Investiga movimentação lateral e exfiltração" | `investigar` |
| "Qual o escopo?" | `escopo` |
| "Gera o relatório executivo e a nota para o Jurídico" | `relatorio` |
| "Pede uma segunda opinião ao Codex" | `revisao-cruzada` |

## CLI direta
```
uv run perito novo-caso IR-2026-001 --titulo "..."
uv run perito ingerir IR-2026-001 C:\exports\ --obs "consulta Q0.1, janela ..."
uv run perito resumo IR-2026-001
uv run perito timeline IR-2026-001 --host ws-fin-023 --de 2026-11-10T13:00Z
uv run perito pivo IR-2026-001 --ip 203.0.113.45
uv run perito iocs IR-2026-001 --gravar
uv run perito verificar IR-2026-001
```

## Estrutura
- `AGENTS.md`: metodologia e regras de evidência (fonte canônica para os dois agentes)
- `.agents/skills/`: skills (edite aqui e rode `node scripts/sync-skills.mjs` para espelhar em `.claude/skills/`)
- `queries/kql`, `queries/spl`: consultas por fase, com instruções de interpretação
- `templates/`: relatório técnico, executivo, RCA e nota DPO/Jurídico
- `src/perito/`: parsers, timeline, MITRE, custódia e CLI (stdlib pura)
- `samples/caso-sintetico/`: incidente fictício com 50 eventos em 7 fontes e o `GABARITO.md`, para testes e treino
- `casos/`: casos reais (fora do git)

## Testar / treinar
```
uv run pytest
uv run perito novo-caso TREINO-01
uv run perito ingerir TREINO-01 samples/caso-sintetico
```
Investigue com as skills e compare suas conclusões com `samples/caso-sintetico/GABARITO.md`.

## Desenvolvimento com Claude × Codex
Specs em `docs/tasks/NN-*.md`. Um agente implementa (`codex exec -C . -s workspace-write ...`) e o outro revisa o diff, roda os testes e faz o commit.
