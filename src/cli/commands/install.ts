import { existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { detectCapabilitiesFile, generateProjectId } from '../../shared/paths';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { ensureServer } from '../utils/server-manager';
import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import type { Skill } from '../../types/capabilities';
import { getAgentConfig, agents } from 'skills/src/agents';
import type { AgentType } from 'skills/src/types';

const CURRENT_VERSION = '1.0.0';

export async function installCommand(): Promise<void> {
  const projectPath = process.cwd();
  
  // Detect capabilities file
  const capabilitiesFile = detectCapabilitiesFile(projectPath);
  if (!capabilitiesFile) {
    console.error('✗ No capabilities file found. Run "capa init" first.');
    process.exit(1);
  }
  
  console.log(`Using ${capabilitiesFile.path}`);
  
  // Parse capabilities file
  const capabilities = await parseCapabilitiesFile(
    capabilitiesFile.path,
    capabilitiesFile.format
  );
  
  // Generate project ID
  const projectId = generateProjectId(projectPath);
  console.log(`Project ID: ${projectId}`);
  
  // Ensure server is running
  const serverStatus = await ensureServer(CURRENT_VERSION);
  
  if (!serverStatus.running || !serverStatus.url) {
    console.error('✗ Failed to start server');
    process.exit(1);
  }
  
  // Initialize database
  const settings = await loadSettings();
  const dbPath = getDatabasePath(settings);
  const db = new CapaDatabase(dbPath);
  
  // Register project
  db.upsertProject({ id: projectId, path: projectPath });
  
  // Step 1: Install skills (copy to client directories)
  console.log('\n📦 Installing skills...');
  await installSkills(projectPath, projectId, capabilities.skills, capabilities.clients, db);
  
  // Step 2: Submit capabilities to server
  console.log('\n🔧 Configuring tools...');
  const response = await fetch(`${serverStatus.url}/api/projects/${projectId}/configure`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(capabilities),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('✗ Failed to configure project:', error);
    db.close();
    process.exit(1);
  }
  
  const result = await response.json();
  
  db.close();
  
  // Step 3: Check if credential setup is needed
  if (result.needsCredentials && result.credentialsUrl) {
    console.log('\n🔑 Credentials required!');
    console.log(`Please open: ${result.credentialsUrl}`);
    console.log('After saving credentials, the installation will be complete.');
  } else {
    console.log('\n✓ Installation complete!');
  }
  
  // Step 4: Display MCP endpoint
  console.log(`\n📡 MCP Endpoint: ${serverStatus.url}/${projectId}/mcp`);
  console.log('\nAdd this endpoint to your MCP client configuration.');
}

async function installSkills(
  projectPath: string,
  projectId: string,
  skills: Skill[],
  clients: string[],
  db: CapaDatabase
): Promise<void> {
  for (const skill of skills) {
    console.log(`  Installing skill: ${skill.id}`);
    
    let skillContent: string;
    
    if (skill.type === 'inline') {
      // Inline skill - create JSON file
      skillContent = JSON.stringify(skill.def, null, 2);
    } else if (skill.type === 'remote' && skill.def.url) {
      // Remote skill - fetch content
      try {
        const response = await fetch(skill.def.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.statusText}`);
        }
        skillContent = await response.text();
      } catch (error) {
        console.error(`  ✗ Failed to fetch skill ${skill.id}:`, error);
        continue;
      }
    } else {
      console.error(`  ✗ Invalid skill definition: ${skill.id}`);
      continue;
    }
    
    // Install skill for each client
    for (const client of clients) {
      // Get the agent configuration from the skills package
      const agentConfig = getAgentConfig(client as AgentType);
      
      if (!agentConfig) {
        console.error(`  ✗ Unknown client: ${client}`);
        console.error(`\n  Supported clients:`);
        
        // Group agents by their display names for better readability
        const supportedAgents = Object.entries(agents)
          .map(([name, config]) => ({ name, displayName: config.displayName }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
        
        // Display in columns for better readability
        const maxDisplayNameLength = Math.max(...supportedAgents.map(a => a.displayName.length));
        for (const agent of supportedAgents) {
          console.error(`    - ${agent.displayName.padEnd(maxDisplayNameLength)} (${agent.name})`);
        }
        
        process.exit(1);
      }
      
      // Use the correct skills directory for this agent
      const clientDir = join(projectPath, agentConfig.skillsDir);
      const skillPath = join(clientDir, `${skill.id}.json`);
      
      // Check if file already exists
      if (existsSync(skillPath)) {
        // Check if it's managed by capa
        const managedFiles = db.getManagedFiles(projectId);
        if (!managedFiles.includes(skillPath)) {
          console.error(
            `  ✗ File already exists and is not managed by capa: ${skillPath}`
          );
          console.error('    Please delete it manually and run "capa install" again.');
          process.exit(1);
        }
      }
      
      // Create directory if needed
      if (!existsSync(clientDir)) {
        mkdirSync(clientDir, { recursive: true });
      }
      
      // Write skill file
      await Bun.write(skillPath, skillContent);
      
      // Track as managed file
      db.addManagedFile(projectId, skillPath);
      
      console.log(`    ✓ Installed to ${skillPath}`);
    }
  }
}
