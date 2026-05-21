import { spawnSync } from 'node:child_process';
const r = spawnSync('git', ['commit', '-F', '.commit-msg.tmp'], { stdio: 'inherit', shell: false });
process.exit(r.status ?? 1);
