# Spec 06: Bancada de trabalho (escrita pela interface)

**Implementador:** Codex. **Revisor:** Claude. **Depende de:** specs 04 e 05.
**Leia antes:** `AGENTS.md`, `src/perito/{case,cli,timeline,mitre}.py`, `src/perito/ui/{api,server}.py`, `tests/test_ui_api.py`.
**Não toque em** `ui/`, `docs/design/`, `schema.py`, `samples/`. Em `case.py`, só se for indispensável, e registre o motivo.

## Princípios (obrigatórios, com testes)
1. **Mesma proteção das rotas GET:** token, Host e headers. Os métodos novos são `POST` e `PATCH` **somente** nas rotas abaixo. Qualquer outra combinação de método e rota → 405.
2. **Corpo JSON:** `Content-Type: application/json` obrigatório (senão 415) e limite de 1 MB (senão 413). A exceção é a ingestão (item 5).
3. **Versão otimista.** As leituras `/doc/{nome}`, `/hipoteses`, `/achados` e `/iocs` passam a enviar o header `X-Perito-Versao: <mtime_ns>-<tamanho>` do arquivo-alvo, e `/doc` também inclui `"versao"` no JSON. Toda escrita recebe `"versao"` no corpo. Se o arquivo mudou (por exemplo, um agente editou), a resposta é **409** `{"erro": "conflito", "versao_atual": "...", "conteudo_atual": "<texto atual>"}` e nada é gravado. Arquivo inexistente tem versão `"0-0"`.
4. **Escrita confinada:** só em `achados.md`, `hipoteses.md`, `limitacoes.md` e `iocs.csv` do caso, e, na ingestão, via `case.add_evidence` (brutas + custódia), `normalizado/` e `timeline/`. Use escrita atômica (arquivo temporário no mesmo diretório + `os.replace`) e um lock por caso (`threading.Lock`).
5. **Auditoria:** toda escrita bem-sucedida acrescenta uma linha JSON em `casos/<ID>/auditoria-ui.log`: `{"ts": "...Z", "acao": "...", "alvo": "...", "resumo": "...", "versao_antes": "...", "versao_depois": "..."}`.
6. **Respostas:** `{"ok": true, "versao": "<nova>", ...}` mais os dados descritos em cada rota.

## Rotas

### `POST /api/casos/{id}/ingestao`
- **Corpo:** os **bytes brutos de um arquivo** (`Content-Type: application/octet-stream`). Nome no header `X-Perito-Arquivo` (URL-encoded), fonte opcional em `X-Perito-Fonte` (`auto`|`defender`|...) e observação em `X-Perito-Obs`.
- **Nome do arquivo:** basename saneado (`[A-Za-z0-9._ -]`, sem `..`, até 128 caracteres; senão 400).
- **Tamanho:** `Content-Length` obrigatório, até 500 MB (senão 411/413).
- **Fluxo:** grava em streaming em `casos/<ID>/.uploads/<uuid>__<nome>`, chama `case.add_evidence` com `fonte` e `observacao`, e remove o temporário (sempre, inclusive em erro). Depois segue o mesmo fluxo de `cli._ingest` para **um** arquivo: detecção, parse da cópia bruta com `stats`, `mitre.annotate`, escrita em `normalizado/` e `timeline.build` + `write_outputs`. Extraia esse fluxo para uma função compartilhada em `cli.py` (ex.: `ingest_file(case, path, fonte, obs) -> dict`) e use-a também na CLI, sem mudar o comportamento dela.
- **Resposta:** `{"ok": true, "arquivo": "...", "fonte": "...", "eventos": n, "ignorados": n, "sha256": "...", "detectado": true|false}`. Fonte não detectada: `ok: true`, `detectado: false`, mensagem "registrado na custódia, sem parser".

### `POST /api/casos/{id}/achados`
- **Corpo:** `{"idx": 12, "achado": "texto", "attack": ["T1059.001"], "versao": "..."}`.
- **Busca do evento:** `idx` na timeline construída. Se não existir → 404.
- **Linha nova da tabela:** `| A<n> | <ts_utc> | <host ou ~src_host ou —> | <user ou —> | <achado> | <attack, ", "> | <raw_ref>[; corroborado_por...] |`.
  - `n` = maior `A<n>` existente + 1.
  - Escape `|` como `\|` e remova quebras de linha.
  - `achado` de 3 a 300 caracteres. `attack` só com IDs válidos `T\d{4}(\.\d{3})?`.
- **Arquivo sem a tabela:** crie o cabeçalho `| # | UTC | Host | Conta | Achado | ATT&CK | Evidência |` antes da primeira linha.
- **Resposta:** `{"ok": true, "id": "A15", "versao": "..."}`.

### `POST /api/casos/{id}/hipoteses` e `PATCH /api/casos/{id}/hipoteses/{Hn}`
- **POST (nova hipótese):** `{"titulo", "confianca", "sustentacao"?, "confirmaria"?, "refutaria"?, "proximo_passo"?, "fase"?, "versao"}`. Acrescenta `## H<n+1>: <titulo>` com os bullets no formato do esqueleto e `Status: aberta`. Se o arquivo só tiver o placeholder `## H1: <título>` do esqueleto, substitua o placeholder.
- **PATCH:** `{"status"?, "confianca"?, "proximo_passo"?, "refs_add"?: ["raw_ref" | "A6"], "versao"}`.
  - Altera **no lugar** apenas os bullets correspondentes da seção `## Hn:`.
  - Bullet ausente: crie-o no fim da seção.
  - `refs_add` acrescenta ` [EVIDÊNCIA] <ref>` ao bullet `Sustentação`, sem duplicar.
  - O resto do arquivo fica **byte a byte igual** (com teste).
- **Validação:**
  - `status` ∈ {aberta, confirmada, refutada, inconclusiva};
  - `confianca` ∈ {baixa, média, alta} (aceite `media` sem acento e normalize);
  - `Hn` inexistente → 404.

### `POST /api/casos/{id}/iocs` e `PATCH /api/casos/{id}/iocs`
- **POST:** `{"tipo", "valor", "primeira_vez_utc"?, "ultima_vez_utc"?, "fonte"?, "contexto"?, "confianca"?: "candidato", "versao"}`. Acrescenta em `iocs.csv` (cabeçalho `case.IOC_HEADER`). O par `(tipo, valor)` já existente → 200 com `{"ok": true, "existente": true}`, sem duplicar.
- **PATCH:** `{"tipo", "valor", "confianca": "candidato|confirmado|descartado", "versao"}`. Altera só a coluna `confianca` da linha. Linha inexistente → 404.
- **`tipo`** ∈ {ip, dominio, sha256, arquivo, email, url}.

### `POST /api/casos/{id}/limitacoes`
- **Corpo:** `{"limitacao", "impacto", "mitigacao", "versao"}` (3 a 400 caracteres cada).
- **Efeito:** acrescenta `| L<n> | ... | ... | ... |` na tabela de `limitacoes.md`, criando o cabeçalho se faltar.
- **Numeração:** `n` = maior `L<n>` existente + 1. Linhas antigas numeradas só com `1`, `2`... contam como L1, L2....

## Testes (`tests/test_ui_writes.py`), com o servidor real em porta efêmera e o caso sintético em `tmp_path`
1. **Ingestão:**
   - Enviar `samples/caso-sintetico/wazuh_alerts.json` para um caso vazio cria 1 linha de custódia e 4 eventos em `/eventos`.
   - Reenviar não duplica a custódia.
   - Nome `../../x.json` → 400. Sem `Content-Length` → 411.
   - Um arquivo `.txt` qualquer → `detectado: false`, com custódia registrada.
   - Nenhum temporário sobra em `.uploads/`.
2. **Achados:**
   - `idx` do PowerShell cria `A15`, com o `raw_ref` correto, e `/achados` passa a ter 15 linhas.
   - Com a versão antiga → 409, e o arquivo fica intacto.
3. **Hipóteses:**
   - PATCH H2 para `status=aberta, confianca=média` muda só essas duas linhas (diff dos bytes do restante igual).
   - `refs_add` acrescenta sem duplicar.
   - POST cria H4.
   - `status=xyz` → 400.
4. **IOCs:**
   - POST de um IP novo funciona, e o par duplicado devolve `existente`.
   - PATCH para `confirmado` aparece em `/iocs.registrados`.
5. **Limitações:** POST cria L4 no TESTE sintético (que tem L1–L3).
6. **Segurança:**
   - POST sem token → 403. `Content-Type: text/plain` → 415. 2 MB de JSON → 413.
   - PATCH em `/api/casos` → 405. POST em `/api/casos/{id}/doc/caso` → 405.
   - Nenhum teste grava em `evidencias/brutas` fora do `add_evidence`, e `verify_custody` continua íntegro.
7. **Auditoria:** cada escrita gera uma linha JSON válida em `auditoria-ui.log`.
8. **CLI:** `perito ingerir` continua passando nos testes existentes, agora usando `ingest_file`.

Rode `.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp=.pytest_tmp`. Resultado em `docs/tasks/06-resultado.md`. Não faça commit.
