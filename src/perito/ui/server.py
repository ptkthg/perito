"""Servidor HTTP de leitura, restrito ao loopback e à sessão local."""
from __future__ import annotations

import json
import mimetypes
import os
import secrets
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import RLock
from urllib.parse import parse_qs, unquote, urlsplit

from .. import case as cases
from .api import TimelineCache, dispatch

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

    def _respond(self, status, body, content_type='application/json; charset=utf-8'):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

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
                if self.command != 'GET':
                    self._respond(405, {'erro': 'Método não permitido.'})
                    return
                # O dispatcher faz a decodificação da rota uma única vez.
                with self.server.api_lock:
                    status, body = dispatch(self.server.case_base, url.path, parse_qs(url.query), cache=self.server.cache)
                self._respond(status, body)
                return
            if self.command != 'GET':
                self._respond(405, {'erro': 'Método não permitido.'})
                return
            self._static(path)
        except (ValueError, OSError) as exc:
            self._respond(400 if isinstance(exc, ValueError) else 500,
                          {'erro': 'Erro ao atender a requisição.', 'detalhe': str(exc)})

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
        server.server_close()
    return 0
