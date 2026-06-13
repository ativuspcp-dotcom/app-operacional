export default async function handler(req, res) {
  const { match, ...restQuery } = req.query;
  const path = Array.isArray(match) ? match.join('/') : (match || '');
  
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(restQuery)) {
    // Vercel query parsing might give an array if multiple params with same name exist
    if (Array.isArray(value)) {
      value.forEach(v => searchParams.append(key, v));
    } else {
      searchParams.append(key, value);
    }
  }
  const qs = searchParams.toString();
  const url = `https://tableros.ngrok.app/${path}${qs ? '?' + qs : ''}`;
  
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
