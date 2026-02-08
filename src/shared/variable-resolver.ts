import type { CapaDatabase } from '../db/database';

/**
 * Resolve variable expressions in a string.
 * Variables are in the format ${VarName}
 * Values are retrieved from the database for the given project.
 */
export function resolveVariables(
  input: string,
  projectId: string,
  db: CapaDatabase
): string {
  const variablePattern = /\$\{([^}]+)\}/g;
  
  return input.replace(variablePattern, (match, varName) => {
    const value = db.getVariable(projectId, varName);
    if (value === null) {
      // Variable not found - return the original placeholder
      return match;
    }
    return value;
  });
}

/**
 * Extract all variable names from a string
 */
export function extractVariables(input: string): string[] {
  const variablePattern = /\$\{([^}]+)\}/g;
  const variables: string[] = [];
  let match;
  
  while ((match = variablePattern.exec(input)) !== null) {
    variables.push(match[1]);
  }
  
  return variables;
}

/**
 * Recursively resolve variables in an object
 */
export function resolveVariablesInObject(
  obj: any,
  projectId: string,
  db: CapaDatabase
): any {
  if (typeof obj === 'string') {
    return resolveVariables(obj, projectId, db);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => resolveVariablesInObject(item, projectId, db));
  }
  
  if (obj !== null && typeof obj === 'object') {
    const resolved: any = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveVariablesInObject(value, projectId, db);
    }
    return resolved;
  }
  
  return obj;
}

/**
 * Check if a string or object contains unresolved variables
 */
export function hasUnresolvedVariables(input: any): boolean {
  if (typeof input === 'string') {
    return /\$\{[^}]+\}/.test(input);
  }
  
  if (Array.isArray(input)) {
    return input.some(hasUnresolvedVariables);
  }
  
  if (input !== null && typeof input === 'object') {
    return Object.values(input).some(hasUnresolvedVariables);
  }
  
  return false;
}

/**
 * Extract all unresolved variables from an object
 */
export function extractAllVariables(obj: any): string[] {
  const variables = new Set<string>();
  
  function extract(value: any) {
    if (typeof value === 'string') {
      extractVariables(value).forEach(v => variables.add(v));
    } else if (Array.isArray(value)) {
      value.forEach(extract);
    } else if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(extract);
    }
  }
  
  extract(obj);
  return Array.from(variables);
}
