import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { CockpitState } from '../core/cockpit';
import { usesManualBallast } from '../core/weight';
import { COCKPIT_PORT } from '../core/cockpit';

const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

/**
 * Local page the in-sim panel loads. Bound to 127.0.0.1 only.
 * The desktop app publishes the live profile and sim sample. Only legacy
 * profiles permit manual ballast changes from the panel.
 */
export function startPanelServer(opts: {
  root: string;
  version: string;
  getState: () => CockpitState | null;
  onBallast: (profileId:string,f:number)=>void|boolean|Promise<void|boolean>;
}): Promise<Server> {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/version') {
      json(res, 200, { app: 'Flap Happy', version: opts.version });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      json(res, 200, opts.getState() ?? { ready: false, profile: null, sample: null, receivedAt: 0, ballast: 0, units: 'kt', zoom: 1 });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/ballast') {
      const initial = opts.getState();
      if (!initial?.ready || !initial.profile || !usesManualBallast(initial.profile)) {
        req.resume();
        json(res, 405, { ok: false });
        return;
      }
      let body: { profileId?: unknown; f?: unknown } | null = null;
      try {
        body = JSON.parse(await readBody(req));
      } catch { /* malformed or oversized input */ }
      if (!body || typeof body.profileId !== 'string' || typeof body.f !== 'number' || !isFinite(body.f)) {
        json(res, 400, { ok: false });
        return;
      }
      const current = opts.getState();
      if (!current?.ready || !current.profile || current.profile.id !== body.profileId ||
          current.profile.id !== initial.profile.id || !usesManualBallast(current.profile)) {
        json(res, 409, { ok: false });
        return;
      }
      try { const applied=await opts.onBallast(body.profileId,Math.max(0,Math.min(1,body.f)));json(res,applied===false?409:200,{ok:applied!==false}); } catch { json(res,500,{ok:false}); }
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end();
      return;
    }
    const rel = normalize(url.pathname === '/' ? '/panel.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
    try {
      const data = await readFile(join(opts.root, rel));
      res.writeHead(200, { 'Content-Type': types[extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(COCKPIT_PORT, '127.0.0.1', () => resolve(server));
  });
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(text);
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size <= 4096) chunks.push(c); });
    req.on('end', () => size <= 4096 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error('Body too large')));
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Body aborted')));
  });
}
