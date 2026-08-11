#!/usr/bin/env python3
"""Static dev server that disables HTTP caching, so code changes always load.

Dotfiles (.env.local, .git/, ...) are refused — SimpleHTTPRequestHandler
would otherwise happily serve secrets from the project root.
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

    def send_head(self):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        if any(part.startswith('.') for part in path.split('/') if part):
            self.send_error(404, 'Not found')
            return None
        return super().send_head()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    http.server.ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
