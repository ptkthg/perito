# Resultado da spec 02

[EVIDÊNCIA] Criados `src/perito/mitre.py`, `src/perito/timeline.py`, `src/perito/_network.py`, `tests/test_mitre.py` e `tests/test_timeline.py`. APIs de sugestões, anotação, carregamento, construção, filtros, entidades, cobertura, IOCs e saídas implementadas. Referências: os arquivos citados e `docs/tasks/02-mitre-timeline.md`.

## Decisões e divergências

- [EVIDÊNCIA] A timeline completa começa em `2026-11-10T10:00:00.000Z`, e não 11:30Z: `samples/caso-sintetico/entra_audit.json#0` contém Update user às 10:00Z. Foi preservado o evento; teste segue a ordenação exigida, sem excluir evidência.
- [EVIDÊNCIA] `samples/caso-sintetico/entra_signin.json#1` informa `WS-FIN-041`, que não tem evento Defender nem process Elastic. Aplicando a definição de cobertura, `hosts_sem_edr` é `['srv-file-01', 'ws-fin-041']`; o exemplo de resultado exato da spec omite esse host. O teste segue a regra geral.
- [LIMITAÇÃO] `ipaddress.is_private` classifica as redes TEST-NET das amostras como privadas. `_network.is_external_ip` trata explicitamente redes de documentação (IPv4 e IPv6) como externas para investigação sintética, e rejeita IP inválido e demais endereços não globais. Isso permite cumprir IOCs, volume alto e T1071.001 sem alterar `schema.py`. Esses endereços não são destinos públicos roteáveis reais.
- `build` copia a entrada antes do enriquecimento; não contamina objetos do chamador. Entidades vazias não geram corroboração. `render_csv` e `md_cell` são helpers reutilizáveis pela CLI.
- Markdown identifica observações com `[EVIDÊNCIA]` e explicita a limitação de confirmação das sugestões ATT&CK.

## Testes

[EVIDÊNCIA] Executado na raiz, sem rede, conforme instrução do usuário:

```text
.venv\Scripts\python.exe -m pytest -q
..................................................................       [100%]
66 passed in 0.61s
```

Pendências: reconciliar os dois exemplos incompatíveis com as amostras na revisão da spec. Nenhuma mudança em `schema.py`, `case.py`, amostras ou specs. Nenhum commit.
