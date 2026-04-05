#!/bin/bash
cd "$(dirname "$0")"
python3 -c "
import http.server, os
os.chdir('$(dirname "$0")')
s = http.server.HTTPServer(('', 8080), http.server.SimpleHTTPRequestHandler)
print('Serving Movi at http://localhost:8080')
s.serve_forever()
"
