import { existsSync, rmSync, statSync } from 'fs';
import { detectCapabilitiesFile, generateProjectId } from '../../shared/paths';
import { loadSettings, getDatabasePath } from '../../shared/config';
import { CapaDatabase } from '../../db/database';

export async function cleanCommand(): Promise<void> {
  const projectPath = process.cwd();
  
  // Detect capabilities file
  const capabilitiesFile = detectCapabilitiesFile(projectPath);
  if (!capabilitiesFile) {
    console.error('✗ No capabilities file found.');
    process.exit(1);
  }
  
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
    db.close();
    return;
  }
  
  console.log('\n🧹 Cleaning managed files...');
  
  // Track directories that need to be removed
  const dirsToRemove = new Set<string>();
  
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
  
  db.close();
  console.log('\n✓ Cleanup complete!');
}
