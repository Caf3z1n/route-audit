import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, format, exitCode } from './audit.js';

export default function routeAudit({config='route-audit.json',reportOnly=false}={}) {
  let root, base;
  return {
    name:'astro-route-audit',
    hooks:{
      'astro:config:done': ({config:astro}) => {
        root = fileURLToPath(astro.root);
        base = astro.base;
        if (astro.output === 'server') throw new Error('The build hook requires static output. Use --preview for SSR.');
      },
      'astro:build:done': async ({dir,logger}) => {
        const report = await audit({config:path.resolve(root,config),base,dist:fileURLToPath(dir)});
        logger.info(format(report));
        if (exitCode(report,reportOnly)) throw new Error('Route audit detected failures or inconclusive results.');
      }
    }
  };
}
