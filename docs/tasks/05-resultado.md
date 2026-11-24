# Resultado da Spec 05 — backend do grafo

## Resumo

- Parte A: `timeline.filter_events(domain=...)` compara substring sem diferenciar maiúsculas de minúsculas. CLI e API herdam o comportamento; há regressões nos três níveis para `EXAMPLE-CDN` / `cdn-update.example-cdn.net`.
- Parte B: criado `src/perito/ui/graph.py`, com `build_graph(events, hosts_sem_edr)` puro, agregação por origem/destino/tipo, resolução de IP em domínio, flags, técnicas, referências, índices originais, contagens, volume e rótulos em português.
- Adicionado `GET /api/casos/{id}/grafo` ao dispatcher, sobre a timeline construída e o cache existente. `relevantes=1` conserva os nós relevantes e uma camada de vizinhos diretos, com as arestas entre os nós mantidos. O caminho conserva as arestas suspeitas em ordem cronológica.
- As proteções existentes do servidor são reutilizadas; testes confirmam token, Host e rejeição de escrita por POST. A construção do grafo e a consulta não alteram os eventos nem os arquivos do caso.

## Arquivos da implementação

- `src/perito/timeline.py`
- `src/perito/ui/api.py`
- `src/perito/ui/graph.py` (novo)
- `tests/test_timeline.py`
- `tests/test_cli.py`
- `tests/test_ui_graph.py` (novo)
- `docs/tasks/05-resultado.md` (este registro)

## Desvios e convenções

Sem desvios funcionais da spec. Para os pontos sem regra de desempate explícita:

- O primeiro domínio observado para um IP é usado na resolução global, inclusive quando o evento que informa o domínio vem depois de uma conexão na lista.
- GB/MB usam unidades decimais e uma casa decimal com vírgula: os 2.469.606.194 bytes do caso sintético resultam em `enviou 2,5 GB`. O texto `enviou 2,4 GB` da spec foi tratado como exemplo de formato.
- Nós relevantes são os que têm técnicas ou participam de aresta suspeita; a expansão de vizinhos não é recursiva.

Nenhum arquivo dos diretórios e módulos proibidos foi editado por esta implementação. Foram observadas alterações concorrentes em `ui/` na verificação final; elas foram preservadas. Não foi feito commit.

## Validação

Comando executado na raiz, sem acesso à rede externa:

```powershell
.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp=.pytest_tmp
```

Resultado final: **131 passed in 10.50s**, código de saída **0**.

Os testes novos foram executados antes da implementação e falharam por ausência do módulo/rota e pela comparação de domínio por igualdade. A suíte final cobre o caso sintético, os protocolos internos RDP/SMB/WinRM/SSH, DNS observado sem origem resolvida, IP externo sem domínio, resolução retroativa, ausência de mutações, cache, índices e referências, caminho cronológico e expansão limitada de vizinhos.

`git diff --check`: sem erros.
