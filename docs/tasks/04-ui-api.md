# Spec 04: Servidor local e API da interface (`perito ui`)

**Implementador:** Codex. **Revisor:** Claude. **Leia antes:** `AGENTS.md`, `src/perito/{schema,case,timeline,mitre,cli}.py`.
**Restrições:** só stdlib (`http.server`, `json`, `secrets`, `urllib.parse`, `threading`, `webbrowser`). Não altere `schema.py`/`case.py`. Não toque em `ui/` (frontend, feito por outro agente) nem em `docs/design/`.

## Arquivos
```
src/perito/ui/__init__.py
src/perito/ui/api.py       # funções puras: (case_base: Path, rota, query) -> (status, dict); sem HTTP
src/perito/ui/server.py    # ThreadingHTTPServer + Handler; serve static/ e /api/*; segurança
src/perito/ui/static/      # build do frontend (não crie conteúdo além de um .gitkeep)
src/perito/cli.py          # novo subcomando `ui`
tests/test_ui_api.py
```

## Segurança (obrigatória, com testes)
1. Bind **só** em `127.0.0.1`.
2. **Token de sessão:** `secrets.token_urlsafe(24)`, ou `--token T` / env `PERITO_UI_TOKEN` (para desenvolvimento com o Vite). Toda rota `/api/*` exige o header `X-Perito-Token` igual ao token, senão 403 `{"erro": "token inválido"}`. Compare com `secrets.compare_digest`.
3. **Header `Host`:** aceite apenas `127.0.0.1:<porta>` e `localhost:<porta>`. Qualquer outro valor → 403 (proteção contra DNS rebinding). Vale para todas as rotas, inclusive as estáticas.
4. **`index.html`:** ao servir, substitua a string `__PERITO_TOKEN__` pelo token. Todas as outras respostas da API levam `Cache-Control: no-store`.
5. **Path traversal:** os IDs de caso passam por `case.validate_case_id`. Nomes de documento só por whitelist (abaixo). Os arquivos estáticos são resolvidos e precisam estar **dentro** de `static/` (`Path.resolve()` + `is_relative_to`).
6. Cabeçalhos em todas as respostas: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` e `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'`.
7. Nesta spec só há **leitura** (GET). Qualquer outro método em `/api` → 405.

## Rotas e formatos JSON (contrato com o frontend; siga exatamente)
Todos os horários em ISO UTC `...Z`, como na timeline. Erros: `{"erro": "<mensagem pt-BR>", "detalhe": "..."}` com status 400/403/404/405/500.

### `GET /api/casos`
```json
[{"id": "TESTE-001", "titulo": "Caso sintético: ...", "fase": "Detectar / Identification", "evidencias": 7, "eventos": 50}]
```
`titulo` e `fase` vêm do `caso.md` (1ª linha `# Caso <ID>: <titulo>` e a linha `**Fase (...):** <valor>`). `evidencias` = linhas de `custodia.csv`. `eventos` = total após `build`.

### `GET /api/casos/{id}/resumo`
```json
{"id": "TESTE-001", "titulo": "...", "fase": "...", "total_eventos": 50,
 "janela": {"primeiro": "...Z", "ultimo": "...Z"},
 "por_fonte": {"defender": {"eventos": 18, "primeiro": "...Z", "ultimo": "...Z"}},
 "por_tipo": {"process": 12},
 "tecnicas": [{"id": "T1003.001", "nome": "LSASS Memory", "tatica": "Acesso a credenciais", "eventos": 2}],
 "hosts_sem_edr": ["srv-file-01"],
 "custodia": {"integra": true, "arquivos": 7, "problemas": []},
 "contagens": {"hipoteses": 3, "achados": 14, "limitacoes": 3, "iocs_registrados": 0}}
```
Reaproveite `timeline.coverage`, `mitre.TECHNIQUES` e `case.verify_custody`. Técnicas ordenadas por tática, depois por id.

### `GET /api/casos/{id}/eventos`
Query (todas opcionais, mesma semântica de `timeline.filter_events`): `host, user, ip, hash, dominio, de, ate, fonte, tipo, texto`, mais `limite` (int). `fonte`/`tipo` aceitam lista separada por vírgula. **Novo:** `excluir_<campo>=valor` (repetível) para `host,user,ip,fonte,tipo` remove eventos que casam (o frontend usa para `F`/`campo!=v`).
```json
{"total": 50, "filtrados": 18, "eventos": [{"idx": 0, "ts_utc": "...", "source": "defender", "event_type": "process", "...": "todos os campos de Event.to_dict()"}]}
```
`idx` = posição do evento na timeline completa ordenada, que é a chave estável usada pelo frontend. **Cache** em memória por caso, invalidado quando muda o maior `mtime` (ou a quantidade) de `normalizado/*.jsonl`.

### `GET /api/casos/{id}/histograma?bucket=60`
`bucket` em segundos (mín. 1, padrão: o escolhido para ~120 baldes na janela total). Aceita os **mesmos filtros** de `/eventos`.
```json
{"bucket_s": 60, "inicio": "...Z", "fim": "...Z", "n_baldes": 272,
 "fontes": {"defender": [0, 3, 0, 1]},
 "cobertura": {"defender": {"primeiro": "...Z", "ultimo": "...Z"}},
 "marcas": [{"ts": "...Z", "tipo": "log_limpo", "raw_ref": "..."}, {"ts": "...Z", "tipo": "volume_alto", "raw_ref": "..."}]}
```
- `inicio` = piso do primeiro evento no bucket. Cada lista tem `n_baldes` posições.
- `cobertura` = primeiro/último evento **de cada fonte no caso inteiro**, sem filtro. O frontend usa para pintar "SEM DADOS" fora dessa janela.
- `marcas`: `log_limpo` para audit com action 1102/104; `volume_alto` para `extra.volume_alto`.

### `GET /api/casos/{id}/entidades`
Saída de `timeline.entities(build(...))` como está (`{"host": {"ws-fin-023": {"primeira", "ultima", "eventos", "fontes"}}, "user": ..., ...}`).

### `GET /api/casos/{id}/iocs`
```json
{"candidatos": ["...linhas de timeline.ioc_candidates..."], "registrados": ["...linhas de iocs.csv como dict..."]}
```

### `GET /api/casos/{id}/docs` e `GET /api/casos/{id}/doc/{nome}`
Whitelist: `caso`, `triagem`, `achados`, `hipoteses`, `escopo`, `limitacoes`, `acoes` (→ `<nome>.md`), `revisoes/<arquivo>.md` e `relatorios/<arquivo>.md` (nome de arquivo `[A-Za-z0-9._-]+\.md`, sem barras extras).
- `/docs` → `[{"nome": "hipoteses", "grupo": "caso|revisoes|relatorios", "bytes": 1234, "mtime": "...Z"}]`
- `/doc/{nome}` → `{"nome": "...", "grupo": "...", "conteudo": "<markdown>", "mtime": "...Z"}`. Para `revisoes/x.md`, use a rota `/doc/revisoes/x.md`.

### `GET /api/casos/{id}/hipoteses` (parser estruturado de `hipoteses.md`)
Seções `## H<n>: <título>` com bullets `- **Campo:** valor`. Campos reconhecidos (case-insensitive, sem acento opcional): Status, Confiança, Fase ATT&CK, Sustentação, Confirmaria, Refutaria, Próximo passo.
```json
[{"id": "H2", "titulo": "Credencial de svc_backup obtida do dump do LSASS", "status": "aberta|confirmada|refutada|inconclusiva|<texto original>",
  "confianca": "baixa|média|alta|null", "fase": "...", "sustentacao": "...", "confirmaria": "...", "refutaria": "...", "proximo_passo": "...",
  "refs": ["defender_advanced_hunting.csv:3", "A6"], "linha": 11}]
```
`refs` = tokens no texto que parecem `raw_ref` (`<arquivo>.<ext>:<n>`, `<arquivo>.<ext>#<n>`, intervalos `:15-17`) ou IDs de achado (`A<n>`). `linha` = número da linha do `##` (base 1). Seções incompletas não quebram: campos ausentes = `null`. Ignore o placeholder do esqueleto (`## H1: <título>`).

### `GET /api/casos/{id}/achados` (parser da tabela de `achados.md`)
Tabela `| # | UTC | Host | Conta | Achado | ATT&CK | Evidência |`.
```json
[{"id": "A6", "utc": "2026-11-10T13:15:30.660Z", "host": "ws-fin-023", "conta": "m.silva", "achado": "...", "attack": ["T1003.001"], "evidencia": ["defender_advanced_hunting.csv:15-17"], "linha": 10}]
```
`attack` = IDs `T\d{4}(\.\d{3})?` encontrados. `evidencia` = refs separadas por `;`.

### Estáticos
- `GET /` e qualquer rota sem extensão fora de `/api` → `static/index.html` (com o token substituído). Arquivos com extensão → o arquivo correspondente de `static/` com o MIME correto (`.js`, `.css`, `.woff2`, `.svg`, `.json`, `.map`).
- Sem `static/index.html`: responda 200 com uma página mínima em texto: `Frontend não construído. Rode: cd ui && npm install && npm run build`.

## CLI
`uv run perito ui [--porta 8765] [--caso ID] [--sem-navegador] [--token T]`
- Porta ocupada → erro amigável (exit 1) sugerindo `--porta`.
- Imprime: `PERITO UI em http://127.0.0.1:<porta>/#/caso/<ID>`. O token **não** aparece na URL (ele vem embutido no index.html). Com `--token`/env, imprima também `token de desenvolvimento ativo`.
- Abre o navegador (`webbrowser.open`) a menos que `--sem-navegador`.
- Ctrl+C encerra limpo (exit 0).

## Testes (`tests/test_ui_api.py`)
Suba o servidor numa thread com porta 0 (efêmera) e um caso criado em `tmp_path` com as amostras do caso sintético, via funções do `cli`/`case`, mais `achados.md`/`hipoteses.md` de exemplo. Use `urllib.request`.
1. Sem token → 403. Token errado → 403. Token certo → 200.
2. `Host: evil.example:PORT` → 403, inclusive em `/`.
3. `/api/casos` lista o caso. `/resumo` tem `total_eventos == 50`, `hosts_sem_edr` contém `srv-file-01` e as técnicas incluem `T1003.001` com nome e tática.
4. `/eventos?host=srv-file-01` dá a mesma contagem de `timeline.filter_events(host=...)`. `excluir_fonte=splunk` remove os eventos do Splunk. `idx` é estável entre chamadas.
5. `/histograma?bucket=60`: a soma de todos os baldes é igual a `filtrados`, `n_baldes` bate com o tamanho das listas e há marca `log_limpo` e marca `volume_alto`.
6. `/doc/../../custodia.csv`, `/doc/evidencias/brutas/x`, `/doc/revisoes/../caso.md` → 400/404, e o conteúdo **nunca** é servido. Static traversal (`/..%2f..%2fpyproject.toml`) → 404.
7. `/hipoteses` parseia H1–H3 do exemplo (status, confiança, refs) e ignora o placeholder. `/achados` parseia as linhas com `attack` e `evidencia`.
8. `POST /api/casos` → 405.
9. `index.html` de teste em um `static/` temporário: o token é substituído e os headers de segurança estão presentes. Torne o diretório static configurável na criação do servidor para o teste.
10. Cache: depois de regravar um `normalizado/*.jsonl` com um evento a mais, `/eventos` reflete a mudança.

Rode com `.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp=.pytest_tmp` (sem rede). Todos os testes existentes continuam verdes.

## Resultado
`docs/tasks/04-resultado.md`: arquivos, decisões, desvios, saída do pytest. Não faça commit.
