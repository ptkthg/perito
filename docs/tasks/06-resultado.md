# Resultado da implementação — Spec 06

## Resumo

Implementado o backend da bancada de trabalho conforme `docs/tasks/06-escrita.md`, apenas com stdlib e sem commit.

- `src/perito/ui/server.py`: POST/PATCH restritos às rotas previstas, mesmas verificações de token e Host e mesmos headers de segurança das leituras. Validação de JSON, Content-Type e tamanho; upload em streaming com limite de 500 MB, validação do nome e remoção do temporário inclusive em erro.
- `src/perito/ui/writes.py`: lock por caso, confinamento dos destinos, comparação de versão, conflitos 409 com conteúdo atual, achados vinculados à timeline, criação e atualização de hipóteses, IOCs individuais/em lote e limitações. Auditoria JSONL de cada operação bem-sucedida, inclusive IOC já registrado, sem duplicar o IOC.
- `src/perito/ui/api.py`: GET `/api/formatos`, versão no JSON de `/doc` e campos `contradiz` e `justificativa` no parser de hipóteses. O servidor acrescenta `X-Perito-Versao` às leituras previstas.
- `src/perito/cli.py`: `ingest_file` compartilhado entre HTTP e CLI. A CLI mantém a saída e a reconstrução única da timeline ao final do lote, usando `rebuild=False`; HTTP reconstrói após o arquivo recebido.
- `src/perito/_atomic.py` e `src/perito/timeline.py`: temporários no mesmo diretório, flush/fsync e `os.replace` para documentos, normalizados e saídas da timeline. Falhas removem o temporário sem substituir o original.
- `tests/test_ui_writes.py`: 32 testes com servidor real em porta efêmera e casos isolados em `tmp_path`.

## Verificação

Comando executado na raiz, sem acesso à rede:

```powershell
.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp=.pytest_tmp
```

Resultado final: **163 passed in 34.95s**, exit code **0**.

A cobertura inclui ingestão dos quatro eventos Wazuh, deduplicação de custódia, fonte não detectada, limpeza de uploads após sucesso e falha do parser, integridade de hashes, criação de A15/H4/L4, versões e conflitos concorrentes, validação de entradas, preservação byte a byte em PATCH de hipóteses (incluindo CRLF/BOM), referências sem duplicação, exigências para confirmação/refutação, lote de IOCs sem gravação parcial, auditoria e falha de substituição atômica. Os testes existentes da CLI continuam passando.

`git diff --check -- src/perito tests/test_ui_writes.py` passou sem apontamentos.

## Desvios e escopo

Nenhum desvio funcional da spec. `case.py` não precisou de alteração.

Não foram editados `ui/`, `docs/design/`, `schema.py`, `samples/` ou as specs. Há alterações concorrentes de frontend no workspace; elas foram preservadas e não fazem parte desta implementação. Os únicos arquivos desta entrega são os sete arquivos de código/testes listados acima e este relatório.

Nenhum commit realizado.
