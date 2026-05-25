const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;
const REPLICATE_TOKEN = 'r8_OVcJvDoCUQtn7C9d0TcFST72Okw41gY1dDK99';
const ANTHROPIC_KEY_PLACEHOLDER = 'YOUR_ANTHROPIC_KEY'; // not needed — app uses Anthropic API directly

// ── CORS HEADERS ──
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── PROXY HELPER ──
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname, path, method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ error: data }); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function httpsGet(hostname, pathStr, headers) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path: pathStr, method: 'GET', headers };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ error: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── SERVER ──
const server = http.createServer(async (req, res) => {
  setCORS(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  const parsedUrl = url.parse(req.url, true);

  // ── Serve the HTML app ──
  if (req.method === 'GET' && parsedUrl.pathname === '/') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html); return;
  }

  // ── POST /generate-image ──
  if (req.method === 'POST' && parsedUrl.pathname === '/generate-image') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { prompt } = JSON.parse(body);

        // Start Replicate prediction
        const prediction = await httpsPost(
          'api.replicate.com',
          '/v1/models/black-forest-labs/flux-schnell/predictions',
          { 'Authorization': `Bearer ${REPLICATE_TOKEN}` },
          {
            input: {
              prompt,
              go_fast: true,
              num_outputs: 1,
              aspect_ratio: "3:4",
              output_format: "webp",
              output_quality: 90,
              num_inference_steps: 4
            }
          }
        );

        console.log('Prediction started:', prediction.id, prediction.status);
        if (prediction.error) throw new Error(prediction.error);

        // If already done
        if (prediction.output && prediction.output[0]) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ imageUrl: prediction.output[0] }));
          return;
        }

        // Poll
        const predId = prediction.id;
        let attempts = 0;
        while (attempts < 60) {
          await new Promise(r => setTimeout(r, 2500));
          const poll = await httpsGet(
            'api.replicate.com',
            `/v1/predictions/${predId}`,
            { 'Authorization': `Bearer ${REPLICATE_TOKEN}` }
          );
          console.log('Poll:', poll.status);
          if (poll.status === 'succeeded' && poll.output && poll.output[0]) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ imageUrl: poll.output[0] }));
            return;
          }
          if (poll.status === 'failed') throw new Error('Generation failed: ' + (poll.error||'unknown'));
          attempts++;
        }
        throw new Error('Timed out');

      } catch(err) {
        console.error('Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ✦ MISSGUIDED BRAND AI SERVER RUNNING');
  console.log(`  → Open: http://localhost:${PORT}`);
  console.log('');
});
