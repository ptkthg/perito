# Análise de causa raiz: {{ID}}

> Foco em **controles e processos**, não em pessoas (postmortem sem culpados).

## 1. Problema
<!-- Uma frase: o efeito indesejado. Ex.: "Dados do Financeiro foram exfiltrados de srv-file-01". -->

## 2. Cinco porquês
| # | Por quê? | Resposta | Evidência |
|---|---|---|---|
| 1 | Por que o efeito ocorreu? | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |

**Causa raiz:** <!-- a falha de controle ou processo mais profunda sobre a qual a organização pode agir. -->

## 3. Árvore de causas
```
Efeito: ...
├── Causa técnica imediata: ...
├── Falhas de controle
│   ├── Preventivo: ...         (ex.: macros da internet permitidas; usuário admin local; conta de serviço com logon interativo)
│   ├── Detectivo: ...          (ex.: servidor sem EDR; nenhuma regra para rclone; MFA fatigue sem alerta)
│   └── Resposta: ...           (ex.: alerta de LSASS sem triagem em 30 min)
└── Fatores organizacionais: ... (ex.: falta de inventário de contas de serviço; exceção de MFA sem dono)
```

## 4. Fatores contribuintes
| Fator | Tipo (pessoa/processo/tecnologia) | Como contribuiu | Evidência |
|---|---|---|---|

## 5. O que funcionou
<!-- Controles que detectaram, limitaram ou ajudaram a investigar. -->

## 6. Ações corretivas
| # | Ação | Ataca qual causa | Controle (CIS v8 / NIST CSF 2.0) | Dono | Prazo | Verificação |
|---|---|---|---|---|---|---|
