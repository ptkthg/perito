---
name: ingerir
description: Ingere evidências exportadas (CSV/JSON/NDJSON de Defender XDR, Sentinel, Entra ID sign-in/audit, Splunk, Elastic, Wazuh) em um caso do Perito, com hash SHA-256, cadeia de custódia, normalização e reconstrução da timeline. Use quando o usuário tiver arquivos de log ou export para analisar, ou pedir "importar", "carregar logs", "adicionar evidência".
---

# Ingerir evidências

## Passos
1. **Confirme o caso** (`uv run perito casos`). Se não existir, use `novo-caso`.
2. **Antes de ingerir, pergunte de onde veio cada arquivo** se não for óbvio: ferramenta, consulta usada, janela, quem exportou. Isso vai para `--obs` e entra na custódia.
3. **Ingerir:**
   ```
   uv run perito ingerir <ID> <arquivo-ou-pasta>... --obs "<consulta Q2.1 do kql, janela 10/11 12:00-16:00Z, exportado por fulano>"
   ```
   Fonte detectada automaticamente. Force com `--fonte defender|sentinel|entra_signin|entra_audit|splunk|elastic|wazuh` se a detecção falhar.
   Para evidência que o Perito não parseia (PCAP, memória, imagem de disco, amostra de malware, prints), use `uv run perito evidencia <ID> <arquivo> --obs "..."`: só registra hash e custódia.
4. **Leia a saída** e reporte por arquivo: fonte, eventos, **ignorados** (se > 0, investigue o motivo, porque pode ser formato inesperado ou horário inválido) e hash.
5. **Cobertura:** rode `uv run perito resumo <ID>` e reporte:
   - janela de cada fonte (primeiro/último evento). **Janelas que não se sobrepõem são uma lacuna.**
   - `hosts_sem_edr` → registre em `limitacoes.md`.
   - fontes esperadas que faltam (ex.: há sign-in do Entra mas não há log de e-mail; há RDP para servidor mas não há SecurityEvent dele).
6. **Atualize `limitacoes.md`** com cada lacuna: o que falta, impacto na conclusão e como mitigar (qual consulta exportar).
7. **Fuso:** se uma fonte vier sem fuso (horário "naive"), o Perito assume UTC. **Confirme com o usuário** e registre `[LIMITAÇÃO]` se não houver certeza.

## Regras
- Nunca edite arquivos em `evidencias/brutas/`. Se o export estiver errado, exporte de novo e ingira o novo arquivo; os dois ficam na custódia.
- Ingerir de novo o mesmo arquivo é seguro: o hash é igual, então a custódia não duplica e o normalizado é regravado.
- Exports muito grandes: prefira filtrar na consulta (janela, entidade) a ingerir dias inteiros de todo o ambiente.

## Saída para o usuário
Tabela de ingestão, cobertura por fonte, lacunas encontradas (já registradas em `limitacoes.md`) e o próximo passo (`timeline`).
