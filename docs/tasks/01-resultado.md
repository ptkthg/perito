# Resultado da spec 01

[EVIDÊNCIA] Implementados os sete parsers e o registro em `src/perito/parsers/`, leitor `_io.py`, mapeamento `_winsec.py` e detecção `detect.py`. Testes: `tests/test_parsers.py` e `tests/test_detect.py`. Referências: esses arquivos e `docs/tasks/01-parsers.md`.

Decisões: o leitor compartilhado também concentra aliases ECS, normalização e isolamento de erros; cada módulo expõe `map_record` para reutilização por conectores sem arquivos intermediários. `parse(path)` mantém o contrato puro. Horário sem fuso recebe `extra.limitacao_fuso` explícita. Nenhuma alteração em `schema.py`, `case.py`, amostras ou specs.

[EVIDÊNCIA] Comando solicitado, executado na raiz: `.venv\Scripts\python.exe -m pytest -q`.

```text
........................                                                 [100%]
24 passed in 0.17s
```

O comando substitui `uv run pytest -q` por instrução expressa do usuário. Cobertura inclui contagens, campos exigidos, formatos encapsulados, CSV multiline, referências e corrupção de JSON/horário. Pendências: nenhuma para esta etapa.

## Complemento da revisão integrada

[EVIDÊNCIA] Na revisão final da spec 03 foram adicionadas regressões e correções para CSV vazio com cabeçalho, busca Elastic vazia, Wazuh DNS sem processo, linhas vazias em CSV e JSON escalar malformado. A suíte final inteira passou com `82 passed in 1.65s`. Arquivos e detalhes em `03-resultado.md`; os contratos públicos e o escopo protegido foram mantidos.
