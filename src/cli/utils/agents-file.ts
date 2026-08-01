/**
 * Thin shim — the implementation has moved to `./agents-file/` package.
 * This file re-exports the public API so existing imports keep working.
 */
export {
  upsertSnippet,
  removeSnippet,
  removeAllCapaSnippets,
  listCapaSnippetIds,
  fetchRemoteContent,
  detectRepoCoordsFromRawUrl,
  getTargetFilenames,
  installAgentsFile,
  cleanAgentsFile,
  installSubAgentInstructions,
  removeSubAgentInstructions,
  type RepoFetchContext,
} from './agents-file/index';
