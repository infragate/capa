import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { assertCapaOwnedInstallPath } from '../../../shared/install-path-guard';

export function readMdFile(projectPath: string, filename: string): string {
  const filePath = join(projectPath, filename);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

export function writeMdFile(projectPath: string, filename: string, content: string): void {
  const target = join(projectPath, filename);
  assertCapaOwnedInstallPath(projectPath, target);
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(target, content, 'utf8');
}

export function deleteMdFile(projectPath: string, filename: string): void {
  const filePath = join(projectPath, filename);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
