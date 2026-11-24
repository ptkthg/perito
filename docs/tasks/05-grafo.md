# Spec 05: Grafo do ataque (`/grafo`) e filtro de domínio por substring

**Implementador:** Codex. **Revisor:** Claude. **Leia antes:** `AGENTS.md`, `src/perito/{schema,timeline,mitre}.py`, `src/perito/_network.py`, `src/perito/ui/{api,server}.py`, `tests/test_ui_api.py`.
**Não toque em** `ui/`, `docs/design/`, `schema.py`, `case.py`, `samples/`.

## Parte A: filtro `dominio` por substring
O frontend (modo fixtures) filtra `dominio` por "contém", sem diferenciar maiúsculas de minúsculas. O backend compara por igualdade. Alinhe `timeline.filter_events(domain=...)` para **substring case-insensitive**, aplicada sobre `ev.domain`. Isso vale também para a CLI (`--dominio`) e para a API. Atualize os testes existentes que dependam de igualdade e acrescente um teste: `dominio=example-cdn` casa `cdn-update.example-cdn.net`.

## Parte B: `src/perito/ui/graph.py` e `GET /api/casos/{id}/grafo`
Função pura `build_graph(events: list[Event], hosts_sem_edr: list[str]) -> dict`, chamada por `api.dispatch` sobre os eventos **já construídos** (`timeline.build`, com cache), mais a rota `/api/casos/{id}/grafo`. A rota é somente leitura e usa as mesmas proteções das demais. Query opcional `relevantes=1`, que devolve só nós e arestas com `suspeita` e seus vizinhos diretos.

### Nós
`id` com namespace: `email:<remetente>`, `conta:<user>`, `host:<host>`, `ip:<ip>`, `dominio:<fqdn>`, `app:<nome>`.
```json
{"id": "host:srv-file-01", "tipo": "email|conta|host|ip|dominio|app", "rotulo": "srv-file-01",
 "coluna": "entrada|interno|nuvem|saida",
 "flags": {"sem_edr": true, "externo": false, "nuvem": false, "onprem": true},
 "primeira": "...Z", "ultima": "...Z", "eventos": 19,
 "tecnicas": ["T1567.002", "T1070.001"], "relevante": true}
```
- `coluna`:
  - `email` → entrada;
  - `ip` que só aparece como **origem** de sign-in/MFA → entrada;
  - `host` e `conta` → interno;
  - `app` → nuvem;
  - `ip`/`dominio` destino de rede externa → saida.
- `flags.sem_edr`: o host está em `hosts_sem_edr`.
- `flags.nuvem`: conta com sign-in/audit do Entra.
- `flags.onprem`: conta com logon/processo em host.
- `tecnicas`: técnicas dos eventos do host (para `host`) ou dos eventos da conta (para `conta`).
- `relevante`: tem técnica ou alguma aresta `suspeita`.
- **Resolução IP→domínio:** monte um mapa `dst_ip → domain` com os eventos que têm os dois campos (DNS, rede). Destinos externos usam `dominio:<fqdn>` quando o IP está mapeado, guardando os IPs em `ips: [...]`; os demais usam `ip:<ip>`. Externo = `_network.is_external_ip`.

### Arestas
```json
{"id": "e7", "origem": "host:ws-fin-023", "destino": "host:srv-file-01",
 "tipo": "email|logon|rdp|smb|winrm|ssh|rede_externa|signin|mfa|consent",
 "rotulo": "RDP como svc_backup", "contas": ["svc_backup"],
 "primeira": "...Z", "ultima": "...Z", "contagem": 4, "sucesso": 3, "falha": 0,
 "bytes_out": 0, "volume_alto": false, "tecnicas": ["T1021.001"],
 "raw_refs": ["..."], "idxs": [37, 38], "suspeita": true}
```
`idxs` = posição do evento na timeline construída (o mesmo `idx` de `/eventos`). As arestas são agregadas por (origem, destino, tipo).

| Evento | Aresta |
|---|---|
| `email` | `email:<extra.sender>` → `conta:<user>`, tipo `email`, rótulo `"e-mail: <subject>"` (+ anexo) |
| `logon` com sucesso, sem `src_host` conhecido | `conta:<user>` → `host:<host>`, tipo `logon` |
| `logon` com `src_ip` resolvido em `extra.src_host` ≠ host | `host:<src_host>` → `host:<host>`; tipo `rdp` se `logon_type` ∈ {10, "RemoteInteractive"}, senão `logon`; `contas` += user |
| `network` com `dst_ip` interno resolvido em `extra.dst_host` e `dst_port` ∈ {3389: rdp, 445: smb, 5985/5986: winrm, 22: ssh} | `host:<host ou src_host>` → `host:<dst_host>` |
| `network`/`dns` com destino externo | `host:<host ou src_host>` → `dominio:`/`ip:`, tipo `rede_externa`; soma `extra.bytes_out`; `volume_alto` se algum evento tiver |
| `signin` | `ip:<src_ip>` → `conta:<user>`, tipo `signin`; conta `sucesso`/`falha` pelo outcome |
| `audit` "User/Admin registered security info" | `ip:<src_ip>` → `conta:<user>`, tipo `mfa` |
| `audit` "Consent to application" | `conta:<user>` → `app:<extra.targets[0]>`, tipo `consent` |

- **Eventos `dns` para um destino** também contam como `rede_externa`, mas eventos com `extra.observer` sem `src_host` resolvido são ignorados (não há origem).
- **`suspeita`:** algum evento da aresta tem técnica (`mitre` não vazio), ou `volume_alto`, ou é `signin` com falha `500121`.
- **`rotulo`** em pt-BR curto: `"RDP como svc_backup"`, `"enviou 2,4 GB"` (bytes formatados em GB/MB com vírgula decimal), `"3 MFA negados, 2 logins"`, `"novo dispositivo MFA"`, `"autorizou app (Mail.Read…)"`, `"e-mail: Fatura pendente NF 88213 (Fatura_88213.xlsm)"`.

Resposta: `{"nos": [...], "arestas": [...], "caminho": ["e1", "e5", ...]}`.
`caminho` = ids das arestas `suspeita` em ordem de `primeira`. O frontend usa para destacar o caminho do atacante.

## Testes (`tests/test_ui_graph.py`), sobre o caso sintético
1. Existem as arestas:
   - `email:faturas@pagamentos-fornecedor.example → conta:m.silva` (email, suspeita);
   - `conta:m.silva → host:ws-fin-023` (logon);
   - `host:ws-fin-023 → host:srv-file-01` (rdp, suspeita, `contas` contém `svc_backup`);
   - `host:srv-file-01 → dominio:bkp.example-storage.net` (rede_externa, `volume_alto`, `bytes_out` = 2469606194, `ips` do nó contém 198.51.100.200);
   - `host:ws-fin-023 → dominio:cdn-update.example-cdn.net` (suspeita).
2. Nuvem:
   - `ip:198.51.100.77 → conta:m.silva`: signin com falha 3 e sucesso 2, mais uma aresta mfa;
   - `conta:m.silva → app:MailSync Pro` (consent, suspeita);
   - o nó `ip:198.51.100.77` tem coluna `entrada`.
3. `host:srv-file-01` tem `flags.sem_edr`. `host:ws-fin-023` não tem.
4. O ruído (`www.office.com`, `j.souza`, `dc01$`) não é `suspeita` e, com `relevantes=1`, não aparece, salvo se for vizinho direto de uma aresta suspeita.
5. Todos os `idxs` apontam para eventos cujo `raw_ref` está em `raw_refs` da mesma aresta. `caminho` está em ordem cronológica.
6. A rota exige token e Host (reaproveite os helpers de `test_ui_api.py`).

Rode `.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp=.pytest_tmp`. Resultado em `docs/tasks/05-resultado.md`. Não faça commit.
