import { providers } from './registry';
import type { ProviderIntegration } from '../../types/providers';

/**
 * Get a provider by id. Returns undefined for unknown providers.
 */
export function getProvider(id: string): ProviderIntegration | undefined {
  return providers[id.toLowerCase()];
}

/**
 * Get all registered provider ids.
 */
export function getAllProviderIds(): string[] {
  return Object.keys(providers);
}

/**
 * Get all registered providers as an array.
 */
export function getAllProviders(): ProviderIntegration[] {
  return Object.values(providers);
}

/**
 * Get providers that have full MCP integration (not just skill paths).
 */
export function getIntegratedProviders(): ProviderIntegration[] {
  return Object.values(providers).filter((p) => p.mcp !== undefined);
}

export type { ProviderIntegration } from '../../types/providers';
export type {
  McpIntegration,
  InstructionsIntegration,
  RulesIntegration,
  SubagentsIntegration,
} from '../../types/providers';
