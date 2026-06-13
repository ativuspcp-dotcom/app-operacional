export default async function handler(req, res) {
  // Extract path and query string from req.url to preserve everything perfectly
  const targetPath = req.url.replace(/^\/api\//, '');
  const url = `https://tableros.ngrok.app/${targetPath}`;
  
  // Prepare headers to send to the backend
  const headers = { ...req.headers };
  delete headers.host; // Remove host so fetch sets it correctly
  
  try {
    const backendRes = await fetch(url, {
      method: req.method,
      headers: headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined
    });
    
    // Copy the status code from the backend
    res.status(backendRes.status);
    
    // Copy headers back to the frontend, BUT explicitly block the toxic headers
    for (const [key, value] of backendRes.headers.entries()) {
      if (key.toLowerCase() === 'www-authenticate') continue; // Blocks native login prompt
      if (key.toLowerCase() === 'set-cookie') continue;       // Blocks saving SAP cookies in browser
      res.setHeader(key, value);
    }
    
    // Read the body and send it back
    const buffer = await backendRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Internal proxy error' });
  }
}
