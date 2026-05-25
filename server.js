const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const REPLICATE_TOKEN = process.env.REPLICATE_TOKEN;

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function httpsRequest(method, hostname, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname, path: urlPath, method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers
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
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html); return;
  }

  if (req.method === 'POST' && req.url === '/generate-image') {
    try {
      const body = await readBody(req);
      const { prompt } = JSON.parse(body);

      const prediction = await httpsRequest('POST',
        'api.replicate.com',
        '/v1/models/black-forest-labs/flux-schnell/predictions',
        { 'Authorization': `Bearer ${REPLICATE_TOKEN}` },
        {
          input: {
            prompt,
            go_fast: true,
            num_outputs: 1,
            aspect_ratio: '3:4',
            output_format: 'webp',
            output_quality: 90,
            num_inference_steps: 4
          }
        }
      );

      console.log('Prediction:', prediction.id, prediction.status);
      if (prediction.error) throw new Error(prediction.error);

      if (prediction.output && prediction.output[0]) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ imageUrl: prediction.output[0] })); return;
      }

      const predId = prediction.id;
      let attempts = 0;
      while (attempts < 60) {
        await new Promise(r => setTimeout(r, 2500));
        const poll = await httpsRequest('GET',
          'api.replicate.com',
          `/v1/predictions/${predId}`,
          { 'Authorization': `Bearer ${REPLICATE_TOKEN}` },
          null
        );
        console.log('Poll:', poll.status);
        if (poll.status === 'succeeded' && poll.output && poll.output[0]) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ imageUrl: poll.output[0] })); return;
        }
        if (poll.status === 'failed') throw new Error('Failed: ' + (poll.error || 'unknown'));
        attempts++;
      }
      throw new Error('Timed out');

    } catch(err) {
      console.error('Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log('\n  ✦ MISSGUIDED BRAND AI SERVER RUNNING');
  console.log(`  → Open: http://localhost:${PORT}\n`);
});
