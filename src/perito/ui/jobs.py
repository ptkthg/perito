"""Tarefas locais de provedores, com rascunhos e aplicação explícita.

O staging delimita as escritas solicitadas; snapshots detectam violações. Não
substitui um sandbox do sistema operacional para executáveis não confiáveis.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import Event, RLock, Thread

from .. import case as cases
from .._atomic import atomic_open, version
from .writes import audit, case_lock, confined, get_case
from ._processes import ProcessTree

PHASES = ('acesso-inicial', 'execucao', 'persistencia', 'credenciais',
          'movimentacao-lateral', 'exfiltracao', 'identidade')
ACTIONS = {
    'resumo': ('Atualizar o resumo em linguagem simples', ['caso.md']),
    'relatorio-executivo': ('Gerar relatório executivo', ['relatorios/relatorio-executivo.md']),
    'relatorio-tecnico': ('Gerar relatório técnico', ['relatorios/relatorio-tecnico.md']),
    'nota-dpo': ('Gerar nota técnica para DPO e Jurídico', ['relatorios/nota-dpo-juridico.md']),
    'revisao-cruzada': ('Revisar criticamente a investigação', ['revisoes/{agente}-{data}.md', 'revisoes/resumo-cobertura.md']),
    'investigar-fase': ('Investigar uma fase do incidente', ['achados.md', 'hipoteses.md', 'limitacoes.md', 'iocs.csv', 'caso.md']),
}
PROMPTS = Path(__file__).with_name('prompts')
DIFF_LIMIT = 200 * 1024
STAGING_TTL = 7 * 86400
_CASE_ROUTE = re.compile(r'/api/casos/([^/]+)/agentes\Z')
_JOB_ROUTE = re.compile(r'/api/agentes/([a-f0-9-]{36})(?:/(aplicar|descartar|cancelar))?\Z')


class JobError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def _executable(agent):
    override = os.environ.get(f'PERITO_{agent.upper()}_BIN')
    found = override if override is not None else shutil.which(agent)
    if not found or not Path(found).is_file():
        return None
    if Path(found).suffix.lower() == '.py':
        return [sys.executable, str(Path(found).resolve())]
    return [str(Path(found).resolve())] if os.access(found, os.X_OK) else None


def _safe(root, relative):
    """Rejeita links/junctions e caminhos não canônicos, inclusive nos pais."""
    root = root.resolve()
    path = root / relative
    if path.resolve() != path or not path.is_relative_to(root):
        raise ValueError('Caminho fora do diretório permitido.')
    current = path
    while current != root:
        if current.is_symlink() or (hasattr(current, 'is_junction') and current.is_junction()):
            raise ValueError('Links não são permitidos no rascunho.')
        current = current.parent
    return path


def _snapshot(root):
    result = {}
    for directory, directories, files in os.walk(root, followlinks=False):
        relative = Path(directory).relative_to(root)
        if relative == Path('.'):
            directories[:] = [d for d in directories if d not in ('.perito', 'agentes')]
        for name in directories:
            _safe(root, relative / name)
        for name in files:
            if relative == Path('.') and name == 'auditoria-ui.log':
                continue
            path = _safe(root, relative / name)
            stat = path.stat()
            result[path.relative_to(root).as_posix()] = {
                'versao': f'{stat.st_mtime_ns}-{stat.st_size}',
                'sha256': cases.sha256_file(path),
            }
    return result


def _analysis_files(root):
    paths = list(root.glob('*.md'))
    if (root / 'iocs.csv').exists():
        paths.append(root / 'iocs.csv')
    for directory in ('normalizado', 'timeline', 'revisoes', 'relatorios'):
        path = _safe(root, directory)
        if path.exists():
            paths.extend(p for p in path.rglob('*') if p.is_file())
    return [_safe(root, p.relative_to(root)) for p in paths]


def _save_json(path, data):
    with atomic_open(path) as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


@dataclass
class Job:
    job: str
    case: cases.Case
    acao: str
    agente: str
    draft: Path
    snapshot: dict
    targets: list[str]
    timeout: float
    inicio: str = field(default_factory=cases.now_utc)
    fim: str | None = None
    status: str = 'rodando'
    mensagem: str = ''
    linhas: list[str] = field(default_factory=list)
    arquivos_alterados: list[str] = field(default_factory=list)
    diff: str = ''
    aplicado: bool = False
    arquivos_aplicados: list[str] = field(default_factory=list)
    descartado: bool = False
    process: subprocess.Popen | None = None
    cancel: Event = field(default_factory=Event)
    thread: Thread | None = None
    started: float = field(default_factory=time.monotonic)
    elapsed: float = 0
    # Originais só dos arquivos de análise para gerar diff sem reler o caso vivo.
    originals: dict[str, bytes] = field(default_factory=dict)
    proposed: dict[str, str] = field(default_factory=dict)

    def public(self, since=0):
        return dict(job=self.job, caso=self.case.case_id, acao=self.acao,
                    agente=self.agente, status=self.status, inicio=self.inicio,
                    fim=self.fim, decorrido_s=round(time.monotonic() - self.started if self.status == 'rodando' else self.elapsed, 3),
                    linhas=self.linhas[since:], proxima=len(self.linhas),
                    arquivos_alterados=self.arquivos_alterados[:], diff=self.diff,
                    mensagem=self.mensagem, aplicado=self.aplicado,
                    arquivos_aplicados=self.arquivos_aplicados[:], descartado=self.descartado)


class JobManager:
    def __init__(self, case_base, *, repo_root=cases.REPO_ROOT):
        self.base = Path(case_base).resolve()
        self.repo = Path(repo_root).resolve()
        self.jobs = {}
        self.lock = RLock()
        self.closed = False
        self._cleanup()

    def _cleanup(self):
        """Somente rascunhos expirados, nunca arquivos do caso."""
        if not self.base.is_dir():
            return
        for directory in self.base.iterdir():
            if not directory.is_dir() or directory.is_symlink():
                continue
            try:
                _safe(self.base, directory.name)
                staging = _safe(directory, '.perito/staging')
                if not staging.is_dir():
                    continue
                for draft in staging.iterdir():
                    _safe(staging, draft.name)
                    if draft.is_dir() and time.time() - draft.stat().st_mtime > STAGING_TTL:
                        shutil.rmtree(draft)
            except (OSError, ValueError):
                continue

    def available(self):
        return dict(claude=_executable('claude') is not None,
                    codex=_executable('codex') is not None,
                    acoes=[dict(acao=name, descricao=description, arquivos=targets,
                                agentes=['claude', 'codex'],
                                **({'parametros': list(PHASES)} if name == 'investigar-fase' else {}))
                           for name, (description, targets) in ACTIONS.items()])

    def start(self, case_id, data):
        if not isinstance(data, dict) or set(data) - {'acao', 'agente', 'parametro', 'instrucao_extra'}:
            raise ValueError('Parâmetros inválidos.')
        action, agent = data.get('acao'), data.get('agente')
        if not isinstance(action, str) or action not in ACTIONS or agent not in ('claude', 'codex'):
            raise ValueError('Ação ou agente inválido.')
        phase = data.get('parametro')
        if (action == 'investigar-fase' and phase not in PHASES) or (action != 'investigar-fase' and phase is not None):
            raise ValueError('Parâmetro de fase inválido.')
        extra = data.get('instrucao_extra', '')
        if not isinstance(extra, str) or len(extra) > 500 or any(unicodedata.category(c).startswith('C') for c in extra):
            raise ValueError('Instrução adicional inválida (até 500 caracteres, sem controles).')
        executable = _executable(agent)
        if executable is None:
            raise JobError(400, 'agente indisponível')
        timeout = float(os.environ.get('PERITO_AGENTE_TIMEOUT', '1200'))
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError('Timeout inválido.')
        case = get_case(self.base, case_id)
        with self.lock, case_lock(case):
            if self.closed:
                raise JobError(409, 'Executor encerrado.')
            if any(j.case.path == case.path and j.status == 'rodando' for j in self.jobs.values()):
                raise JobError(409, 'já existe tarefa em andamento')
            identifier = str(uuid.uuid4())
            draft = _safe(case.path, f'.perito/staging/{identifier}/{case_id}')
            logdir = confined(case, 'agentes')
            logdir.mkdir(exist_ok=True)
            snapshot = _snapshot(case.path)
            stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')
            targets = [t.format(agente=agent, data=stamp) for t in ACTIONS[action][1]]
            job = Job(identifier, case, action, agent, draft, snapshot, targets, timeout)
            try:
                draft.mkdir(parents=True)
                for name in ('normalizado', 'timeline', 'revisoes', 'relatorios'):
                    source = _safe(case.path, name)
                    if source.is_dir():
                        directories = [source, *(p for p in source.rglob('*') if p.is_dir())]
                        for directory in directories:
                            relative = _safe(case.path, directory.relative_to(case.path)).relative_to(case.path)
                            _safe(draft, relative).mkdir(parents=True, exist_ok=True)
                for path in _analysis_files(case.path):
                    name = path.relative_to(case.path).as_posix()
                    job.originals[name] = path.read_bytes()
                    target = _safe(draft, name)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(job.originals[name])
                if action == 'revisao-cruzada':
                    target = draft / 'revisoes/resumo-cobertura.md'
                    target.parent.mkdir(exist_ok=True)
                    # Processo Python local para não redirecionar stdout global do
                    # servidor concorrente. A CLI reutiliza _summary do Perito e
                    # verifica custódia no original, que não integra o staging.
                    env = os.environ.copy()
                    env.update(PYTHONIOENCODING='utf-8', PYTHONUTF8='1',
                               PYTHONPATH=str(self.repo / 'src'))
                    summary = subprocess.run(
                        [sys.executable, '-c',
                         'import sys; from pathlib import Path; '
                         'from perito import case, timeline; from perito.cli import _summary; '
                         'c = case.get_case(sys.argv[2], Path(sys.argv[1])); '
                         '_summary(c, timeline.build(timeline.load_events(c)))',
                         str(self.base), case_id],
                        cwd=self.repo, env=env, capture_output=True, text=True,
                        encoding='utf-8', check=True, timeout=60)
                    target.write_text(summary.stdout, encoding='utf-8')
                prompt = self._prompt(job, phase, extra)
                command, cwd = self._command(job, executable, prompt)
                audit(case, 'agente inicio', identifier, f'{agent}: {action}', '', 'rodando')
                self.jobs[identifier] = job
                job.thread = Thread(target=self._run, args=(job, command, cwd), daemon=True)
                job.thread.start()
            except Exception:
                self._remove_draft(job)
                self.jobs.pop(identifier, None)
                raise
            return dict(ok=True, job=identifier, status='rodando')

    def _prompt(self, job, phase, extra):
        template = (PROMPTS / f'{job.acao}.md').read_text(encoding='utf-8')
        reviewer = ''
        if job.acao == 'revisao-cruzada':
            skill = (self.repo / '.agents/skills/revisao-cruzada/SKILL.md').read_text(encoding='utf-8')
            reviewer = skill.split('## PROMPT_REVISOR', 1)[1].split('```', 2)[1].strip()
        values = dict(id=job.case.case_id, caminho=str(job.draft),
                      arquivos=', '.join(job.targets), parametro=phase or '',
                      prompt_revisor=reviewer, raiz=str(self.repo))
        for key, value in values.items():
            template = template.replace('{{' + key + '}}', value)
        # Insere o dado por último: não interpreta placeholders do usuário.
        extra = extra.replace('<<<', '&lt;&lt;&lt;').replace('>>>', '&gt;&gt;&gt;')
        return template.replace('{{instrucao_extra}}', extra)

    def _command(self, job, executable, prompt):
        if job.agente == 'claude':
            return [*executable, '-p', prompt, '--permission-mode', 'acceptEdits',
                    '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(uv run perito *)',
                    '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
                    '--add-dir', str(job.draft)], self.repo
        output = (job.draft / job.targets[0] if job.acao == 'revisao-cruzada'
                  else job.case.path / 'agentes' / f'{job.job}.final.md')
        output.parent.mkdir(parents=True, exist_ok=True)
        return [*executable, 'exec', '-C', str(job.draft), '-s',
                'read-only' if job.acao == 'revisao-cruzada' else 'workspace-write',
                '--skip-git-repo-check', '-o', str(output), prompt], job.draft

    def _log(self, job, line):
        if job.agente != 'claude':
            return [line]
        try:
            data = json.loads(line)
        except ValueError:
            return [line]
        if not isinstance(data, dict):
            return [line]
        result = []
        if data.get('type') == 'assistant':
            message = data.get('message')
            content = message.get('content') if isinstance(message, dict) else None
            if not isinstance(content, list):
                return [line]
            for item in content:
                if not isinstance(item, dict):
                    continue
                if item.get('type') == 'text':
                    result.extend(str(item.get('text', '')).splitlines())
                elif item.get('type') == 'tool_use':
                    args = item.get('input')
                    name = str(args.get('file_path', '')) if isinstance(args, dict) else ''
                    result.append(('Editando ' if item.get('name') in ('Edit', 'Write') else 'Ferramenta ') + (name or item.get('name', '')))
        elif data.get('type') == 'result':
            result.extend(str(data.get('result', data.get('subtype', 'Resultado'))).splitlines())
        return result

    def _read_output(self, job, process, log, raw):
        for line in process.stdout:
            raw.write(line)
            raw.flush()
            readable = self._log(job, line.rstrip('\r\n'))
            for entry in readable:
                log.write(entry + '\n')
            log.flush()
            with self.lock:
                job.linhas.extend(readable)

    def _run(self, job, command, cwd):
        status, message = 'erro', ''
        process = None
        tree = None
        try:
            env = os.environ.copy()
            env.update(PERITO_CASOS=str(job.draft.parent), PYTHONIOENCODING='utf-8', PYTHONUTF8='1', PYTHONUNBUFFERED='1')
            logdir = job.case.path / 'agentes'
            with (logdir / f'{job.job}.log').open('w', encoding='utf-8') as log, (logdir / f'{job.job}.raw.log').open('w', encoding='utf-8') as raw:
                if job.cancel.is_set():
                    status = 'cancelado'
                else:
                    process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                               text=True, encoding='utf-8', errors='replace',
                                               start_new_session=os.name != 'nt',
                                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                    tree = ProcessTree(process)
                    with self.lock:
                        job.process = process
                    reader = Thread(target=self._read_output, args=(job, process, log, raw), daemon=True)
                    reader.start()
                    while process.poll() is None:
                        if job.cancel.wait(.04):
                            status = 'cancelado'
                            tree.stop()
                            break
                        if time.monotonic() - job.started >= job.timeout:
                            status = 'tempo_esgotado'
                            tree.stop()
                            break
                    else:
                        status = 'concluido' if process.returncode == 0 else 'erro'
                        if process.returncode:
                            message = f'Agente terminou com código {process.returncode}.'
                    # Não deixa filhos vivos nem pipes abertos após o término.
                    tree.stop()
                    reader.join(timeout=3)
                    process.stdout.close()
        except Exception as exc:
            message = f'Falha ao executar agente: {exc}'
            if process is not None and process.poll() is None:
                if tree is not None:
                    tree.stop()
                else:
                    process.kill()
                    process.wait()
        finally:
            with self.lock, case_lock(job.case):
                try:
                    after = _snapshot(job.case.path)
                    changed = sorted(name for name in job.snapshot.keys() | after.keys()
                                     if job.snapshot.get(name) != after.get(name))
                    if changed:
                        status = 'violacao'
                        message = 'Violação: arquivos do caso real mudaram durante a tarefa: ' + ', '.join(changed)
                    if status == 'concluido':
                        self._compare(job)
                    if job.cancel.is_set() and status != 'violacao':
                        status = 'cancelado'
                except Exception as exc:
                    status = 'violacao' if isinstance(exc, ValueError) else 'erro'
                    message = f'Falha na verificação/finalização: {exc}'
                if status != 'concluido':
                    try:
                        self._remove_draft(job)
                    except (OSError, ValueError) as exc:
                        message += f' Não foi possível remover o rascunho: {exc}'
                job.elapsed = time.monotonic() - job.started
                job.fim = cases.now_utc()
                job.mensagem = message
                try:
                    # Publicar status terminal somente depois de persistir e auditar.
                    state = self._state(job)
                    state.update(status=status, decorrido_s=round(job.elapsed, 3))
                    _save_json(job.case.path / 'agentes' / f'{job.job}.json', state)
                    audit(job.case, 'agente fim', job.job,
                          json.dumps(dict(status=status, arquivos=job.arquivos_alterados, mensagem=message), ensure_ascii=False), 'rodando', status)
                except OSError as exc:
                    status = 'erro'
                    job.mensagem += f' Falha ao persistir/auditar: {exc}'
                finally:
                    job.status = status

    def _compare(self, job):
        snapshot = _snapshot(job.draft)
        pieces, remaining = [], DIFF_LIMIT
        for name in sorted(snapshot.keys() | job.originals.keys()):
            path = _safe(job.draft, name)
            before = job.originals.get(name, b'')
            if not path.is_file():
                if name in job.originals:
                    raise ValueError(f'O agente removeu arquivo: {name}.')
                continue
            content = path.read_bytes()
            if name in job.originals and content == before:
                continue
            # Nenhum arquivo fora da whitelist pode ser promovido.
            if name not in job.targets:
                raise ValueError(f'Arquivo fora dos alvos da ação: {name}.')
            job.arquivos_alterados.append(name)
            job.proposed[name] = hashlib.sha256(content).hexdigest()
            if Path(name).suffix in ('.md', '.csv'):
                delta = ''.join(difflib.unified_diff(before.decode('utf-8', errors='replace').splitlines(keepends=True),
                                                    content.decode('utf-8', errors='replace').splitlines(keepends=True),
                                                    fromfile='caso/' + name, tofile='rascunho/' + name))
                chunk = delta.encode('utf-8')[:remaining].decode('utf-8', errors='ignore')
                pieces.append(chunk)
                remaining -= len(chunk.encode('utf-8'))
        job.diff = ''.join(pieces)

    def _lookup(self, identifier):
        job = self.jobs.get(identifier)
        if job is None:
            state = self._stored(identifier)
            case = get_case(self.base, state['caso'])
            draft = _safe(case.path, f'.perito/staging/{identifier}/{case.case_id}')
            job = Job(identifier, case, state['acao'], state['agente'], draft,
                      state.get('_snapshot', {}), state.get('_targets', []), 1200)
            for key in ('inicio', 'fim', 'status', 'mensagem', 'linhas', 'arquivos_alterados',
                        'diff', 'aplicado', 'arquivos_aplicados', 'descartado'):
                if key in state:
                    setattr(job, key, state[key])
            job.elapsed = state['decorrido_s']
            job.proposed = state.get('_proposed', {})
            self.jobs[identifier] = job
        return job

    def poll(self, identifier, since=0):
        with self.lock:
            if since < 0:
                raise ValueError('desde deve ser maior ou igual a zero.')
            if identifier in self.jobs:
                return self.jobs[identifier].public(since)
            state = {k: v for k, v in self._stored(identifier).items() if not k.startswith('_')}
            state['linhas'] = state.get('linhas', [])[since:]
            return state

    def _stored(self, identifier):
        for path in self.base.glob(f'*/agentes/{identifier}.json'):
            if path.resolve() != path:
                continue
            return json.loads(path.read_text(encoding='utf-8'))
        raise JobError(404, 'Tarefa não encontrada.')

    def history(self, case_id):
        case = get_case(self.base, case_id)
        with self.lock:
            result = []
            directory = confined(case, 'agentes')
            for path in directory.glob('*.json'):
                _safe(directory, path.name)
                state = json.loads(path.read_text(encoding='utf-8'))
                result.append({k: v for k, v in state.items() if not k.startswith('_')})
            return sorted(result, key=lambda j: (j['inicio'], j['job']), reverse=True)

    def cancel_job(self, identifier):
        with self.lock:
            job = self._lookup(identifier)
            if job.status == 'rodando':
                job.cancel.set()
            return dict(ok=True)

    def _persist(self, job):
        _save_json(job.case.path / 'agentes' / f'{job.job}.json', self._state(job))

    @staticmethod
    def _state(job):
        return dict(job.public(), _snapshot=job.snapshot, _targets=job.targets,
                    _proposed=job.proposed)

    def apply(self, identifier, data):
        with self.lock:
            job = self._lookup(identifier)
            if job.status != 'concluido' or job.descartado or not job.draft.is_dir():
                raise JobError(409, 'Rascunho indisponível para aplicação.')
            if not isinstance(data, dict) or set(data) != {'arquivos'}:
                raise ValueError('Informe os arquivos a aplicar.')
            names = data['arquivos']
            if not isinstance(names, list) or not names or any(not isinstance(n, str) or n not in job.arquivos_alterados for n in names) or len(set(names)) != len(names):
                raise ValueError('Seleção de arquivos inválida.')
            with case_lock(job.case):
                contents = {}
                # Valide todos antes de escrever o primeiro.
                for name in names:
                    source = _safe(job.draft, name)
                    target = _safe(job.case.path, name)
                    expected = job.snapshot.get(name, {}).get('versao', '0-0')
                    if version(target) != expected:
                        raise JobError(409, f'Arquivo mudou desde o início da tarefa: {name}')
                    content = source.read_bytes()
                    if hashlib.sha256(content).hexdigest() != job.proposed[name]:
                        raise JobError(409, f'Rascunho mudou após a conclusão: {name}')
                    contents[name] = content.decode('utf-8')
                for name, text in contents.items():
                    target = _safe(job.case.path, name)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    before = version(target)
                    with atomic_open(target) as handle:
                        handle.write(text)
                    audit(job.case, 'agente aplicar', name, job.job, before, version(target))
                    if name not in job.arquivos_aplicados:
                        job.arquivos_aplicados.append(name)
                job.aplicado = True
                self._persist(job)
            return dict(ok=True, arquivos=names, aplicado=True)

    @staticmethod
    def _remove_draft(job):
        parent = _safe(job.case.path, f'.perito/staging/{job.job}')
        if parent.is_dir():
            shutil.rmtree(parent)

    def discard(self, identifier):
        with self.lock:
            job = self._lookup(identifier)
            if job.status == 'rodando':
                raise JobError(409, 'Cancele a tarefa antes de descartar.')
            self._remove_draft(job)
            job.descartado = True
            self._persist(job)
            audit(job.case, 'agente descartar', job.job, 'Rascunho removido', '', '')
            return dict(ok=True)

    def close(self):
        with self.lock:
            self.closed = True
            jobs = list(self.jobs.values())
            for job in jobs:
                if job.status == 'rodando':
                    job.cancel.set()
        for job in jobs:
            if job.thread is not None:
                job.thread.join(timeout=10)

    def handles(self, route):
        return route == '/api/agentes/disponiveis' or _CASE_ROUTE.fullmatch(route) is not None or _JOB_ROUTE.fullmatch(route) is not None

    def dispatch(self, method, route, query, data=None, *, accepted=False):
        try:
            if route == '/api/agentes/disponiveis' and method == 'GET':
                return 200, self.available()
            match = _CASE_ROUTE.fullmatch(route)
            if match:
                if method == 'GET':
                    return 200, self.history(match[1])
                if method == 'POST':
                    if not accepted:
                        raise JobError(428, 'Aceite o aviso de envio ao provedor.')
                    return 200, self.start(match[1], data)
            match = _JOB_ROUTE.fullmatch(route)
            if match:
                identifier, operation = match.groups()
                if method == 'GET' and operation is None:
                    since = query.get('desde', ['0'])[-1]
                    return 200, self.poll(identifier, int(since))
                if method == 'POST':
                    if operation == 'aplicar':
                        return 200, self.apply(identifier, data)
                    if operation == 'descartar':
                        return 200, self.discard(identifier)
                    if operation == 'cancelar':
                        return 200, self.cancel_job(identifier)
            return 405, {'erro': 'Método não permitido.'}
        except JobError as exc:
            return exc.status, {'erro': str(exc)}
        except FileNotFoundError as exc:
            return 404, {'erro': str(exc)}
        except (ValueError, TypeError) as exc:
            return 400, {'erro': str(exc)}
        except OSError as exc:
            return 500, {'erro': f'Falha ao acessar tarefa: {exc}'}
        except subprocess.SubprocessError as exc:
            return 500, {'erro': f'Falha ao gerar cobertura: {exc}'}
