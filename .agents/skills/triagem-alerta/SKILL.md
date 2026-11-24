---
name: triagem-alerta
description: Triagem de alerta de segurança (Defender XDR, Sentinel, Entra ID Protection, Splunk, Elastic, Wazuh) segundo NIST SP 800-61r3 / SANS PICERL. Classifica em TP/BTP/FP, define severidade, enriquece e decide entre escalar e fechar com justificativa. Use quando o usuário colar um alerta ou incidente, ou pedir "triar", "analisar alerta", "é falso positivo?".
---

# Triagem de alerta

Objetivo: decidir **rápido e com justificativa** se o alerta vira investigação. Registre em `casos/<ID>/triagem.md` (abra o caso com `novo-caso` se ainda não existir; para triagem descartável sem caso, responda só no chat e diga isso).

## 1. Entender o alerta
Extraia e registre: nome, ferramenta, ID, horário UTC (converta e anote o fuso original), entidades (host, conta, IP, processo, hash, URL), lógica da detecção (o que ela procura) e técnica ATT&CK alegada.

## 2. Perguntas de triagem (responda cada uma com [EVIDÊNCIA] ou "não verificado")
1. **A atividade aconteceu?** O evento bruto existe? (consulta em `queries/kql|spl/00-timeline-entidade.*`)
2. **É esperada?** Mudança aprovada, ferramenta de TI, pentest autorizado, comportamento recorrente na baseline (ocorre há semanas em vários hosts?).
3. **Contexto da entidade:** a conta é privilegiada? O host é crítico? O usuário viaja (sign-in de outro país)?
4. **Sinais de malícia:** processo pai incomum, ofuscação, pasta gravável pelo usuário, hash raro (prevalência baixa), destino recém-registrado ou sem reputação, horário atípico, cadeia com outros alertas.
5. **Atividade correlata ±1 h:** outros alertas no mesmo host ou conta, sign-ins de risco, e-mail recebido pouco antes.

## 3. Classificação
- **TP (verdadeiro positivo):** atividade maliciosa ou não autorizada confirmada → escalar e abrir investigação.
- **BTP (verdadeiro positivo benigno):** a detecção funcionou, mas a atividade é autorizada (TI, pentest) → fechar e documentar quem autorizou. Sugerir tuning se for recorrente.
- **FP (falso positivo):** a lógica disparou errado → fechar e propor ajuste da regra (com a condição de exclusão **mais estreita possível**).
- **Inconclusivo:** faltam dados → **não feche**. Liste o que falta e escale com severidade provisória.

## 4. Severidade e decisão
Use a matriz da skill `novo-caso`. A decisão é uma de: `fechar (FP/BTP)` | `escalar para investigação` | `escalar + contenção imediata`.
Contenção imediata (isolar host, revogar sessões, desabilitar conta) se houver qualquer um destes: execução confirmada com C2 ativo, dump de credenciais, movimentação lateral, exfiltração em curso, ransomware. **Confirme com o usuário antes de recomendar ações disruptivas em ativos críticos.**

## 5. Formato de `triagem.md`
```
# Triagem: <alerta>
- Alerta: <nome> · <ferramenta> · <ID> · <UTC> (original: <valor/fuso>)
- Entidades: ...
- Classificação: TP | BTP | FP | Inconclusivo   · Confiança: baixa|média|alta
- Severidade: ...   · Decisão: ...
## Justificativa
- [EVIDÊNCIA] ... (raw_ref / consulta + horário)
- [HIPÓTESE] ... (confirmaria: ... / refutaria: ...)
- [LIMITAÇÃO] ...
## Próximos passos
```
Se for TP: próximo passo `ingerir` (exportar a timeline das entidades com as consultas 00 e da fase alegada). Se for FP/BTP: o texto da justificativa de fechamento, pronto para colar no ticket, e a proposta de tuning.
