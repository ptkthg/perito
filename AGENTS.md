# Perito: instruções para agentes (Claude Code e Codex)

Perito é um kit de apoio a **Resposta a Incidentes / DFIR**. Ele normaliza evidências de EDR, SIEM, identidade e rede em uma timeline única e guia a investigação até o relatório. Este arquivo é a fonte canônica da metodologia: vale para qualquer agente que trabalhe aqui.

Idioma: português do Brasil, com acentuação correta. Termos técnicos, nomes de tabelas e campos ficam no original.

## 1. Regras inegociáveis de evidência

1. **Evidência bruta é imutável.** Nunca edite, mova ou sobrescreva nada em `casos/<ID>/evidencias/brutas/`. Toda transformação gera um arquivo novo em `normalizado/`, `timeline/` etc.
2. **Toda afirmação recebe uma tag:**
   - `[EVIDÊNCIA]`: fato observado. Precisa de `raw_ref` (arquivo:linha, ID de evento ou consulta + horário de execução).
   - `[HIPÓTESE]`: inferência. Precisa de confiança (baixa/média/alta), do que a **confirmaria** e do que a **refutaria**.
   - `[LIMITAÇÃO]`: lacuna de visibilidade (log ausente, retenção expirada, host sem EDR, fuso incerto, amostragem).
3. **Nunca transforme hipótese em fato** no relatório. Se a evidência não fecha, o texto diz isso.
4. **Horários em UTC** (ISO 8601 com `Z`). O horário e o fuso originais ficam em `ts_original`. Quando o fuso da fonte for desconhecido, registre uma `[LIMITAÇÃO]`.
5. **Cadeia de custódia:** toda evidência entra pelo `perito ingerir` (ou `perito evidencia`), que calcula SHA-256 e registra em `custodia.csv`.
6. **MITRE ATT&CK** em todo achado (ID da técnica/subtécnica). O mapeamento automático do `perito` é uma *sugestão* e precisa ser confirmado pelo analista.
7. **Dados pessoais:** registre só o necessário. Para o DPO e o Jurídico, descreva as categorias de dados e de titulares, não os dados em si.

## 2. Metodologia

Ciclo **NIST SP 800-61r3** (alinhado às funções do CSF 2.0), com correspondência ao **SANS PICERL**:

| NIST 800-61r3 / CSF 2.0 | SANS PICERL | Saída no caso |
|---|---|---|
| Preparar (GV/ID/PR) | Preparation | `caso.md` (contexto, ativos, contatos) |
| Detectar (DE) | Identification | `triagem.md`, `timeline/`, `achados.md` |
| Responder (RS): análise | Identification | `hipoteses.md`, `escopo.md` |
| Responder (RS): contenção/erradicação | Containment, Eradication | `acoes.md` |
| Recuperar (RC) | Recovery | `acoes.md` |
| Melhorar (ID.IM) | Lessons Learned | `relatorios/`, melhorias de detecção |

A fase atual fica registrada no campo `fase` do `caso.md`.

Fases de investigação (skill `investigar`), na ordem: **acesso inicial → execução → persistência → acesso a credenciais → movimentação lateral → coleta/exfiltração → impacto**. Em cada fase, responda: o que aconteceu, onde, quando, com qual conta, por qual evidência, e o que ainda não sabemos.

## 3. Layout de um caso

```
casos/<ID>/
  caso.md            # metadados, fase NIST, contexto, partes envolvidas
  evidencias/brutas/ # originais (somente leitura)
  custodia.csv       # registro_utc, arquivo, sha256, bytes, fonte, coletado_por, observacao
  normalizado/       # <fonte>__<arquivo>.jsonl (schema Event)
  timeline/          # timeline.jsonl, timeline.csv, timeline.md
  triagem.md
  hipoteses.md
  achados.md
  escopo.md
  iocs.csv           # tipo, valor, primeira_vez_utc, ultima_vez_utc, fonte, contexto, confianca
  limitacoes.md
  acoes.md
  revisoes/          # revisões cruzadas (codex-*.md, claude-*.md, conciliacao.md)
  relatorios/
```

## 4. Ferramentas

Python via **uv** (não há Python global). Sempre `uv run ...` a partir da raiz do repositório.

```
uv run perito novo-caso <ID> [--titulo "..."]
uv run perito ingerir <ID> <arquivo|pasta>... [--fonte auto|defender|sentinel|entra_signin|entra_audit|splunk|elastic|wazuh]
uv run perito timeline <ID> [--host H] [--user U] [--de ISO] [--ate ISO] [--formato md|csv|jsonl]
uv run perito pivo <ID> --host H | --user U | --ip IP | --hash SHA256
uv run perito iocs <ID>
uv run perito resumo <ID>          # cobertura por fonte, janela temporal, hosts/usuários, técnicas
uv run pytest
```

Consultas prontas por fase e dialeto ficam em `queries/{kql,spl,esql}/`. Templates de relatório ficam em `templates/`.

## 5. Skills

Ficam em `.agents/skills/` (fonte canônica) e são espelhadas em `.claude/skills/` por `node scripts/sync-skills.mjs`. **Edite só em `.agents/skills/`.**

`novo-caso`, `triagem-alerta`, `ingerir`, `timeline`, `investigar`, `escopo`, `relatorio`, `revisao-cruzada`.

## 6. Colaboração Claude × Codex

- **Construção:** specs de implementação ficam em `docs/tasks/NN-*.md`. Quem implementa segue a spec, roda `uv run pytest` e registra o resultado em `docs/tasks/NN-resultado.md`. Quem revisa confere o diff e os testes antes do commit.
- **Revisão cruzada de investigações:** um agente conduz e o outro revisa com ceticismo, em modo somente leitura, gravando em `casos/<ID>/revisoes/`. O revisor procura lacunas, hipóteses sem sustentação, inconsistências de timeline e técnicas ATT&CK mal atribuídas, e **não** altera os arquivos do caso.

## 7. Convenções de código

- Python ≥ 3.11, apenas stdlib em `src/perito` (sem dependências de runtime). `pytest` como dependência de desenvolvimento.
- Parsers são funções puras: `parse(path: Path) -> Iterator[Event]`, sem efeitos colaterais.
- Toda função que lê evidência preenche `raw_ref` como `<nome-do-arquivo>:<linha>` (CSV e NDJSON) ou `<nome-do-arquivo>#<índice>` (array JSON).
- Testes em `tests/`, usando as amostras de `samples/`.
