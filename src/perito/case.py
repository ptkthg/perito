"""Gestão de casos: estrutura de pastas, ingestão de evidência bruta e cadeia de custódia."""

from __future__ import annotations

import csv
import getpass
import hashlib
import os
import re
import shutil
import stat
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CASES_DIR = Path(os.environ.get("PERITO_CASOS", REPO_ROOT / "casos"))

CUSTODY_HEADER = ["registro_utc", "arquivo", "sha256", "bytes", "fonte", "coletado_por", "observacao"]
IOC_HEADER = ["tipo", "valor", "primeira_vez_utc", "ultima_vez_utc", "fonte", "contexto", "confianca"]

_CASE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$")


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


SKELETON: dict[str, str] = {
    "caso.md": """# Caso {case_id}: {titulo}

- **Aberto em (UTC):** {aberto}
- **Responsável:** {responsavel}
- **Fase (NIST 800-61r3 / PICERL):** Detectar / Identification
- **Severidade:** a definir
- **Status:** aberto

## Gatilho
<!-- Alerta, denúncia ou notificação que originou o caso. ID do alerta, horário, fonte. -->

## Ativos e contas inicialmente envolvidos
| Tipo | Identificador | Criticidade | Dono |
|---|---|---|---|

## Partes envolvidas
<!-- Segurança, Infra, Engenharia, DPO, Jurídico, Comunicação, fornecedores. -->

## Registro de decisões
| Quando (UTC) | Decisão | Quem | Justificativa |
|---|---|---|---|
""",
    "triagem.md": "# Triagem: {case_id}\n\n<!-- Preenchido pela skill triagem-alerta. -->\n",
    "hipoteses.md": """# Hipóteses: {case_id}

<!-- Uma seção por hipótese. Status: aberta | confirmada | refutada | inconclusiva -->

## H1: <título>
- **Status:** aberta
- **Confiança:** baixa | média | alta
- **Fase ATT&CK:**
- **Sustentação ([EVIDÊNCIA] com raw_ref):**
- **Confirmaria:**
- **Refutaria:**
- **Próximo passo:**
""",
    "achados.md": """# Achados: {case_id}

<!-- Formato: | horário UTC | host | conta | o que | ATT&CK | evidência (raw_ref) | -->
| # | UTC | Host | Conta | Achado | ATT&CK | Evidência |
|---|---|---|---|---|---|---|
""",
    "escopo.md": "# Escopo do comprometimento: {case_id}\n\n<!-- Preenchido pela skill escopo. -->\n",
    "limitacoes.md": """# Limitações: {case_id}

| # | Limitação | Impacto na conclusão | Como mitigar |
|---|---|---|---|
""",
    "acoes.md": """# Ações de resposta: {case_id}

| # | UTC | Tipo (contenção/erradicação/recuperação/melhoria) | Ação | Responsável | Status |
|---|---|---|---|---|---|
""",
}


@dataclass
class Case:
    case_id: str
    path: Path

    @property
    def raw_dir(self) -> Path:
        return self.path / "evidencias" / "brutas"

    @property
    def normalized_dir(self) -> Path:
        return self.path / "normalizado"

    @property
    def timeline_dir(self) -> Path:
        return self.path / "timeline"

    @property
    def custody_file(self) -> Path:
        return self.path / "custodia.csv"

    @property
    def iocs_file(self) -> Path:
        return self.path / "iocs.csv"


def validate_case_id(case_id: str) -> str:
    if not _CASE_ID.match(case_id):
        raise ValueError(
            f"ID de caso inválido: {case_id!r}. Use letras, números, '.', '_' ou '-' (ex.: IR-2026-001)."
        )
    return case_id


def get_case(case_id: str, base: Path | None = None) -> Case:
    base = base or CASES_DIR
    path = base / validate_case_id(case_id)
    if not path.is_dir():
        raise FileNotFoundError(f"Caso {case_id} não encontrado em {base}. Crie com: perito novo-caso {case_id}")
    return Case(case_id, path)


def create_case(case_id: str, titulo: str = "", base: Path | None = None, responsavel: str | None = None) -> Case:
    base = base or CASES_DIR
    path = base / validate_case_id(case_id)
    if path.exists():
        raise FileExistsError(f"Caso {case_id} já existe em {path}")
    case = Case(case_id, path)
    for d in (case.raw_dir, case.normalized_dir, case.timeline_dir, path / "revisoes", path / "relatorios"):
        d.mkdir(parents=True, exist_ok=True)
    fmt = {
        "case_id": case_id,
        "titulo": titulo or "sem título",
        "aberto": now_utc(),
        "responsavel": responsavel or _whoami(),
    }
    for name, content in SKELETON.items():
        (path / name).write_text(content.format(**fmt), encoding="utf-8")
    _write_csv_header(case.custody_file, CUSTODY_HEADER)
    _write_csv_header(case.iocs_file, IOC_HEADER)
    return case


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def add_evidence(case: Case, src: Path, fonte: str = "", observacao: str = "", coletado_por: str | None = None) -> Path:
    """Copia ``src`` para ``evidencias/brutas`` (somente leitura) e registra em ``custodia.csv``.

    Se um arquivo com o mesmo hash já estiver registrado, não duplica: devolve o caminho existente.
    Se houver colisão de nome com hash diferente, acrescenta sufixo ao nome.
    """
    src = Path(src)
    if not src.is_file():
        raise FileNotFoundError(src)
    digest = sha256_file(src)

    for row in read_custody(case):
        if row["sha256"] == digest:
            existing = case.raw_dir / row["arquivo"]
            if existing.exists():
                return existing

    dest = case.raw_dir / src.name
    n = 1
    while dest.exists():
        dest = case.raw_dir / f"{src.stem}__{n}{src.suffix}"
        n += 1
    shutil.copy2(src, dest)
    if sha256_file(dest) != digest:
        dest.unlink()
        raise IOError(f"Hash divergente após cópia de {src}")
    _make_readonly(dest)

    with case.custody_file.open("a", newline="", encoding="utf-8") as fh:
        csv.writer(fh).writerow(
            [now_utc(), dest.name, digest, dest.stat().st_size, fonte, coletado_por or _whoami(), observacao]
        )
    return dest


def read_custody(case: Case) -> list[dict[str, str]]:
    if not case.custody_file.exists():
        return []
    with case.custody_file.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def verify_custody(case: Case) -> list[tuple[str, str]]:
    """Recalcula os hashes. Devolve [(arquivo, problema)] e uma lista vazia se tudo estiver íntegro."""
    problems = []
    for row in read_custody(case):
        p = case.raw_dir / row["arquivo"]
        if not p.exists():
            problems.append((row["arquivo"], "ausente"))
        elif sha256_file(p) != row["sha256"]:
            problems.append((row["arquivo"], "hash divergente"))
    return problems


def _make_readonly(path: Path) -> None:
    mode = path.stat().st_mode
    path.chmod(mode & ~stat.S_IWUSR & ~stat.S_IWGRP & ~stat.S_IWOTH)


def _write_csv_header(path: Path, header: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        csv.writer(fh).writerow(header)


def _whoami() -> str:
    try:
        return getpass.getuser()
    except Exception:  # pragma: no cover
        return "desconhecido"
