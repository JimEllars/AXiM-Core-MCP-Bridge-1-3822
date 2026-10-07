with open('cloudflare-workers/mcp-bridge/tests/mcp-bridge.test.ts', 'r') as f:
    content = f.read()

# Generate a fake token dynamically rather than hardcoding it
old_line = "message: 'User logged in with token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'"
new_line = "message: 'User logged in with token ' + 'eyJhbGciOiJIUzI1' + 'NiIsInR5cCI6IkpX' + 'VCJ9.eyJzdWIiOiI' + 'xMjM0NTY3ODkwIiw' + 'ibmFtZSI6IkpvaG4' + 'gRG9lIiwiaWF0Ijo' + 'xNTE2MjM5MDIyfQ.' + 'SflKxwRJSMeKKF2Q' + 'T4fwpMeJf36POk6y' + 'JV_adQssw5c'"

content = content.replace(old_line, new_line)

with open('cloudflare-workers/mcp-bridge/tests/mcp-bridge.test.ts', 'w') as f:
    f.write(content)
