"""Servidor HTTP da bancada, restrito ao loopback e à sessão local."""
from __future__ import annotations

import json
import mimetypes
import os
import re
import secrets
import sys
import webbrowser
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import RLock
from urllib.parse import parse_qs, unquote, urlsplit

from .. import case as cases
from .api import TimelineCache, dispatch
from .jobs import JobManager
from .writes import (audit, case_lock, confined, get_case, read_target,
                     route_lock, version, write_json, write_route)

STATIC_DIR = Path(__file__).with_name('static')
CSP = ("default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
       "font-src 'self'; connect-src 'self'; frame-ancestors 'none'")
MIME = {'.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2',
        '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json'}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Não registrar URLs ou parâmetros que possam conter dados do caso.
        pass

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', CSP)
        super().end_headers()

    def _respond(self, status, body, content_type='application/json; charset=utf-8', *, file_version=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        drop_connection = status >= 400 and not self._drain_unread_body()
        self.send_response(status)
        if drop_connection:
            # Corpo não consumido: fechar evita que o cliente leia lixo e explicita o fim da conexão.
            self.close_connection = True
            self.send_header('Connection', 'close')
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        if file_version is not None:
            self.send_header('X-Perito-Versao', file_version)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _drain_unread_body(self, limit=1024**2):
        """Consome o corpo ainda não lido de uma requisição rejeitada.

        No Windows, responder e fechar o socket com dados pendentes no buffer de recepção
        gera RST, e o cliente vê ConnectionAborted/Reset em vez do 4xx. Devolve True se não
        há corpo pendente (ou se ele foi descartado) e False se a conexão precisa ser fechada.
        """
        if getattr(self, '_body_consumed', True) or self.command in ('GET', 'HEAD'):
            return True
        self._body_consumed = True
        lengths = self.headers.get_all('Content-Length', []) if self.headers else []
        if self.headers and self.headers.get_all('Transfer-Encoding', []):
            return False
        if len(lengths) != 1 or not re.fullmatch(r'[0-9]+', lengths[0]):
            return not lengths
        remaining = int(lengths[0])
        if remaining > limit:
            return False
        try:
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 64 * 1024))
                if not chunk:
                    return False
                remaining -= len(chunk)
        except OSError:
            return False
        return True

    def send_error(self, code, message=None, explain=None):
        self._respond(code, {'erro': 'Requisição HTTP inválida.', 'detalhe': message or str(code)})

    def __getattr__(self, name):
        # BaseHTTPRequestHandler também encaminha métodos desconhecidos aqui.
        if name.startswith('do_'):
            return self._handle
        raise AttributeError(name)

    def do_GET(self):
        self._handle()

    def _handle(self):
        self._body_consumed = False
        hosts = self.headers.get_all('Host', [])
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        if len(hosts) != 1 or hosts[0] not in allowed:
            self._respond(403, {'erro': 'Host inválido.'})
            return
        try:
            url = urlsplit(self.path)
            path = unquote(url.path)
            is_api = path == '/api' or path.startswith('/api/')
            if is_api:
                tokens = self.headers.get_all('X-Perito-Token', [])
                if len(tokens) != 1 or not secrets.compare_digest(tokens[0].encode('utf-8'), self.server.token.encode('utf-8')):
                    self._respond(403, {'erro': 'token inválido'})
                    return
                if self.server.jobs.handles(path):
                    data = None
                    if self.command == 'POST':
                        # O aceite é verificado antes de ler/iniciar qualquer tarefa.
                        if path.startswith('/api/casos/') and self.headers.get_all('X-Perito-Aviso-Envio', []) != ['aceito']:
                            self._respond(428, {'erro': 'Aceite o aviso de envio ao provedor.'})
                            return
                        length = self._body_length('application/json', 1024**2)
                        if length is None:
                            return
                        self._body_consumed = True
                        payload = self.rfile.read(length)
                        if len(payload) != length:
                            raise ValueError('Corpo incompleto.')
                        data = json.loads(payload)
                    status, body = self.server.jobs.dispatch(
                        self.command, path, parse_qs(url.query), data,
                        accepted=self.headers.get_all('X-Perito-Aviso-Envio', []) == ['aceito'])
                    self._respond(status, body)
                    return
                if self.command == 'GET':
                    # Mantém conteúdo e versão no mesmo snapshot das escritas da UI.
                    with route_lock(self.server.case_base, path):
                        with self.server.api_lock:
                            status, body = dispatch(self.server.case_base, url.path, parse_qs(url.query), cache=self.server.cache)
                        target = read_target(self.server.case_base, path) if status == 200 else None
                        file_version = version(target) if target is not None else None
                        self._respond(status, body, file_version=file_version)
                    return
                match = write_route(self.command, path)
                if match is None:
                    self._respond(405, {'erro': 'Método não permitido.'})
                    return
                case = get_case(self.server.case_base, match[0])
                endpoint = match[1]
                if endpoint == 'ingestao':
                    self._upload(case)
                    return
                length = self._body_length('application/json', 1024**2)
                if length is None:
                    return
                self._body_consumed = True
                payload = self.rfile.read(length)
                if len(payload) != length:
                    raise ValueError('Corpo incompleto.')
                data = json.loads(payload)
                with case_lock(case):
                    status, body = write_json(case, endpoint, self.command, data, self.server.cache)
                self._respond(status, body)
                return
            if self.command != 'GET':
                self._respond(405, {'erro': 'Método não permitido.'})
                return
            self._static(path)
        except (ValueError, OSError) as exc:
            self._respond(404 if isinstance(exc, FileNotFoundError) else 400 if isinstance(exc, ValueError) else 500,
                          {'erro': 'Erro ao atender a requisição.', 'detalhe': str(exc)})

    def _body_length(self, content_type, maximum):
        types = self.headers.get_all('Content-Type', [])
        if len(types) != 1 or types[0].split(';', 1)[0].strip().lower() != content_type:
            self._respond(415, {'erro': 'Content-Type inválido.'})
            return None
        lengths = self.headers.get_all('Content-Length', [])
        if self.headers.get_all('Transfer-Encoding', []) or len(lengths) > 1:
            raise ValueError('Enquadramento HTTP inválido.')
        if not lengths:
            self._respond(411, {'erro': 'Content-Length obrigatório.'})
            return None
        if not re.fullmatch(r'[0-9]+', lengths[0]):
            raise ValueError('Content-Length inválido.')
        length = int(lengths[0])
        if length > maximum:
            self._respond(413, {'erro': 'Corpo excede o limite.'})
            return None
        return length

    def _upload(self, case):
        from ..cli import ingest_file
        from ..parsers import PARSERS
        length = self._body_length('application/octet-stream', 500 * 1024**2)
        if length is None:
            return
        filenames = self.headers.get_all('X-Perito-Arquivo', [])
        name = unquote(filenames[0]) if len(filenames) == 1 else ''
        if not re.fullmatch(r'[A-Za-z0-9._ -]{1,128}', name) or '..' in name or not name.strip(' .'):
            raise ValueError('Nome de arquivo inválido.')
        source = self.headers.get('X-Perito-Fonte', 'auto')
        if source != 'auto' and source not in PARSERS:
            raise ValueError('Fonte desconhecida.')
        observation = self.headers.get('X-Perito-Obs', '')
        with case_lock(case):
            # Nem links dentro do caso podem redirecionar derivados às brutas.
            for relative in ('evidencias/brutas', 'custodia.csv', 'normalizado', 'timeline', '.uploads', 'auditoria-ui.log'):
                confined(case, relative)
            directory = confined(case, '.uploads')
            directory.mkdir(exist_ok=True)
            temporary = directory / f'{uuid.uuid4().hex}__{name}'
            before = version(case.custody_file)
            try:
                with temporary.open('xb') as fh:
                    self._body_consumed = True
                    remaining = length
                    while remaining:
                        chunk = self.rfile.read(min(remaining, 1024**2))
                        if not chunk:
                            raise ValueError('Upload incompleto.')
                        fh.write(chunk)
                        remaining -= len(chunk)
                result = ingest_file(case, temporary, source, observation)
                result['versao'] = version(case.custody_file)
                audit(case, 'POST ingestao', result['arquivo'],
                      f"{result['fonte']}: {result['eventos']} eventos", before, result['versao'])
            finally:
                temporary.unlink(missing_ok=True)
        self._respond(200, result)

    def _static(self, path):
        root = self.server.static_dir.resolve()
        target = (root / path.lstrip('/')).resolve()
        if not target.is_relative_to(root):
            self._respond(403, {'erro': 'Caminho fora do diretório estático.'})
            return
        if not Path(path).suffix:
            target = (root / 'index.html').resolve()
        if not target.is_relative_to(root):
            self._respond(403, {'erro': 'Caminho fora do diretório estático.'})
            return
        if target == root / 'index.html':
            if not target.is_file():
                self._respond(200, 'Frontend não construído. Rode: cd ui && npm install && npm run build'.encode('utf-8'), 'text/plain; charset=utf-8')
                return
            content = target.read_text(encoding='utf-8').replace('__PERITO_TOKEN__', self.server.token)
            self._respond(200, content.encode('utf-8'), 'text/html; charset=utf-8')
            return
        if not target.is_file():
            self._respond(404, {'erro': 'Arquivo estático não encontrado.'})
            return
        mime = MIME.get(target.suffix.lower()) or mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        self._respond(200, target.read_bytes(), mime)


def create_server(case_base: Path = cases.CASES_DIR, *, port: int = 8765,
                  token: str | None = None, static_dir: Path = STATIC_DIR):
    """Cria o servidor sem iniciá-lo; porta zero é útil nos testes locais."""
    if not 0 <= port <= 65535:
        raise ValueError('A porta deve estar entre 0 e 65535.')
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.case_base = Path(case_base)
    server.static_dir = Path(static_dir)
    server.token = token if token is not None else os.environ.get('PERITO_UI_TOKEN') or secrets.token_urlsafe(24)
    server.cache = TimelineCache()
    server.api_lock = RLock()
    server.jobs = JobManager(server.case_base)
    return server


def run(*, case_base: Path, port: int = 8765, case_id: str | None = None,
        open_browser: bool = True, token: str | None = None) -> int:
    if case_id is not None:
        cases.get_case(case_id, case_base)
    try:
        server = create_server(case_base, port=port, token=token)
    except OSError as exc:
        print(f'Erro ao abrir a porta {port}: {exc}. Tente outra com --porta.', file=sys.stderr)
        return 1
    url = f'http://127.0.0.1:{server.server_port}/' + (f'#/caso/{case_id}' if case_id else '')
    print(f'PERITO UI em {url}')
    if token is not None or os.environ.get('PERITO_UI_TOKEN'):
        print('token de desenvolvimento ativo')
    try:
        if open_browser:
            webbrowser.open(url)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.jobs.close()
        server.server_close()
    return 0
