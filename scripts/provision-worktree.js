/**
 * Worktree Fast-Provisioning and Zero-Thrash Environment Manager
 * Safely provisions isolated node_modules and cascades environment configuration.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function provisionWorktree(targetDir, repoRoot) {
  const normTarget = path.resolve(targetDir);
  const normRoot = repoRoot ? path.resolve(repoRoot) : path.resolve(import.meta.dirname, '..');

  const pkgPath = path.join(normTarget, 'package.json');
  if (!fs.existsSync(pkgPath)) return { ok: true, skipped: true };

  // 1. Unlink toxic junction if present to protect PNPM monorepo package isolation
  const targetNm = path.join(normTarget, 'node_modules');
  if (fs.existsSync(targetNm)) {
    try {
      const stats = fs.lstatSync(targetNm);
      if (stats.isSymbolicLink()) {
        fs.unlinkSync(targetNm);
      }
    } catch {
      // Ignore
    }
  }

  // 2. Cascade .env* and config files
  const configs = ['.env', '.env.local', '.npmrc', '.herdr.json'];
  for (const cfg of configs) {
    const src = path.join(normRoot, cfg);
    const dst = path.join(normTarget, cfg);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      try {
        fs.copyFileSync(src, dst);
      } catch {
        // Non-fatal
      }
    }
  }

  // 3. Dynamic port collision avoidance
  const envLocal = path.join(normTarget, '.env.local');
  let hasPort = false;
  if (fs.existsSync(envLocal)) {
    hasPort = /PORT=/i.test(fs.readFileSync(envLocal, 'utf-8'));
  }
  if (!hasPort) {
    let hash = 0;
    for (let i = 0; i < normTarget.length; i++) {
      hash = ((hash << 5) - hash) + normTarget.charCodeAt(i);
      hash |= 0;
    }
    const port = 3000 + (Math.abs(hash) % 1000);
    try {
      fs.appendFileSync(envLocal, `\nPORT=${port}\nVITE_PORT=${port}\n`, 'utf-8');
    } catch {
      // Non-fatal
    }
  }

  // 4. Check if dependencies are already installed
  const binPath = path.join(targetNm, '.bin/electron-vite.cmd');
  if (!fs.existsSync(binPath)) {
    try {
      execSync('pnpm install --prefer-offline --frozen-lockfile=false', {
        cwd: normTarget,
        stdio: 'inherit',
      });
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  return { ok: true };
}

if (process.argv[1] && process.argv[1].endsWith('provision-worktree.js')) {
  const target = process.argv[2] || process.cwd();
  provisionWorktree(target);
}
