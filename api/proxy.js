export default async function handler(req, res) {
  let targetPath = '';
  if (req.url && req.url.startsWith('/api/proxy')) {
    targetPath = req.url.replace(/^\/api\/proxy\/?/, '');
  } else if (req.query.match) {
    const { match, ...restQuery } = req.query;
    const pathPart = Array.isArray(match) ? match.join('/') : (match || '');
    const qs = new URLSearchParams(restQuery).toString();
    targetPath = pathPart + (qs ? '?' + qs : '');
  }
  
  // Clean up targetPath if Vercel prepends query string logic incorrectly
  if (targetPath.startsWith('?match=')) {
    targetPath = targetPath.replace(/^\?match=([^&]+)&?(.*)/, '$1?$2');
  }

  const url = `https://tableros.ngrok.app/${targetPath}`;
  
  const headers = { ...req.headers };
  delete headers.host;
  
  try {
    let finalBody = undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      finalBody = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
    }
    
    const backendRes = await fetch(url, {
      method: req.method,
      headers: headers,
      body: finalBody
    });
    
    res.status(backendRes.status);
    
    for (const [key, value] of backendRes.headers.entries()) {
      if (key.toLowerCase() === 'www-authenticate') continue;
      if (key.toLowerCase() === 'set-cookie') continue;
      res.setHeader(key, value);
    }
    
    const buffer = await backendRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Internal proxy error' });
  }
}
