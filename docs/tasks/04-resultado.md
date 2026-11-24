# Resultado da Spec 04 — Servidor local e API da interface

Implementador: Codex. Sem commit.

## Arquivos

- `src/perito/ui/__init__.py`: pacote da interface local.
- `src/perito/ui/api.py`: dispatcher independente de HTTP, consultas somente leitura, cache de timeline, filtros/exclusões, histograma, documentos e parsers estruturados de hipóteses/achados.
- `src/perito/ui/server.py`: `ThreadingHTTPServer`, proteção de Host/token/caminhos, headers, arquivos estáticos e inicialização da sessão.
- `src/perito/cli.py`: subcomando `ui` com `--porta`, `--caso`, `--sem-navegador` e `--token`.
- `tests/test_ui_api.py`: 35 testes, contando parametrizações.
- `docs/tasks/04-resultado.md`: este registro.

`src/perito/ui/static/.gitkeep` já existia e foi preservado; nenhum conteúdo de frontend foi criado. Não houve alteração em `ui/`, `docs/design/`, `schema.py`, `case.py`, `samples/` ou nas specs. O arquivo preexistente `docs/tasks/codex-execucao-2.md` foi preservado.

## Decisões

- `dispatch(case_base, route, query, cache=...)` retorna `(status, objeto JSON)`, sem HTTP ou escrita em disco. A query aceita strings ou listas de strings, incluindo parâmetros de exclusão repetidos.
- O servidor mantém um `TimelineCache` por sessão. A assinatura inclui nome, `mtime_ns` e tamanho de cada normalizado: invalida com alteração do maior mtime ou da quantidade, e também detecta alterações nos demais arquivos. O acesso concorrente é protegido por locks.
- Todas as consultas reutilizam `timeline.build`, `filter_events`, `coverage`, `entities` e `ioc_candidates`, além de `case.verify_custody` e `mitre.TECHNIQUES`. A API não chama `timeline.write_outputs`.
- `idx` é calculado antes dos filtros e do limite. `filtrados` informa a quantidade antes de aplicar `limite`.
- No histograma, o bucket automático usa a janela completa do caso e aproximadamente 120 baldes, com mínimo de um segundo. Os baldes e as marcas refletem os eventos filtrados; a cobertura permanece a do caso inteiro. `fim` é o limite exclusivo do último balde. Sem eventos selecionados, início/fim são `null`, `n_baldes` é zero e fontes/marcas ficam vazias. `limite` restringe a resposta de eventos, sem truncar o histograma.
- As contagens usam hipóteses estruturadas válidas, linhas de achados, linhas da tabela de limitações e registros de `iocs.csv`; placeholders não entram na contagem. Campos ausentes de hipóteses ficam `null` e referências são deduplicadas na ordem de aparição.
- Há validação de ID e whitelist de documentos, com confinamento adicional por caminho resolvido. Caminhos estáticos também são resolvidos e confinados a `static/` antes da leitura ou do fallback da SPA.
- O bind é sempre `127.0.0.1`. Host ausente, duplicado ou fora da lista é rejeitado; o mesmo vale para token ausente, duplicado ou incorreto. Métodos diferentes de GET são rejeitados, incluindo métodos desconhecidos. HEAD respeita a ausência de corpo HTTP.
- O token segue a precedência argumento explícito → `PERITO_UI_TOKEN` → `secrets.token_urlsafe(24)`, é comparado com `compare_digest` e inserido no `index.html`. A URL e a mensagem de desenvolvimento não revelam o token. Todas as respostas recebem os headers de segurança e `Cache-Control: no-store`.
- O diretório de estáticos é configurável em `create_server` para testes. A ausência de build retorna a mensagem especificada, sem instalar pacotes ou acessar a rede externa.

## Desvios

Nenhum desvio funcional da spec. Os detalhes de histograma vazio, limite final dos baldes e assinatura mais estrita do cache explicitam comportamentos não detalhados no contrato.

O comando de testes usa diretamente o Python da `.venv`, conforme a instrução explícita desta tarefa, em vez do padrão geral com `uv` do `AGENTS.md`.

## Validação

Os testes novos foram executados antes da implementação e falharam pela ausência dos módulos da API/servidor. Após a implementação, passaram os testes de contrato, segurança HTTP com sockets somente de loopback, filtros, índices estáveis, parsers, cache, CLI e integração com as sete fontes de `samples/caso-sintetico` (50 eventos e sete evidências com custódia íntegra em caso temporário).

Comando solicitado, sem rede externa:

```text
.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp=.pytest_tmp
```

Saída final da suíte completa:

```text
........................................................................ [ 60%]
................................................                         [100%]
120 passed in 9.45s
```

Exit code: `0`. Todos os 85 testes existentes e os 35 novos passaram. `git diff --check` também terminou sem erros.
