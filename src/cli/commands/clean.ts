import { existsSync, rmSync, statSync } from 'fs';
import { detectCapabilitiesFile, generateProjectId } from '../../shared/paths';
import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { unregisterMCPServer } from '../utils/mcp-client-manager';

export async function cleanCommand(): Promise<void> {
  const projectPath = process.cwd();
  
  // Detect capabilities file
  const capabilitiesFile = await detectCapabilitiesFile(projectPath);
  if (!capabilitiesFile) {
    console.error('✗ No capabilities file found.');
    process.exit(1);
  }
  
  // Parse capabilities file to get providers list
  const capabilities = await parseCapabilitiesFile(
    capabilitiesFile.path,
    capabilitiesFile.format
  );
  
  // Generate project ID
  const projectId = generateProjectId(projectPath);
  console.log(`Project ID: ${projectId}`);
  
  // Initialize database
  const settings = await loadSettings();
  const dbPath = getDatabasePath(settings);
  const db = new CapaDatabase(dbPath);
  
  // Get managed files
  const managedFiles = db.getManagedFiles(projectId);
  
  if (managedFiles.length === 0) {
    console.log('No files to clean.');
  } else {
    console.log('\n🧹 Cleaning managed files...');
    
    for (const filePath of managedFiles) {
      if (existsSync(filePath)) {
        try {
          const stats = statSync(filePath);
          
          if (stats.isDirectory()) {
            // Remove entire directory
            rmSync(filePath, { recursive: true, force: true });
            console.log(`  ✓ Removed directory ${filePath}`);
          } else {
            // Remove single file
            rmSync(filePath);
            console.log(`  ✓ Removed ${filePath}`);
          }
        } catch (error) {
          console.error(`  ✗ Failed to remove ${filePath}:`, error);
        }
      } else {
        console.log(`  - Already removed: ${filePath}`);
      }
      
      db.removeManagedFile(projectId, filePath);
    }
  }
  
  // Unregister MCP server from client configurations
  console.log('\n🔗 Unregistering MCP server from clients...');
  await unregisterMCPServer(projectPath, projectId, capabilities.providers);

  // Delete all project data from the database
  console.log('\n🗑️  Removing project data...');
  db.deleteProject(projectId);
  console.log('  ✓ Removed project configuration and metadata');

  db.close();
  console.log('\n✓ Cleanup complete!');
}
