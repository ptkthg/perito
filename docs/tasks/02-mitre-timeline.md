# Spec 02: Heurísticas MITRE ATT&CK e motor de timeline

**Implementador:** Codex. **Revisor:** Claude. **Depende de:** spec 01.
**Leia antes:** `AGENTS.md`, `src/perito/schema.py`, `src/perito/case.py`.

## Parte A: `src/perito/mitre.py`

### API
```python
TECHNIQUES: dict[str, tuple[str, str]]   # "T1059.001" -> ("PowerShell", "Execução")  (nome, tática em PT-BR)
def suggest(ev: Event) -> list[str]       # técnicas sugeridas para um evento (sem duplicatas, ordenadas)
def annotate(ev: Event) -> Event          # ev.mitre = sorted(set(ev.mitre) | set(suggest(ev))); ev.extra["mitre_heuristica"] = suggest(ev)
```
Matching **case-insensitive** sobre `cmdline`, `process`, `parent`, `action`, `file_path`, `extra`.

### Regras mínimas
| Condição | Técnica(s) |
|---|---|
| email com anexo de extensão `.xlsm .xlsb .docm .doc .xls .iso .img .lnk .zip .rar .html .htm .one .js .vbs` | T1566.001 |
| email com URL (`extra.urls` ou `extra.url`) sem anexo | T1566.002 |
| `parent` ∈ {winword.exe, excel.exe, powerpnt.exe, outlook.exe, onenote.exe, msaccess.exe} **e** `process` ∈ {powershell.exe, pwsh.exe, cmd.exe, wscript.exe, cscript.exe, mshta.exe, rundll32.exe, regsvr32.exe, certutil.exe} | T1204.002 |
| process powershell/pwsh | T1059.001; com `-enc`/`-e `/`-encodedcommand`/`frombase64string` também T1027 |
| process cmd.exe com cmdline não vazia | T1059.003 |
| wscript/cscript | T1059.005 |
| mshta | T1218.005 · regsvr32 → T1218.010 · rundll32 **sem** comsvcs → T1218.011 |
| `DownloadString`, `DownloadFile`, `Invoke-WebRequest`, `iwr `, `wget `, `curl `, `certutil` com `-urlcache`, `bitsadmin /transfer`, `Start-BitsTransfer` | T1105 |
| `schtasks` com `/create`, ou event_type scheduled_task, ou action 4698 | T1053.005 |
| `sc create`/`sc.exe create`, `New-Service`, event_type service, 7045/4697 | T1543.003 |
| registry ou cmdline com `\CurrentVersion\Run` ou `\RunOnce` | T1547.001 |
| `comsvcs.dll` + `minidump`; `procdump` + `lsass`; `extra.target_process == "lsass.exe"` (OpenProcessApiCall, Sysmon 10); `sekurlsa`/`mimikatz` | T1003.001 |
| `reg save` + `hklm\sam` ou `hklm\security` | T1003.002 · `ntdsutil`/`ntds.dit` → T1003.003 |
| logon com `extra.logon_type` 10 ou `"RemoteInteractive"`; process mstsc.exe; network com `dst_port == 3389` | T1021.001 |
| psexec/`psexesvc`/`\admin$` | T1021.002 e T1569.002 · `wsmprovhost`/`Enter-PSSession`/`winrs` → T1021.006 |
| `rclone` (process ou cmdline), `megacmd`, `megasync`, `restic` com destino remoto | T1567.002 |
| 1102 / 104 / `wevtutil cl` / `Clear-EventLog` | T1070.001 |
| `vssadmin delete shadows`, `wmic shadowcopy delete`, `bcdedit` + `recoveryenabled no` | T1490 |
| `whoami` → T1033 · `net group`/`net localgroup` → T1069 · `nltest /domain_trusts` → T1482 · `net view`/`adfind` → T1018 |
| signin com `extra.error_code == 500121` | T1621 |
| signin com sucesso e `extra.risk_level` ∈ {medium, high} | T1078.004 |
| audit `User registered security info`, `Admin registered security info`, `User registered all required security info`, `Update user` com detalhe de StrongAuthentication | T1098.005 |
| audit `Consent to application` | T1528 |
| audit `Add member to role` / `Add eligible member to role` | T1098.003 |
| audit `Add service principal credentials` / `Update application – Certificates and secrets management` | T1098.001 |
| cmdline/action `New-InboxRule`/`Set-InboxRule` | T1564.008 |
| network para IP público (`not is_private_ip(dst_ip)`) com `process` ∈ {powershell.exe, pwsh.exe, rundll32.exe, regsvr32.exe, mshta.exe} | T1071.001 |

Não crie regra para "volume alto": isso vai para `extra["volume_alto"]` na timeline (parte B).

`TECHNIQUES` deve conter **todas** as técnicas citadas acima (nome oficial em inglês e tática em PT-BR, ex.: "Acesso inicial", "Execução", "Persistência", "Escalonamento de privilégios", "Evasão de defesa", "Acesso a credenciais", "Descoberta", "Movimentação lateral", "Coleta", "Comando e controle", "Exfiltração", "Impacto"). Inclua também T1078, T1078.002, T1078.004, T1110, T1110.003, T1027, T1071.001, T1041, T1048.

## Parte B: `src/perito/timeline.py`

### API
```python
def load_events(case: Case) -> list[Event]                       # lê normalizado/*.jsonl
def build(events: list[Event]) -> list[Event]                    # ordena + dedupe + enriquece + corrobora
def ip_host_map(events) -> dict[str, str]                        # ip -> host (a partir de extra.host_ip; ignora IPs públicos)
def filter_events(events, *, host=None, user=None, ip=None, sha256=None, domain=None,
                  de=None, ate=None, fonte=None, tipo=None, texto=None) -> list[Event]
def entities(events) -> dict[str, dict[str, dict]]               # {"host": {"ws-fin-023": {"primeira": ts, "ultima": ts, "eventos": n, "fontes": [...]}} , "user": ..., "ip": ..., "domain": ..., "sha256": ..., "process": ...}
def coverage(events) -> dict                                     # ver abaixo
def ioc_candidates(events) -> list[dict]                         # linhas no formato de IOC_HEADER (case.py)
def write_outputs(case: Case, events: list[Event]) -> dict[str, Path]   # timeline.jsonl, timeline.csv, timeline.md
def render_md(events, limite: int | None = None) -> str
```

### Comportamento
1. **Ordenação:** por (`ts_utc`, `source`, `raw_ref`), estável.
2. **Dedupe:** eventos com o mesmo `dedupe_key()` ficam só uma vez (o primeiro), com `extra["duplicatas"] = n` (n ≥ 1 cópias removidas).
3. **Enriquecimento IP→host:** `ip_host_map` usa `extra.host_ip` + `host` dos eventos (só IPs privados). Para cada evento, se `src_ip` estiver no mapa e for diferente do próprio host, grave `extra["src_host"]`. Se `dst_ip` estiver no mapa, grave `extra["dst_host"]`.
4. **Volume alto:** evento network com `extra.bytes_out >= 100 * 1024**2` para IP público → `extra["volume_alto"] = True`.
5. **Corroboração:** dois eventos de **fontes diferentes** são o mesmo fato quando: mesmo `event_type` (ou par compatível: `logon`×`logon`, `process`×`process`, `network`×`network`, `dns`×`dns`), |Δt| ≤ 2 s e mesma chave de entidade:
   - process: (host efetivo, process)
   - logon: (host efetivo, user)
   - network/dns: (src_ip ou host efetivo, dst_ip ou domain)
   - audit com action 1102/104: (host efetivo, action)
   ("host efetivo" = `host` ou `extra.src_host`.) Grave `extra["corroborado_por"] = [raw_ref, ...]` nos **dois** sentidos. **Não remova** corroborados: cada fonte é uma evidência independente.
6. **Filtros:** `host` casa com host, `extra.src_host`, `extra.dst_host` e `extra.observer`. `user` passa por `normalize_user` antes de comparar. `ip` casa com src_ip, dst_ip e `extra.host_ip`. `de` e `ate` aceitam qualquer formato de `parse_ts` (inclusivos). `texto` faz busca case-insensitive em description, cmdline, file_path e domain. `fonte`/`tipo` aceitam lista separada por vírgula.
7. **coverage(events)** devolve:
   ```python
   {"por_fonte": {fonte: {"eventos": n, "primeiro": ts, "ultimo": ts}},
    "por_tipo": {tipo: n},
    "tecnicas": {tid: n},
    "hosts_sem_edr": [host, ...],        # hosts que aparecem em `host`, `extra.src_host` ou `extra.dst_host` (NÃO em observer) e não têm nenhum evento da fonte defender nem evento process da fonte elastic. Sysmon não conta como EDR.
    "janela": {"primeiro": ts, "ultimo": ts}}
   ```
   No caso sintético, o esperado é exatamente `["srv-file-01"]`.
8. **ioc_candidates:** IPs públicos (src/dst), domínios (exceto os terminados em `.local`, e também `office.com`, `microsoft.com`, `windows.net`, `live.com` e subdomínios: allowlist em constante `DOMINIOS_IGNORADOS`), sha256 de eventos process/file/email cujo processo, arquivo ou anexo não seja de `C:\Windows\` ou `C:\Program Files`, caminhos de arquivo em `\AppData\`, `\ProgramData\`, `\Users\Public\`, `\Temp\`, e remetentes de e-mail. Uma linha por (tipo, valor), com primeira/última vez, fontes (`;`), contexto (description do primeiro evento, ≤ 120 caracteres) e `confianca="candidato"`. Tipos: `ip`, `dominio`, `sha256`, `arquivo`, `email`.
9. **write_outputs:** grava em `case.timeline_dir`:
   - `timeline.jsonl` (um Event por linha)
   - `timeline.csv` com colunas: `ts_utc,source,event_type,host,user,src_ip,dst_ip,dst_port,domain,process,parent,cmdline,file_path,sha256,action,outcome,severity,mitre,description,raw_ref,src_host,dst_host,corroborado_por` (listas unidas por `;`)
   - `timeline.md`: tabela `| UTC | Fonte | Host | Conta | Evento | ATT&CK | Ref |`, com Host = host ou `src_host*` ou `(obs: observer)`, Evento = description (cmdline truncada a 120 caracteres com `…`) e marcadores `⧉n` quando houver corroboração e `⚠ volume` quando houver volume alto.

## Testes (`tests/test_mitre.py`, `tests/test_timeline.py`)
Use os parsers da spec 01 sobre todas as amostras do caso sintético + `mitre.annotate`:
- O conjunto de técnicas da timeline contém, no mínimo: T1566.001, T1204.002, T1059.001, T1027, T1105, T1053.005, T1003.001, T1621, T1078.004, T1098.005, T1528, T1021.001, T1567.002, T1070.001, T1071.001.
- Ruído **sem** técnica: ms-teams.exe, msedge → www.office.com e o logon de DC01$.
- O 1º evento malicioso (email) às `2026-11-10T13:02:11.341Z`; o 1º evento da timeline inteira às `11:30:00.000Z`.
- `ip_host_map` contém `10.10.20.23 → ws-fin-023` e `10.10.30.5 → srv-file-01`.
- O 4624 tipo 10 do Sentinel (13:40:12.000) e o alerta RDP do Wazuh (13:40:15.512) **não** se corroboram (Δ > 2 s). O 4688 do rclone (Sentinel 13:57:40.000) e o Sysmon 1 do Splunk (13:57:40.120) **se corroboram**.
- A sessão de FW com `bytes_out` 1288490188 tem `volume_alto`. A de 4521 não tem.
- `filter_events(host="srv-file-01")` inclui o evento de FW de 10.10.30.5 (via src_host).
- `ioc_candidates` inclui 203.0.113.45, 198.51.100.200, 198.51.100.77, cdn-update.example-cdn.net, bkp.example-storage.net e o sha256 de updater.exe. **Não** inclui www.office.com nem IPs privados.
- Dedupe: duplicar um evento na entrada resulta na mesma contagem e em `extra["duplicatas"] == 1`.
- `write_outputs` em um `tmp_path` gera os 3 arquivos, e o CSV tem o cabeçalho especificado.

## Resultado
Escreva `docs/tasks/02-resultado.md` (arquivos, desvios, saída do pytest, pendências).
