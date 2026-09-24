#!/usr/bin/env node
// Runs a Python script with the project venv (ml/.venv), falling back to the
// Windows `py -3` launcher or python3. Keeps npm scripts independent of PATH
// (on Windows `python` is often the Microsoft Store alias).
//   node scripts/py.js ml/generate_synthetic.py --seed 1
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function findPython() {
  const venv = process.platform === 'win32'
    ? path.join(ROOT, 'ml', '.venv', 'Scripts', 'python.exe')
    : path.join(ROOT, 'ml', '.venv', 'bin', 'python');
  if (fs.existsSync(venv)) return { cmd: venv, pre: [] };
  if (process.platform === 'win32') return { cmd: 'py', pre: ['-3'] };
  return { cmd: 'python3', pre: [] };
}

function runPython(args, opts = {}) {
  const { cmd, pre } = findPython();
  const res = spawnSync(cmd, [...pre, ...args], { cwd: ROOT, stdio: 'inherit', ...opts });
  if (res.error) {
    throw new Error(`Could not start Python (${cmd}): ${res.error.message}. ` +
      'Create the venv: py -3.11 -m venv ml/.venv && ml\\.venv\\Scripts\\python -m pip install -r ml/requirements.txt');
  }
  return res.status;
}

if (require.main === module) {
  process.exit(runPython(process.argv.slice(2)));
}

module.exports = { runPython, findPython };
