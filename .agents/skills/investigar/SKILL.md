---
name: investigar
description: Conduz a investigação DFIR de um caso do Perito fase a fase (acesso inicial, execução, persistência, acesso a credenciais, movimentação lateral, coleta/exfiltração, impacto), sugerindo consultas KQL/SPL, interpretando resultados e mantendo achados, hipóteses, IOCs e limitações. Use quando o usuário pedir "investigar", "analisar o incidente", "houve movimentação lateral?", "teve exfiltração?", "como entraram?".
---

# Investigação por fases

Pré-requisito: caso com evidências ingeridas (`ingerir`) e timeline gerada (`timeline`).

## Ciclo para cada fase
1. **Pergunta da fase** (tabela abaixo).
2. **O que já está na timeline:** `uv run perito timeline <ID> --tipo ... --texto ...` ou `pivo`.
3. **O que falta:** sugira as consultas do `queries/kql/` (Defender/Sentinel) ou `queries/spl/` (Splunk), **já com os placeholders preenchidos** (host, conta, IP e janela do caso). Peça ao usuário para rodar e exportar o resultado. Quando ele trouxer o arquivo, use `ingerir`. Se colar o resultado no chat, salve-o como arquivo e ingira (para manter a custódia).
4. **Interprete:** cada conclusão leva a tag [EVIDÊNCIA] (com raw_ref), [HIPÓTESE] (confiança, confirmaria, refutaria) ou [LIMITAÇÃO].
5. **Atualize** `achados.md`, `hipoteses.md`, `iocs.csv` e `limitacoes.md`. Mude o status das hipóteses (aberta → confirmada/refutada/inconclusiva).
6. **Ausência de evidência não é evidência de ausência:** se a consulta veio vazia, diga se a fonte cobre a janela e o host. Se não cobrir, é limitação, não conclusão.

| Fase | Pergunta central | Consultas | Sinais típicos |
|---|---|---|---|
| Acesso inicial | Como e quando o atacante entrou? Por qual conta? | `01-acesso-inicial` | e-mail com anexo/URL, processo filho de Office, exploit de serviço exposto, sign-in de risco, VPN/RDP externo |
| Execução | O que rodou, de onde veio, quem lançou? | `02-execucao` | PowerShell ofuscado, LOLBins, binário em pasta gravável, hash raro, C2 |
| Persistência | Como ele sobrevive a reboot ou reset? | `03-persistencia` | tarefa agendada, serviço, Run key, conta nova, **método MFA novo, app OAuth** |
| Acesso a credenciais | Quais credenciais ele pode ter? | `04-credenciais` | acesso ao LSASS, SAM/NTDS, kerberoasting, MFA fatigue. **Liste todas as contas com sessão no host antes do dump.** |
| Movimentação lateral | Para onde ele foi e com qual conta? | `05-movimentacao-lateral` | RDP/SMB/WinRM saindo do host comprometido, logon tipo 10/3 com conta de serviço, PsExec |
| Coleta / exfiltração | O que foi levado, quanto, para onde? | `06-exfiltracao-evasao` | rclone/mega, compactação, upload grande ao FW, acesso em massa a compartilhamento |
| Evasão / impacto | Ele apagou rastros ou causou dano? | `06-exfiltracao-evasao` | log limpo (1102), Defender desativado, shadow copies apagadas, criptografia |
| Identidade (nuvem) | A conta na nuvem foi usada? Ganhou persistência? | `07-identidade-entra` | sign-ins de IP/país atípico, 500121 em sequência, registro de MFA, consent, regra de inbox |

## Cuidados de analista sênior
- **Credencial comprometida = toda conta com sessão interativa no host** onde houve dump, não só o usuário principal.
- **Linha de comando não prova sucesso:** `rclone copy` executado ≠ dados enviados. Busque a confirmação na rede (bytes de saída).
- **IP → host via DHCP pode mudar:** confirme o lease se a conclusão depender disso.
- **Fuso:** compare a mesma ação em duas fontes. Diferença de horas cravadas indica erro de fuso, não dois eventos.
- **Hipóteses concorrentes:** para o vetor de entrada e a origem de credenciais, mantenha pelo menos duas hipóteses até que uma seja refutada.

## Resumo em linguagem simples (obrigatório)
Ao fim de cada fase, atualize a seção `## Resumo` do `caso.md` (crie logo abaixo da lista de metadados se não existir). São 2 a 4 parágrafos curtos que alguém sem formação técnica entenda: o que aconteceu, onde, o que foi afetado e o que ainda não se sabe. Sem IDs de técnica nem jargão (escreva "copiou as senhas da memória do Windows", não "T1003.001 LSASS dump"). Cada frase termina com a tag `[EVIDÊNCIA]`, `[HIPÓTESE]` ou `[LIMITAÇÃO]`. A interface (Visão Geral) mostra este texto.

## Saída por fase
Resumo da fase em 3–6 linhas com tags, hipóteses atualizadas, IOCs novos, limitações e a próxima fase ou consulta. Ao final de todas as fases, sugira `escopo` e depois `relatorio`.
