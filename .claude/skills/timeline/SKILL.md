---
name: timeline
description: Constrói e interpreta a linha do tempo correlacionada de um caso do Perito para identificar paciente zero, vetor de entrada, pivôs e a sequência do ataque. Use quando o usuário pedir "timeline", "linha do tempo", "o que aconteceu primeiro", "reconstruir o ataque", ou depois de ingerir evidências.
---

# Linha do tempo

## Comandos
```
uv run perito timeline <ID>                                   # completa (md); regrava timeline/{jsonl,csv,md}
uv run perito timeline <ID> --host ws-fin-023 --de 2026-11-10T13:00Z --ate 2026-11-10T14:00Z
uv run perito timeline <ID> --tipo process,network --texto powershell
uv run perito pivo <ID> --ip 203.0.113.45                     # eventos + entidades relacionadas
uv run perito pivo <ID> --user svc_backup
uv run perito pivo <ID> --hash <sha256>
uv run perito iocs <ID>
```
Para timelines grandes, leia `casos/<ID>/timeline/timeline.csv` com filtros em vez de despejar tudo no contexto.

## Método
1. **Âncora:** comece pelo evento do alerta. Olhe ±30 min ao redor dele no host e na conta.
2. **Para trás (causa):** para cada evento malicioso, pergunte "o que causou isto?" e siga `parent`, o arquivo criado antes, o e-mail recebido, o logon anterior. Pare quando chegar a um evento sem causa maliciosa anterior: esse é o **candidato a vetor de entrada**. O host dele é o **candidato a paciente zero**.
3. **Para frente (efeito):** a partir de cada credencial ou host comprometido, siga os pivôs (`pivo --user`, `pivo --ip`) para achar movimentação lateral, novos hosts e exfiltração.
4. **Corroboração:** eventos com `⧉n` foram vistos por mais de uma fonte, o que dá maior confiança. Um fato visto por uma única fonte continua válido, mas cite a fonte.
5. **Marcadores:** `⚠ volume` = upload grande para IP público (exfiltração candidata). `src_host*` = host deduzido pelo IP (confirme que o IP não mudou por DHCP na janela: `[LIMITAÇÃO]` se não houver como verificar).
6. **Separe ruído:** atividade normal do usuário não entra nos achados, mas ajuda a delimitar a janela (ex.: "último uso legítimo às 13:06").
7. **ATT&CK:** as técnicas da timeline são **sugestões heurísticas** (`extra.mitre_heuristica`). Confirme cada uma lendo o evento antes de levá-la ao relatório.

## Registro
- `achados.md`: uma linha por evento relevante, `| # | UTC | Host | Conta | Achado | ATT&CK | Evidência (raw_ref) |`.
- `hipoteses.md`: vetor de entrada, paciente zero e origem de credenciais como hipóteses (H1, H2...) até que a evidência feche.
- `iocs.csv`: `uv run perito iocs <ID> --gravar` e depois **revise** a coluna `confianca` (candidato → confirmado/descartado).

## Saída para o usuário
Narrativa curta em ordem cronológica (UTC), com cada passo marcado [EVIDÊNCIA]/[HIPÓTESE]/[LIMITAÇÃO]; paciente zero e vetor candidatos com confiança; pivôs a investigar em seguida (com a consulta sugerida de `queries/`).
