export interface CliOptions {
  source: 'simconnect' | 'simulated' | 'replay';
  dev: boolean;
  record: string | null;
  trace: string | null;
  speed: number;
  loop: boolean;
  protocol: 'SunRise' | 'KittyHawk' | 'FSX_SP2' | 'FSX_SP1';
  userData: string | null;
  compact: boolean;
  quit: boolean;
  smoke: boolean;
  screenshot: string | null;
}

/** Parses `--key=value` and `--key value` style arguments (anything else is ignored). */
export function parseCli(argv: string[]): CliOptions {
  const kv: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) kv[a.slice(2, eq)] = a.slice(eq + 1);
    else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--') && ['record', 'trace', 'source', 'speed', 'protocol', 'user-data', 'screenshot'].indexOf(a.slice(2)) >= 0) {
        kv[a.slice(2)] = next;
        i++;
      } else kv[a.slice(2)] = 'true';
    }
  }
  const src = kv.source;
  const proto = kv.protocol;
  const speed = Number(kv.speed);
  return {
    source: src === 'simulated' || src === 'replay' ? src : 'simconnect',
    dev: kv.dev === 'true' || src === 'simulated',
    record: kv.record && kv.record !== 'true' ? kv.record : null,
    trace: kv.trace && kv.trace !== 'true' ? kv.trace : null,
    speed: isFinite(speed) && speed > 0 ? speed : 1,
    loop: kv.loop === 'true',
    protocol: proto === 'KittyHawk' || proto === 'FSX_SP2' || proto === 'FSX_SP1' ? proto : 'SunRise',
    userData: kv['user-data'] ?? null,
    compact: kv.compact === 'true',
    quit: kv.quit === 'true',
    smoke: kv.smoke === 'true',
    screenshot: kv.screenshot && kv.screenshot !== 'true' ? kv.screenshot : null,
  };
}
