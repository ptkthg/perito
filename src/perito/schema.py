"""Schema normalizado de eventos do Perito.

Todo parser converte a sua fonte em instâncias de ``Event``. A timeline, os pivôs e
os relatórios trabalham só sobre este schema.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

SOURCES = (
    "defender",
    "sentinel",
    "entra_signin",
    "entra_audit",
    "splunk",
    "elastic",
    "wazuh",
)

# Tipos de evento normalizados (event_type)
EVENT_TYPES = (
    "process",      # criação de processo
    "network",      # conexão de rede / proxy / firewall
    "dns",          # consulta DNS
    "file",         # criação/modificação/remoção de arquivo
    "registry",     # alteração de registro
    "logon",        # logon em host (Windows 4624/4625, DeviceLogonEvents)
    "signin",       # sign-in em provedor de identidade (Entra)
    "audit",        # auditoria de diretório/identidade (Entra audit, alterações de conta)
    "email",        # entrega/clique de e-mail
    "service",      # instalação/alteração de serviço
    "scheduled_task",
    "alert",        # alerta gerado por EDR/SIEM
    "other",
)


@dataclass
class Event:
    ts_utc: str                       # ISO 8601 em UTC com 'Z', precisão de milissegundos
    source: str                       # um de SOURCES
    event_type: str                   # um de EVENT_TYPES
    raw_ref: str                      # "<arquivo>:<linha>" ou "<arquivo>#<índice>"
    ts_original: str = ""             # valor de horário exatamente como veio na fonte
    host: str | None = None           # nome curto do host, minúsculo
    user: str | None = None           # conta normalizada (ver normalize_user)
    src_ip: str | None = None
    dst_ip: str | None = None
    dst_port: int | None = None
    domain: str | None = None         # FQDN/URL de destino (DNS, proxy, RemoteUrl)
    process: str | None = None        # nome do executável (ex.: powershell.exe), minúsculo
    parent: str | None = None         # processo pai, minúsculo
    cmdline: str | None = None
    file_path: str | None = None
    sha256: str | None = None         # minúsculo
    action: str | None = None         # ação original (ActionType, EventID, operationName...)
    outcome: str | None = None        # success | failure | blocked | None
    description: str = ""             # resumo legível de 1 linha
    severity: str | None = None       # para alertas: informational|low|medium|high|critical
    mitre: list[str] = field(default_factory=list)   # ex.: ["T1059.001"]
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=False)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Event":
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in data.items() if k in known})

    def dedupe_key(self) -> str:
        """Chave de deduplicação exata (mesma fonte relatando o mesmo fato)."""
        parts = [
            self.ts_utc, self.source, self.event_type, self.host or "", self.user or "",
            self.src_ip or "", self.dst_ip or "", str(self.dst_port or ""), self.domain or "",
            self.process or "", self.parent or "", self.cmdline or "", self.file_path or "",
            self.sha256 or "", self.action or "",
        ]
        return hashlib.sha1("\x1f".join(parts).encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------------------
# Normalização
# --------------------------------------------------------------------------------------

_TZ_NO_COLON = re.compile(r"([+-]\d{2})(\d{2})$")
_FRACTION = re.compile(r"\.(\d+)")


def parse_ts(value: Any, assume_tz: timezone | None = None) -> str:
    """Converte um horário de qualquer fonte em ISO 8601 UTC com 'Z' (milissegundos).

    Aceita:
      - ISO 8601 com 'Z' ou offset (+03:00, -0300), com até 7 casas decimais (formato Microsoft)
      - "YYYY-MM-DD HH:MM:SS[.fff]" (assume UTC se ``assume_tz`` não for informado)
      - epoch em segundos ou milissegundos (int/float/str numérico)
      - ``datetime`` (naive é tratado como UTC)

    Levanta ValueError se não conseguir interpretar.
    """
    if value is None or value == "":
        raise ValueError("horário vazio")

    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, (int, float)) or (isinstance(value, str) and re.fullmatch(r"\d{10}(\.\d+)?|\d{13}", value.strip())):
        num = float(value)
        if num > 1e12:  # milissegundos
            num /= 1000.0
        dt = datetime.fromtimestamp(num, tz=timezone.utc)
    else:
        s = str(value).strip()
        if s.endswith(("Z", "z")):
            s = s[:-1] + "+00:00"
        s = _TZ_NO_COLON.sub(r"\1:\2", s)
        # Python aceita até 6 casas decimais; fontes Microsoft trazem 7.
        m = _FRACTION.search(s)
        if m and len(m.group(1)) > 6:
            s = s[: m.start(1)] + m.group(1)[:6] + s[m.end(1):]
        s = s.replace(" ", "T", 1) if re.match(r"\d{4}-\d{2}-\d{2} \d", s) else s
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            for fmt in ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %H:%M:%S", "%d/%m/%Y %H:%M:%S"):
                try:
                    dt = datetime.strptime(s, fmt)
                    break
                except ValueError:
                    continue
            else:
                raise ValueError(f"horário não reconhecido: {value!r}") from None

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=assume_tz or timezone.utc)
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def normalize_host(value: Any) -> str | None:
    """'WS-FIN-023.acme.local' -> 'ws-fin-023'. Mantém IPs como estão."""
    if value is None:
        return None
    s = str(value).strip().strip("\\").lower()
    if not s or s in ("-", "n/a", "null", "none"):
        return None
    if re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", s):
        return s
    return s.split(".")[0]


def normalize_user(value: Any) -> str | None:
    """Normaliza conta para correlação entre fontes.

    'ACME\\M.Silva' -> 'm.silva'; 'm.silva@acme.com.br' -> 'm.silva'; 'm.silva' -> 'm.silva'.
    Contas de máquina/sistema são preservadas em minúsculo ('system', 'ws-fin-023$').
    O valor original deve ser guardado em ``extra['user_original']`` pelo parser.
    """
    if value is None:
        return None
    s = str(value).strip().lower()
    if not s or s in ("-", "n/a", "null", "none"):
        return None
    if "\\" in s:
        s = s.split("\\")[-1]
    if "@" in s:
        s = s.split("@")[0]
    return s or None


def normalize_process(value: Any) -> str | None:
    """'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' -> 'powershell.exe'."""
    if value is None:
        return None
    s = str(value).strip().strip('"')
    if not s:
        return None
    return re.split(r"[\\/]", s)[-1].lower()


def normalize_ip(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s in ("-", "::1", "127.0.0.1", "0.0.0.0", "n/a"):
        return None if s in ("", "-", "n/a") else s
    if s.startswith("::ffff:"):
        s = s[7:]
    return s


def is_private_ip(ip: str | None) -> bool:
    if not ip:
        return False
    import ipaddress

    try:
        return ipaddress.ip_address(ip).is_private
    except ValueError:
        return False


def to_int(value: Any) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None
