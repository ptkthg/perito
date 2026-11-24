# Resultado da implementação 07 — agentes no backend

## Entrega

Implementados `src/perito/ui/jobs.py`, os seis templates versionados em
`src/perito/ui/prompts/`, a integração HTTP em `src/perito/ui/server.py`, o
auxiliar `src/perito/ui/_processes.py` e `tests/test_ui_jobs.py`.

- Ações e fases por whitelist, instrução adicional de até 500 caracteres sem
  controles, detecção de disponibilidade por env/`shutil.which` e scripts `.py`
  executados pelo Python atual. Nenhum comando é iniciado com `shell=True`.
- Rotas de início, polling incremental, histórico, disponibilidade, cancelamento,
  aplicação e descarte. Preservadas as proteções de Host/token/JSON do servidor;
  início exige `X-Perito-Aviso-Envio: aceito` e responde 428 sem esse aceite.
- Um job ativo por caso, timeout configurável (padrão 20 minutos), logs legíveis
  e brutos, estado final JSON e auditoria de início/fim/aplicação/descarte.
- Staging em `.perito/staging/<job>/<ID>/`, copiando Markdown da raiz, `iocs.csv`
  e as quatro árvores de análise, inclusive diretórios vazios. Não copia brutas
  nem custódia. `PERITO_CASOS`, `-C` e `--add-dir` apontam para o rascunho conforme
  o provedor; os templates explicitam o caminho efetivo.
- Conclusão com `aplicado: false`, arquivos alterados e diff unificado limitado a
  200 KiB em UTF-8. Somente os alvos da ação podem ser promovidos; links e
  junctions são rejeitados. O rascunho também recebe hash na conclusão, impedindo
  aplicação de conteúdo posteriormente adulterado.
- Aplicação explícita dos arquivos selecionados, validação de todas as versões
  `mtime_ns-tamanho` antes da primeira escrita, resposta 409 com o arquivo em
  conflito e escrita atômica por arquivo. Rascunhos concluídos podem ser
  consultados/aplicados/descartados após reinício do servidor.
- Cancelamento/erro/timeout/violação removem o rascunho; a inicialização remove
  rascunhos com mais de sete dias. Cancelamento usa `taskkill /T /F /PID` no
  Windows e grupo de processos no POSIX. No Windows há também um Job Object para
  encerrar descendentes quando o pai já terminou.
- Snapshots com versão e SHA-256 detectam criação, remoção e alteração de
  arquivos reais, inclusive de brutas/custódia; alteração resulta em `violacao`.
  O hash das evidências é calculado em streaming pelo helper existente.
- Revisão cruzada recebe cobertura gerada previamente pela função `_summary`
  do próprio Perito e o `PROMPT_REVISOR` canônico da skill. Codex executa a revisão
  em `read-only`, gravando a resposta via `-o` no arquivo da revisão na cópia.

## Decisões e desvios

1. **Precedência do staging:** os caminhos da seção de rascunho prevalecem sobre
   os exemplos anteriores de execução que ainda apontam para o caso real. Nenhum
   caminho de trabalho do agente aponta intencionalmente para a análise original.
2. **Resumo sem regravar a timeline:** a entrada completa da CLI regrava arquivos
   de timeline. Para preservar o caso, o executor chama diretamente a função
   `_summary` em um subprocesso Python local, com os eventos do caso real. Isso
   evita redirecionar o stdout global do servidor e permite verificar a custódia
   sem copiá-la para o rascunho. Não chama Claude/Codex para gerar cobertura.
3. **Arquivo auxiliar adicional:** `_processes.py` usa somente stdlib (`ctypes` no
   Windows). O Job Object complementa o `taskkill`, pois encerrar somente o PID
   do pai não resolve descendentes depois que o pai sai.
4. **Lacuna funcional de confinamento:** a garantia estrita do item 6 dos testes
   da spec, de que um stub/executável malicioso que escreve diretamente fora da
   cópia *nunca* altera a análise real, **não está atendida**. Staging, prompts,
   argumentos dos CLIs e snapshots não criam um sandbox de sistema operacional.
   Um executável rodando com as permissões do usuário ainda pode escrever por
   caminho absoluto no original; a verificação posterior detecta a mudança,
   marca `violacao`, audita e impede aplicar o rascunho, mas não impede nem desfaz
   aquela escrita. Não houve restauração automática, que poderia sobrescrever
   mudanças legítimas do analista ou editar evidências brutas. Atender essa
   garantia exige isolamento de escrita no SO; o Job Object gerencia processos,
   não permissões de arquivos. Portanto, a spec não deve ser considerada
   integralmente atendida nem o executor um mecanismo seguro para executar
   binários maliciosos. Os testes não afirmam essa garantia ausente.

## Verificação

Comando solicitado, executado sem acesso a provedores externos:

```powershell
.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp=.pytest_tmp
```

Resultado final: **178 passed in 53.04s**, exit code **0**.

São **15 testes novos** (incluindo parametrizações), usando exclusivamente
scripts Python locais configurados por `PERITO_CLAUDE_BIN` e
`PERITO_CODEX_BIN`. Mesmo os testes de indisponibilidade/validação configuram as
duas envs, sem fallback para provedores reais. As requisições HTTP de integração
são somente para loopback em porta efêmera.

Cobertura nova: staging e aplicação para ambos os agentes, original intacto no
fluxo normal, logs/argv/instrução delimitada, polling incremental, conflito em
lote sem aplicação parcial, descarte, validações/428/403/400, indisponibilidade,
exclusividade por caso, cancelamento e timeout, detecção de escrita maliciosa em
brutas, SHA-256 com tamanho/mtime preservados, cobertura antes da revisão e
`read-only`, retomada após reinício, expiração, stream-json/erro, whitelist de
arquivos, limite de diff, adulteração do rascunho e ausência de filhos órfãos
após cancelamento e término normal no Windows. O caminho POSIX foi implementado,
mas não foi executado neste ambiente Windows.

`git diff --check` sem erros. Revisão local do código e da spec feita pelo
implementador; a revisão independente atribuída ao Claude permanece externa a
esta entrega.

## Escopo preservado

Sem alterações feitas por esta implementação em `ui/`, `docs/design/`,
`schema.py`, `samples/`, nas specs ou em casos reais. Alterações de outros
trabalhos no workspace foram preservadas. **Nenhum commit realizado.**
