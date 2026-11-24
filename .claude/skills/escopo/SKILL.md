---
name: escopo
description: Determina o alcance do comprometimento em um caso do Perito (hosts, contas, identidades em nuvem, dados, janela temporal) com nível de confiança e lacunas, e propõe contenção/erradicação coerentes com o escopo. Use quando o usuário perguntar "qual o escopo?", "quem/o que foi afetado?", "podemos fechar?", ou antes do relatório.
---

# Escopo do comprometimento

Grave em `casos/<ID>/escopo.md`.

## 1. Inventário a partir da timeline
```
uv run perito resumo <ID>
uv run perito pivo <ID> --user <cada conta comprometida>
uv run perito pivo <ID> --ip <cada IP do atacante>
```
Para cada entidade, classifique:
- **Comprometido (confirmado):** há [EVIDÊNCIA] de execução, logon ou ação do atacante.
- **Provavelmente comprometido:** exposição forte sem uso observado (ex.: conta com sessão no host do dump; host que recebeu conexão do atacante sem log local).
- **Exposto / a verificar:** alcançável com as credenciais obtidas, sem evidência. Exige consulta.
- **Descartado:** verificado e limpo, com a evidência da verificação.

## 2. Tabelas do `escopo.md`
```
## Hosts
| Host | Status | Primeira/última atividade maliciosa (UTC) | Evidência | Telemetria disponível |
## Contas (on-prem e nuvem)
| Conta | Tipo (usuário/serviço/admin/nuvem) | Status | Como foi obtida | Uso observado | Ação necessária |
## Identidade em nuvem e apps
| Objeto (app OAuth, método MFA, regra de inbox) | Criado em | Por | Ação |
## Dados
| Repositório | Ação do atacante (acesso/cópia/exfiltração/criptografia) | Volume | Categoria de dados (pessoais? sensíveis? segredo comercial?) | Confiança |
## Janela do comprometimento
- Início (primeira atividade maliciosa): ...   - Fim (última atividade / contenção): ...   - Dwell time: ...
## Infraestrutura do atacante
| Tipo | Valor | Papel (C2, staging, exfiltração, sign-in) |
## Lacunas que impedem fechar o escopo
```

## 3. Critérios para dizer "escopo fechado"
- Todos os IOCs pesquisados em **todo** o ambiente (não só nos hosts conhecidos), com consultas de prevalência (Q2.5 e equivalentes).
- Todas as contas comprometidas pivotadas (`pivo --user`) em todas as fontes.
- Hosts sem EDR tratados como limitação explícita ou cobertos por coleta adicional.
- Nenhuma atividade do atacante depois da contenção (monitorar por N dias).
Se algum critério não for atendido, o escopo é **preliminar**: diga isso.

## 4. Contenção e erradicação coerentes com o escopo
Proponha em `acoes.md`, priorizando: isolar hosts comprometidos; resetar **todas** as contas comprometidas e provavelmente comprometidas (contas de serviço: coordenar com o dono); revogar sessões e refresh tokens (`Revoke-MgUserSignInSession`); remover métodos MFA e apps OAuth do atacante; bloquear a infraestrutura do atacante (IP, domínio, hash); remover a persistência (tarefas, serviços, chaves); dupla troca da senha do krbtgt se houver suspeita de comprometimento de AD. **Ações disruptivas exigem confirmação do usuário.**

## 5. Gatilho LGPD
Se houver acesso ou exfiltração confirmados ou prováveis de dados pessoais, sinalize para o **DPO/Jurídico já**, sem esperar o relatório final. A avaliação de comunicação à ANPD e aos titulares tem prazo (ver `relatorio`, nota DPO/Jurídico).
