/**
 * Discovers the location of a skill in a GitHub repository by trying common paths.
 * Returns the raw GitHub URL to SKILL.md if found, or null if not found.
 */
export async function discoverGitHubSkillPath(
  repoPath: string,
  skillName: string,
  branch: string = 'main'
): Promise<string | null> {
  // Common directory names where skills might be located
  const commonSkillDirs = [
    'skills',
    'awesome_agent_skills',
    'agent_skills',
    'agent-skills',
    '.cursor/skills',
    '.claude/skills',
    'src/skills',
  ];

  // Try each common directory
  for (const dir of commonSkillDirs) {
    const url = `https://raw.githubusercontent.com/${repoPath}/${branch}/${dir}/${skillName}/SKILL.md`;
    try {
      const response = await fetch(url);
      if (response.ok) {
        return url;
      }
    } catch {
      // Continue to next path
    }
  }

  // If none of the common paths work, try to discover by fetching repo structure
  try {
    const apiUrl = `https://api.github.com/repos/${repoPath}/contents`;
    const response = await fetch(apiUrl);
    if (response.ok) {
      const contents = await response.json() as Array<{ name: string; type: string }>;
      
      // Look for directories that might contain skills
      for (const item of contents) {
        if (item.type === 'dir') {
          const testUrl = `https://raw.githubusercontent.com/${repoPath}/${branch}/${item.name}/${skillName}/SKILL.md`;
          try {
            const testResponse = await fetch(testUrl);
            if (testResponse.ok) {
              return testUrl;
            }
          } catch {
            // Continue checking
          }
        }
      }
    }
  } catch {
    // API discovery failed, continue
  }

  return null;
}
