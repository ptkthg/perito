# Resultado da spec 03

[EVIDÊNCIA] Implementados `src/perito/cli.py` e `tests/test_cli.py`, com os subcomandos `casos`, `novo-caso`, `evidencia`, `ingerir`, `timeline`, `pivo`, `iocs`, `resumo` e `verificar`. Referências: esses arquivos e `docs/tasks/03-cli.md`.

## Comportamento e decisões

- Ingestão registra a custódia antes da detecção e lê exclusivamente a cópia bruta. Reingestão reutiliza o hash registrado e sobrescreve o normalizado correspondente. A pasta sintética produz sete arquivos e 50 eventos.
- `timeline` reconstrói as três saídas completas antes da apresentação filtrada. Filtros, formatos, limite e `--saida` disponíveis; saída em `evidencias/brutas` é recusada para preservar imutabilidade.
- IOCs são candidatos; gravação elimina pares já existentes. Resumo identifica cobertura sem EDR como possível limitação e exibe técnicas com nome/tática e estado de custódia.
- Erros de uso retornam 1, incluindo os de argparse; `verificar` retorna 2 em falha de integridade. `--debug` exibe traceback. Reconfiguração UTF-8 é condicional à disponibilidade de `reconfigure`, permitindo também streams de captura dos testes.
- `python -m perito.cli` também executa `main`, além do entry point existente. Sem novas dependências.

## Revisão final das integrações

[EVIDÊNCIA] Os testes adicionais de regressão expuseram e corrigiram: detecção em CSV somente com cabeçalho e busca Elastic vazia, regra de observador para Windows/DNS via Wazuh, referência física de CSV com linhas vazias e contabilização de JSON escalar inválido. Mudanças em `parsers/_io.py`, `parsers/detect.py`, `parsers/wazuh.py`, `tests/test_detect.py` e `tests/test_parsers.py`; referências nos respectivos testes. Cobertos também aliases dos conectores Sentinel, proteção de saída bruta, ajuda e debug.

As divergências entre exemplos da spec 02 e as amostras permanecem explicitadas em `02-resultado.md`: início às 10:00Z; `ws-fin-041` também sem EDR; classificação especial de redes de documentação para os cenários sintéticos. Nenhuma evidência foi excluída para ajustar os resultados esperados.

## Testes e verificação

[EVIDÊNCIA] Executado na raiz, com o ambiente existente e sem rede:

```text
.venv\Scripts\python.exe -m pytest -q
........................................................................ [ 87%]
..........                                                               [100%]
82 passed in 1.65s
```

Marcos anteriores: spec 01 verde com 24 testes; spec 02 verde com 66; CLI inicialmente verde com 71, ampliados a 82 na revisão final. Só se iniciou a etapa seguinte após a anterior passar e ter seu resultado registrado.

[EVIDÊNCIA] `git diff --check` sem problemas; `git diff --name-only -- src/perito/schema.py src/perito/case.py samples docs/tasks/01-parsers.md docs/tasks/02-mitre-timeline.md docs/tasks/03-cli.md` sem saída. Referência: execução de verificação ao concluir esta etapa.

Desvio operacional: usado `.venv\Scripts\python.exe -m pytest -q` em lugar de `uv`, conforme pedido expresso do usuário. `schema.py`, `case.py`, amostras e specs preservados. Nenhum commit. Alterações alheias à implementação foram preservadas.

Pendências de implementação: nenhuma. A reconciliação dos exemplos divergentes da spec 02 fica documentada para o revisor, sem editar as specs nesta execução.
