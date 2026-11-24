Implementadas, na ordem, as três specs: parsers, MITRE/timeline e CLI. Nenhum commit realizado.

Testes com `.venv\Scripts\python.exe -m pytest -q`:

- Spec 01: **24 passaram**.
- Spec 02: **66 passaram**.
- Validação final: **82 passaram**.

Desvios documentados: as amostras começam às **10:00Z**, incluem também `ws-fin-041` sem EDR e usam redes de documentação tratadas como externas nos cenários sintéticos.

`schema.py`, `case.py`, `samples/` e as specs foram preservados.

Resultados: [01](01-resultado.md), [02](02-resultado.md) e [03](03-resultado.md).