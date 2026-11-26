import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { audit, exitCode, format } from '../src/audit.js';

export async function runDemo() {
  const dist = await mkdtemp(path.join(tmpdir(), 'route-audit-demo-'));
  try {
    const config = path.join(dist, 'route-audit.json');
    const guide = path.join(dist, 'guide.html');
    await writeFile(
      config,
      JSON.stringify({ site: 'https://example.org', routes: ['/', '/guide'] }),
    );
    await writeFile(path.join(dist, 'index.html'), '<title>Home</title>');
    await writeFile(guide, '<title>Guide</title>');

    console.log('Before removing guide.html');
    const before = await audit({ config, dist });
    console.log(format(before));
    const initialExit = exitCode(before);
    if (initialExit) return initialExit;

    await rm(guide);
    console.log('\nAfter removing guide.html');
    const after = await audit({ config, dist });
    console.log(format(after));
    return exitCode(after);
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
}
