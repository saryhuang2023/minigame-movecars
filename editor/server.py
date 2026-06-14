"""Custom HTTP server for the Pig Puzzle Level Editor.
Serves static files from the current directory on port 8080.
Exposes a /open-dir?path=<subdir> endpoint that opens the directory in Windows Explorer.
"""
import http.server
import os
import subprocess
import sys
import urllib.parse

PORT = 8080


class EditorHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        # /open-dir?path=levels → open the subdirectory in Explorer
        if parsed.path == '/open-dir':
            qs = urllib.parse.parse_qs(parsed.query)
            subdir = qs.get('path', ['.'])[0]
            # Normalize and resolve the path, prevent directory traversal
            subdir = os.path.normpath(subdir)
            abs_path = os.path.abspath(os.path.join(os.path.dirname(__file__), subdir))
            if not abs_path.startswith(os.path.abspath(os.path.dirname(__file__))):
                self.send_error(403, 'Forbidden')
                return
            if not os.path.isdir(abs_path):
                self.send_error(404, 'Directory not found')
                return
            try:
                subprocess.Popen(['explorer', abs_path], shell=False)
            except Exception:
                os.startfile(abs_path)
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'OK')
            return

        # Default: serve static files
        super().do_GET()

    def log_message(self, format, *args):
        # Quiet logging
        sys.stderr.write('[%s] %s\n' % (self.log_date_time_string(), format % args))


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f'Editor server running at http://localhost:{PORT}')
    http.server.HTTPServer(('127.0.0.1', PORT), EditorHandler).serve_forever()
