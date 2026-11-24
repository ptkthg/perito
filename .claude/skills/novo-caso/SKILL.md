---
name: novo-caso
description: Abre um caso de resposta a incidentes no Perito, com estrutura de pastas, contexto inicial, fase NIST 800-61r3 e cadeia de custódia. Use quando o usuário disser que recebeu um alerta, incidente, suspeita de comprometimento ou pedir para "abrir caso", "começar investigação", "novo incidente".
---

# Abrir caso

Siga `AGENTS.md` (regras de evidência). Todos os comandos rodam na raiz do repositório Perito.

## Passos
1. **Defina o ID** no padrão `IR-AAAA-NNN`. Rode `uv run perito casos` para ver o próximo número livre. Se o usuário já tiver um ID de ticket (ServiceNow, Jira), use-o como sufixo: `IR-2026-014-INC48213`.
2. **Crie o caso:** `uv run perito novo-caso <ID> --titulo "<resumo curto>"`.
3. **Colete o contexto inicial** e preencha `casos/<ID>/caso.md`. Pergunte só o que faltar, em **uma** mensagem:
   - Gatilho: alerta (ID, nome, ferramenta, horário **com fuso**), denúncia ou notificação de terceiro.
   - Ativos e contas citados: host, IP, UPN, criticidade, dono.
   - O que já foi feito: alguém isolou o host, resetou senha ou apagou algo? (afeta a evidência)
   - Fontes disponíveis e retenção: Defender, Sentinel, Entra, Splunk, Elastic, Wazuh, firewall, proxy, e-mail.
   - Restrições: horário comercial, ativo crítico que não pode ser isolado, envolvimento do Jurídico.
4. **Registre a fase:** comece em `Detectar / Identification`. Atualize o campo `fase` sempre que mudar.
5. **Primeira decisão** no "Registro de decisões" do `caso.md`, por exemplo: "abrir investigação; severidade preliminar Alta; motivo: ...".
6. **Severidade preliminar** pela matriz abaixo (revise depois do escopo):

| | Impacto baixo (1 host comum) | Impacto médio (conta privilegiada, servidor) | Impacto alto (dados pessoais/sensíveis, AD, produção, múltiplos hosts) |
|---|---|---|---|
| **Confirmado** | Média | Alta | Crítica |
| **Provável** | Baixa | Média | Alta |
| **Não confirmado** | Baixa | Baixa | Média |

7. **Próximo passo:** sugira `triagem-alerta` (se ainda não estiver claro que é TP) ou `ingerir` (se já houver exports).

## Saída para o usuário
Caminho do caso, severidade preliminar com justificativa, lacunas de informação e o próximo passo. Não invente dados de contexto: o que não foi informado fica como `a confirmar`.
