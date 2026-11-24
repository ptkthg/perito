# Spec 03: CLI `perito`

**Implementador:** Codex. **Revisor:** Claude. **Depende de:** specs 01 e 02.

`src/perito/cli.py` com `main(argv: list[str] | None = None) -> int`, usando `argparse` (stdlib). O entry point `perito = "perito.cli:main"` já está no `pyproject.toml`. No início de `main`, reconfigure `sys.stdout`/`sys.stderr` para UTF-8 (`reconfigure(encoding="utf-8")`), porque o console do Windows pode não ser UTF-8.

Opção global: `--casos DIR` (padrão `perito.case.CASES_DIR`, que já respeita a env `PERITO_CASOS`). Repasse como `base=` às funções de `case.py`.

## Subcomandos
| Comando | Comportamento |
|---|---|
| `casos` | Lista os casos (ID, título da 1ª linha do caso.md, nº de evidências em custódia, nº de eventos na timeline). |
| `novo-caso ID [--titulo T] [--responsavel R]` | `create_case`. Imprime o caminho criado. Erro amigável se já existir. |
| `evidencia ID ARQ... [--fonte F] [--obs O]` | Só registra a evidência bruta (`add_evidence`), sem parsear. Útil para PCAP, imagens, memória. |
| `ingerir ID CAMINHO... [--fonte auto\|<fonte>] [--obs O]` | Para cada arquivo (pastas: recursivo em `*.csv *.json *.ndjson *.jsonl *.log`, ignorando `*.md`): (1) `add_evidence`; (2) detecta a fonte (`auto`) ou usa a informada. Se não detectar, avisa e pula (a evidência continua registrada); (3) parseia **a cópia em evidencias/brutas** com `stats`; (4) aplica `mitre.annotate`; (5) grava `normalizado/<fonte>__<nome-do-arquivo-sem-extensão>.jsonl` (sobrescreve se já existir). Ao final, reconstrói a timeline (`build` + `write_outputs`) e imprime uma tabela: arquivo, fonte, eventos, ignorados, sha256[:12]. |
| `timeline ID [--host] [--user] [--ip] [--hash] [--dominio] [--de] [--ate] [--fonte] [--tipo] [--texto] [--formato md\|csv\|jsonl] [--limite N] [--saida ARQ]` | Carrega `normalizado/`, faz `build`, regrava os 3 arquivos completos em `timeline/`, filtra e imprime no formato pedido (padrão md) ou grava em `--saida`. |
| `pivo ID (--host H \| --user U \| --ip IP \| --hash S \| --dominio D)` | Timeline filtrada + seção "Entidades relacionadas": outros hosts, usuários, IPs, domínios e hashes que aparecem nos eventos filtrados, com contagem e primeira/última vez. |
| `iocs ID [--gravar]` | Imprime `ioc_candidates` em tabela md. Com `--gravar`, anexa ao `iocs.csv` só os pares (tipo, valor) que ainda não existem. |
| `resumo ID` | Imprime em md: janela total, eventos por fonte (com primeiro/último), por tipo, técnicas ATT&CK com nome e tática (de `TECHNIQUES`, ordenadas por tática), entidades principais (top 10 hosts, usuários e IPs públicos), `hosts_sem_edr` como **possíveis limitações**, e o estado da custódia (`verify_custody`). |
| `verificar ID` | `verify_custody`. Exit 0 se íntegro, 2 se houver problema (lista os problemas). |

Códigos de saída: 0 ok; 1 erro de uso ou de dados (mensagem em português no stderr, sem traceback, exceto com `--debug`); 2 integridade.

## Testes (`tests/test_cli.py`)
E2E usando `tmp_path` como `--casos`:
1. `novo-caso TESTE-001 --titulo "Caso sintético"` → exit 0, pastas e arquivos do esqueleto existem.
2. `ingerir TESTE-001 samples/caso-sintetico` → exit 0. 7 arquivos normalizados (o GABARITO.md é ignorado), `custodia.csv` com 7 linhas de dados, 50 eventos na soma (antes do dedupe), e `timeline/timeline.csv` existe.
3. Ingerir de novo a mesma pasta não duplica a custódia (mesmo hash) e os normalizados são sobrescritos (a contagem total não muda).
4. `timeline TESTE-001 --host ws-fin-023 --formato jsonl` → todas as linhas têm o host (ou src_host/dst_host/observer) ws-fin-023.
5. `pivo TESTE-001 --ip 198.51.100.77` → a saída contém `m.silva` e `MailSync Pro`.
6. `resumo TESTE-001` → contém `T1003.001` e `Acesso a credenciais`.
7. `iocs TESTE-001 --gravar` duas vezes → o `iocs.csv` não tem pares (tipo, valor) duplicados.
8. `verificar TESTE-001` → exit 0. Depois de alterar um byte de uma evidência (remova o somente leitura no teste) → exit 2.
9. Arquivos brutos em `evidencias/brutas` ficam sem permissão de escrita (`os.access(p, os.W_OK) is False`).

## Resultado
Escreva `docs/tasks/03-resultado.md` (arquivos, desvios, saída do pytest, pendências).
