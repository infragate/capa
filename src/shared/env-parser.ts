import { readFileSync } from 'fs';

/**
 * Parse a .env file and return key-value pairs
 * Supports:
 * - Basic KEY=VALUE syntax
 * - Comments (lines starting with #)
 * - Empty lines
 * - Single and double quoted values
 * - Variable expansion ${VAR} (not resolved, just kept as-is)
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, 'utf-8');
  const variables: Record<string, string> = {};
  
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    // Skip empty lines and comments
    if (!line || line.startsWith('#')) {
      continue;
    }
    
    // Find the first = sign
    const equalIndex = line.indexOf('=');
    if (equalIndex === -1) {
      continue; // Invalid line, skip
    }
    
    const key = line.substring(0, equalIndex).trim();
    let value = line.substring(equalIndex + 1).trim();
    
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.substring(1, value.length - 1);
    }
    
    variables[key] = value;
  }
  
  return variables;
}
