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

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        # /save-level?name=level_0001.json → save JSON body to levels/<name>
        if parsed.path == '/save-level':
            qs = urllib.parse.parse_qs(parsed.query)
            name = qs.get('name', [None])[0]
            if not name:
                self.send_error(400, 'Missing name parameter')
                return
            # Sanitize filename
            name = os.path.basename(name)
            levels_dir = os.path.join(os.path.dirname(__file__), 'levels')
            os.makedirs(levels_dir, exist_ok=True)
            filepath = os.path.join(levels_dir, name)

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            try:
                with open(filepath, 'wb') as f:
                    f.write(body)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            except Exception as e:
                self.send_error(500, str(e))
            return

        self.send_error(404, 'Not found')

    def log_message(self, format, *args):
        # Quiet logging
        sys.stderr.write('[%s] %s\n' % (self.log_date_time_string(), format % args))


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f'Editor server running at http://localhost:{PORT}')
    http.server.HTTPServer(('0.0.0.0', PORT), EditorHandler).serve_forever()
