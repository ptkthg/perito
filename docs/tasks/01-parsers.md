# Spec 01: Parsers de fontes e detecção automática

**Implementador:** Codex. **Revisor:** Claude.
**Leia antes:** `AGENTS.md` e `src/perito/schema.py` (contrato; **não altere** `schema.py` nem `case.py` sem registrar o motivo no resultado).

## Objetivo
Converter exports de 7 fontes em `Iterator[Event]` (schema em `src/perito/schema.py`), usando os helpers de normalização já existentes: `parse_ts`, `normalize_host`, `normalize_user`, `normalize_process`, `normalize_ip`, `to_int`.

## Arquivos a criar
```
src/perito/parsers/__init__.py      # registro: PARSERS = {"defender": defender.parse, ...}; parse_file(path, fonte) -> Iterator[Event]
src/perito/parsers/_io.py           # leitura genérica: CSV (utf-8-sig), JSON array, {"value": [...]}, NDJSON/JSONL; devolve (registro: dict, raw_ref: str)
src/perito/parsers/_winsec.py       # mapeamento compartilhado de eventos Windows (Security + Sysmon) por EventID
src/perito/parsers/detect.py        # detect_source(path) -> str | None
src/perito/parsers/defender.py
src/perito/parsers/sentinel.py
src/perito/parsers/entra_signin.py
src/perito/parsers/entra_audit.py
src/perito/parsers/splunk.py
src/perito/parsers/elastic.py
src/perito/parsers/wazuh.py
tests/test_parsers.py
tests/test_detect.py
```

## Regras gerais (valem para todos os parsers)
1. Assinatura: `def parse(path: Path) -> Iterator[Event]`. Função pura, sem escrita em disco.
2. `raw_ref`: `"<nome-do-arquivo>:<linha>"` para CSV (linha física do arquivo, cabeçalho = 1, então o 1º registro = 2) e NDJSON (1º registro = 1); `"<nome-do-arquivo>#<índice>"` (base 0) para array JSON.
3. `ts_original` recebe o valor bruto do campo de horário. `ts_utc = parse_ts(valor)`.
4. Strings vazias, `"-"`, `"null"` e `"N/A"` viram `None`. Portas viram `int` (`to_int`).
5. `user` normalizado com `normalize_user`. O original vai em `extra["user_original"]`.
6. `process` e `parent` em minúsculo, só o nome do executável (`normalize_process`). O caminho completo do processo vai em `file_path` **apenas** nos eventos `process` (caminho da imagem). Em eventos `file`, `file_path` é o arquivo afetado.
7. `sha256` em minúsculo. Para Sysmon `Hashes=SHA256=...,MD5=...`, extraia o SHA256.
8. **Host vs. observador:** em eventos `network` ou `dns` **sem processo associado** (firewall, proxy, servidor DNS), `host=None` e `extra["observer"]` recebe o nome normalizado do equipamento que reportou. Com processo associado (Defender, Sysmon 3, Elastic Defend), `host` é o endpoint.
9. Quando a fonte informa o **IP do próprio host** (Defender `LocalIP` em eventos de rede, Wazuh `agent.ip`), grave `extra["host_ip"]`. A timeline usa isso para mapear IP → host.
10. `description`: uma linha em português, legível, ex.: `"powershell.exe iniciado por excel.exe"`, `"Sign-in FALHOU (500121) de m.silva em OfficeHome a partir de 198.51.100.77 (Amsterdam/NL)"`.
11. Registro malformado (horário inválido, JSON quebrado): **não aborta**. Registre com `logging.getLogger("perito.parsers").warning(...)` e siga. Exponha um contador `parse_file(...).skipped` não é possível em generator, então use: `parse_file(path, fonte, stats: dict | None = None)`, que incrementa `stats["ignorados"]`.
12. `mitre`: preencha **somente** o que vem da fonte (ex.: `rule.mitre.id` do Wazuh, `Techniques` do SecurityAlert). As heurísticas ficam na spec 02.
13. Campos úteis sem lugar no schema vão para `extra` com nomes em snake_case.

## Mapeamento por fonte

### defender (Microsoft Defender XDR, Advanced Hunting export: CSV, JSON array ou NDJSON)
Tabela: coluna `TableName` | `Type` | `$table`. Se ausente, inferir: `SenderFromAddress` → EmailEvents; `RegistryKey` → DeviceRegistryEvents; `LogonType` → DeviceLogonEvents; `RemoteIP`+`ActionType` começando com `Connection` → DeviceNetworkEvents; `ActionType=ProcessCreated` → DeviceProcessEvents; `ActionType` começando com `File` → DeviceFileEvents; senão DeviceEvents. Horário: `Timestamp` (ou `TimeGenerated` quando vier do Sentinel). `host = normalize_host(DeviceName)`. `user` = `AccountName` ou `InitiatingProcessAccountName`. `action = ActionType`. `extra["table"]` = tabela.

| Tabela | event_type | Campos |
|---|---|---|
| DeviceProcessEvents | process | process←FileName, parent←InitiatingProcessFileName, cmdline←ProcessCommandLine, file_path←FolderPath, sha256←SHA256 |
| DeviceNetworkEvents | network | src_ip←LocalIP, dst_ip←RemoteIP, dst_port←RemotePort, domain←RemoteUrl, process←InitiatingProcessFileName, cmdline←InitiatingProcessCommandLine; outcome: ConnectionSuccess→success, *Failed→failure, *Blocked→blocked; extra.host_ip←LocalIP |
| DeviceFileEvents | file | file_path←FolderPath, process←InitiatingProcessFileName, sha256←SHA256 |
| DeviceRegistryEvents | registry | process←InitiatingProcessFileName; extra.registry_key←RegistryKey, registry_value_name, registry_value_data |
| DeviceLogonEvents | logon | src_ip←RemoteIP, extra.logon_type←LogonType; outcome LogonSuccess→success, LogonFailed→failure |
| DeviceEvents, ActionType=ScheduledTaskCreated/Updated | scheduled_task | process←InitiatingProcessFileName; extra.task_name/task_content de `AdditionalFields` (JSON) |
| DeviceEvents, ActionType=ServiceInstalled | service | idem, com extra.service_name |
| DeviceEvents, outros (ex.: OpenProcessApiCall) | other | process←InitiatingProcessFileName, extra.target_process←FileName (minúsculo), extra.additional_fields←JSON parseado; description ex.: `"rundll32.exe → OpenProcessApiCall em lsass.exe"` |
| EmailEvents | email | user←RecipientEmailAddress, src_ip←RemoteIP\|SenderIPv4, sha256←SHA256, action←DeliveryAction\|ActionType; extra.sender, subject, attachment←FileName |
| AlertInfo / AlertEvidence | alert | severity←Severity (minúsculo), description←Title, mitre←AttackTechniques (lista JSON ou CSV) |

### sentinel (Log Analytics export: JSON array, NDJSON ou CSV)
Tabela pela coluna `Type`. Horário: `TimeGenerated`.
- `SecurityEvent`: use `_winsec.map_windows_event(rec, provider="security")` (ver abaixo). `host = normalize_host(Computer)`.
- `SigninLogs` / `AADNonInteractiveUserSignInLogs`: reaproveite a lógica de `entra_signin` com aliases: UserPrincipalName, IPAddress, AppDisplayName, ResultType (código; `"0"` = sucesso), ResultDescription, LocationDetails (dict ou string JSON), RiskLevelDuringSignIn, UserAgent, DeviceDetail.
- `AuditLogs`: reaproveite `entra_audit` com aliases: OperationName, Result, InitiatedBy, TargetResources (dict ou string JSON).
- `Device*` (MDE via conector): reaproveite `defender`.
- `SecurityAlert`: event_type alert; description←AlertName; severity←AlertSeverity; host←CompromisedEntity (se parecer host); mitre←Techniques (lista JSON ou string separada por vírgula).
- `CommonSecurityLog`: network; src_ip←SourceIP, dst_ip←DestinationIP, dst_port←DestinationPort, domain←RequestURL\|DestinationHostName, outcome←DeviceAction (allow*/accept→success, deny/drop/block→blocked), extra.bytes_out←SentBytes, bytes_in←ReceivedBytes, observer←DeviceName.
- Outros: other, `description = f"{Type}: ..."`.

### `_winsec.map_windows_event(rec, provider)`: Windows Security e Sysmon
Lookup de campos **case-insensitive** com aliases (Sentinel, Splunk e Wazuh usam nomes diferentes):
- EventID: `EventID|EventCode|eventID`
- conta alvo: `TargetUserName|Account_Name|targetUserName|User|user`
- conta sujeito: `SubjectUserName|subjectUserName|Account`
- IP origem: `IpAddress|Source_Network_Address|ipAddress|SourceIp`
- tipo de logon: `LogonType|Logon_Type|logonType`
- imagem: `NewProcessName|New_Process_Name|Image|image`
- pai: `ParentProcessName|Creator_Process_Name|ParentImage|parentImage`
- linha de comando: `CommandLine|Process_Command_Line|commandLine`
- workstation: `WorkstationName|Workstation_Name|workstationName`

Security (`provider="security"`):
| EventID | event_type | notas |
|---|---|---|
| 4624 / 4625 | logon | user←conta alvo, src_ip←IP, extra.logon_type (int), extra.workstation; outcome success/failure |
| 4634 / 4647 | logon | action logoff |
| 4648 | logon | logon com credenciais explícitas |
| 4672 | logon | user←conta sujeito; description "privilégios especiais atribuídos"; extra.privileges←PrivilegeList |
| 4688 | process | process←imagem, parent←pai, cmdline, file_path←imagem completa, user←conta sujeito |
| 4698 / 4702 | scheduled_task | extra.task_name←TaskName |
| 7045 / 4697 | service | extra.service_name←ServiceName, extra.image_path←ImagePath\|ServiceFileName |
| 4720, 4722, 4724, 4728, 4732, 4738, 4756 | audit | alterações de conta e grupo |
| 1102 / 104 | audit | description "log de auditoria limpo" |
| outros | other | |

Sysmon (`provider="sysmon"`): 1 process (Hashes→sha256), 3 network (Image→process, DestinationIp/Port/Hostname, SourceIp→src_ip, extra.host_ip←SourceIp), 10 other (SourceImage→process, extra.target_process←TargetImage), 11 file (TargetFilename), 12/13/14 registry (TargetObject), 22 dns (QueryName→domain, primeiro IP de QueryResults→dst_ip). `action = f"sysmon:{eid}"`. Security usa `action = str(eid)`.

### entra_signin (Microsoft Entra ID sign-in logs: JSON array, `{"value": [...]}`, NDJSON)
event_type signin. ts←createdDateTime. user←userPrincipalName (extra.upn com o UPN completo). src_ip←ipAddress. host←normalize_host(deviceDetail.displayName) se houver. action←appDisplayName. outcome←success se `status.errorCode == 0`, senão failure. extra: error_code (int), failure_reason, city, country, risk_level←riskLevelDuringSignIn, user_agent, client_app←clientAppUsed, ca_status←conditionalAccessStatus, auth_requirement, signin_id←id.

### entra_audit (Entra ID audit logs: mesmos formatos)
event_type audit. ts←activityDateTime. action←activityDisplayName. outcome←result (success/failure). user←`initiatedBy.user.userPrincipalName` (ou `extra.initiated_by_app` ← `initiatedBy.app.displayName`, com user None). src_ip←`initiatedBy.user.ipAddress`. extra: category, logged_by_service, targets (lista de `userPrincipalName` ou `displayName`), details (dict `key→value` de additionalDetails). description ex.: `"Consent to application por m.silva → MailSync Pro"`.

### splunk (CSV export, JSON array de resultados ou linhas `{"result": {...}}`)
ts←`_time` (tem offset de fuso, ex.: `-03:00`). Despacho por `sourcetype` / `source`:
- contém `Sysmon` → `_winsec` provider sysmon; host←`host`.
- `WinEventLog:Security` / `XmlWinEventLog:Security` → `_winsec` provider security.
- firewall/proxy (`pan:*`, `cisco:asa`, `fortigate*`, `fgt_*`, `squid*`, `zscaler*`, ou presença de `src_ip`+`dest_ip`): network; host None, extra.observer←host; src_ip←src_ip\|src, dst_ip←dest_ip\|dest, dst_port←dest_port, domain←url\|dest_host, user←user; outcome: allowed/allow/accept→success, blocked/deny/drop/reset-*→blocked; extra.bytes_out/bytes_in (int), app.
- outros: other, com `extra.sourcetype`.

### elastic (ECS NDJSON, JSON array, ou export de busca `{"hits": {"hits": [{"_source": ...}]}}`)
ts←`@timestamp`. Acesso a campos com ponto **e** aninhados (`"host.name"` ou `{"host": {"name"}}`). Por `event.category` (lista ou string):
- process → process (process.name, process.parent.name, process.command_line, process.executable→file_path, process.hash.sha256, user.name)
- network com `dns.question.name` → dns (domain, dst_ip←primeiro dns.resolved_ip, src_ip←source.ip)
- network → network (source.ip, destination.ip, destination.port, destination.domain\|url.domain)
- authentication → logon (event.outcome, source.ip, user.name)
- file → file (file.path, file.hash.sha256); registry → registry (registry.path); iam → audit
- `kibana.alert.rule.name` presente → alert (severity←kibana.alert.severity, mitre←threat.technique.id / threat.technique.subtechnique.id)
- Regra de host vs. observador (item 8): sem `process.name` em network/dns, `host=None` e `extra.observer←host.name`.

### wazuh (`alerts.json`: NDJSON, um alerta por linha; também aceita JSON array)
ts←`timestamp` (offset sem dois-pontos, ex.: `-0300`; `parse_ts` já trata). host←normalize_host(agent.name), exceto `agent.id == "000"` (manager): use `data.srcip` como src_ip e host None. extra.host_ip←agent.ip. mitre←rule.mitre.id. severity pelo `rule.level`: 0–3 informational, 4–7 low, 8–11 medium, 12–14 high, ≥15 critical. extra: rule_id, rule_level, rule_description, rule_groups.
- Com `data.win.system.eventID`: provider sysmon se `providerName` contém "Sysmon", senão security. Use `_winsec` sobre `data.win.eventdata` (+ eventID do system). Sobrescreva `description` por `f"[Wazuh {rule.id}] {rule.description}"`.
- Sem evento Windows: se rule.groups contém `authentication_success`/`authentication_failed` → logon (user←data.dstuser, src_ip←data.srcip); senão → alert com description←rule.description.

### detect.py
`detect_source(path) -> str | None`: lê o cabeçalho (CSV) ou os primeiros registros (JSON/NDJSON) e decide pelas chaves:
- `rule` + `agent` → wazuh
- `@timestamp` ou `hits` → elastic
- `_time` → splunk (também `{"result": {...}}` com `_time`)
- `activityDisplayName` ou `activityDateTime` → entra_audit
- `createdDateTime` + `userPrincipalName` → entra_signin
- `TimeGenerated` → sentinel
- `Timestamp` + (`DeviceName` ou `ActionType` ou `SenderFromAddress`) → defender
- senão None

## Testes (obrigatórios, `uv run pytest` precisa passar)
Use os arquivos de `samples/caso-sintetico/`. No mínimo:
- `test_detect.py`: cada arquivo de amostra é detectado com a fonte certa. `GABARITO.md` → None.
- `test_parsers.py`:
  - contagens: defender 18, sentinel 7, entra_signin 7, entra_audit 3, splunk 7, elastic 4, wazuh 4.
  - todos os `ts_utc` terminam em `Z` e estão ordenados de forma não decrescente dentro de cada arquivo (as amostras já estão em ordem).
  - defender: o evento powershell tem `process="powershell.exe"`, `parent="excel.exe"`, `host="ws-fin-023"`, `user="m.silva"`, cmdline com `-enc`; o evento de rede para 203.0.113.45 tem `dst_port=443`, `domain="cdn-update.example-cdn.net"`, `extra["host_ip"]="10.10.20.23"`; EmailEvents → `event_type="email"`, `extra["attachment"]="Fatura_88213.xlsm"`; OpenProcessApiCall → `extra["target_process"]="lsass.exe"`; `raw_ref` do 1º registro é `"defender_advanced_hunting.csv:2"`.
  - sentinel: 4624 de svc_backup com `extra["logon_type"]=10`, `src_ip="10.10.20.23"`, `host="srv-file-01"`; 4688 do rclone com `process="rclone.exe"`, `parent="cmd.exe"`; 1102 → audit.
  - entra_signin: 3 falhas com `extra["error_code"]=500121`, depois sucesso do IP 198.51.100.77 com `extra["country"]="NL"`; `user="m.silva"`.
  - entra_audit: "User registered security info" com `src_ip="198.51.100.77"`; o consent tem `"MailSync Pro"` em `extra["targets"]`.
  - splunk: o `_time` `2026-11-10T10:57:40.120-03:00` vira `2026-11-10T13:57:40.120Z`; Sysmon 1 → process rclone.exe com sha256 em minúsculo; pan:traffic → network com `host is None`, `extra["observer"]="pa-fw-01"`, `extra["bytes_out"]` int.
  - elastic: dns com `domain`, `dst_ip`, `src_ip`, `host is None`, `extra["observer"]="dc01"`.
  - wazuh: `timestamp` `2026-11-10T10:40:15.512-0300` → `13:40:15.512Z`; o alerta RDP vira `event_type="logon"` com `mitre=["T1021.001"]`; o rclone vira process (Sysmon) com `severity="high"`.
  - linha corrompida: um NDJSON temporário com uma linha inválida no meio rende os registros válidos e `stats["ignorados"] == 1`.

## Resultado
Ao terminar, escreva `docs/tasks/01-resultado.md` com: arquivos criados, decisões tomadas fora da spec, saída do `uv run pytest -q` e pendências.
