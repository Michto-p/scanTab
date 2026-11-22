// Une adresse connue est contactée uniquement après une action de l'utilisateur.
export function localPCURL(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Indiquez une adresse complète, par exemple https://192.168.1.20:8787.'); }
  const host = url.hostname.toLowerCase();
  const parts = host.split('.').map(Number);
  const privateIPv4 = parts.length === 4 && parts.every(p => Number.isInteger(p) && p >= 0 && p <= 255) &&
    (parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 169 && parts[1] === 254));
  const privateIPv6 = /^\[(::1|f[cd][0-9a-f]{2}:[0-9a-f:]+|fe[89ab][0-9a-f]:[0-9a-f:]+)\]$/i.test(host);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname) ||
    !(host === 'localhost' || host.endsWith('.local') || privateIPv4 || privateIPv6)) {
    throw Error('Utilisez une adresse du PC sur le réseau local, sans identifiants ni chemin. Aucun serveur Internet n’est accepté.');
  }
  return url.origin;
}

export function createPCClient(address, token, { fetcher = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const base = localPCURL(address);
  const host = new URL(base).hostname;
  const addressSpace = host==='localhost'||host==='[::1]'||host.startsWith('127.')?'loopback':'local';
  if (typeof token !== 'string' || token.trim().length < 16 || /[\r\n]/.test(token)) throw Error('Recopiez le code d’appairage affiché sur le PC.');
  async function request(path, { method = 'GET', body, type, timeout = timeoutMs } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetcher(base + path, {
        method, body, headers: { Authorization: 'Bearer ' + token.trim(), ...(type ? { 'Content-Type': type } : {}) },
        signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', mode: 'cors', targetAddressSpace: addressSpace
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Le PC a refusé cette opération.');
      if (path === '/api/status' && (result.application !== 'scan-tableau-pc' || result.apiVersion !== 1)) throw Error('Ce serveur n’est pas compatible avec Scan Tableau.');
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw Error('Le PC ne répond pas. Vérifiez son adresse et le même réseau Wi-Fi. La collecte reste sur le téléphone.');
      if (error instanceof TypeError) throw Error('Connexion au PC impossible. Vérifiez le réseau local, son autorisation dans le navigateur et le certificat HTTPS. La collecte reste disponible.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  return {
    address: base,
    status: () => request('/api/status'),
    sendBatch: blob => request('/api/batches', { method: 'POST', body: blob, type: 'application/zip', timeout:Math.max(timeoutMs,120000) }),
    prepareDataset: () => request('/api/dataset/prepare', { method: 'POST' }),
    analyze: blob => request('/api/analyze',{method:'POST',body:blob,type:'image/png',timeout:120000}),
    train: () => request('/api/train',{method:'POST'}),
    job: id => {if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Travail PC invalide.');return request('/api/jobs/'+id);}
  };
}
