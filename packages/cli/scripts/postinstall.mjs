// Ensures the npm global bin directory is on the user's PATH (Windows only).
// Runs automatically after `npm install -g @synapse-ai/cli`.

import { execSync } from 'child_process';
import { platform, env } from 'process';

if (platform !== 'win32') process.exit(0);

const npmBin = `${env.APPDATA}\\npm`;

// Check if already on PATH
const currentPath = env.PATH || '';
if (currentPath.toLowerCase().includes(npmBin.toLowerCase())) {
  process.exit(0);
}

// Read the persisted user PATH from registry (not the session PATH)
try {
  const regOutput = execSync('reg query "HKCU\\Environment" /v PATH', { encoding: 'utf8' });
  const match = regOutput.match(/PATH\s+REG_\w+\s+(.*)/i);
  const userPath = match ? match[1].trim() : '';

  if (userPath.toLowerCase().includes(npmBin.toLowerCase())) {
    process.exit(0);
  }

  const newPath = userPath ? `${userPath};${npmBin}` : npmBin;
  execSync(`setx PATH "${newPath}"`, { stdio: 'ignore' });
  console.log(`\n  [synapse] Added "${npmBin}" to your PATH.`);
  console.log(`  [synapse] Open a new terminal for "synapse" command to work.\n`);
} catch {
  // No user PATH set yet
  try {
    execSync(`setx PATH "${npmBin}"`, { stdio: 'ignore' });
    console.log(`\n  [synapse] Added "${npmBin}" to your PATH.`);
    console.log(`  [synapse] Open a new terminal for "synapse" command to work.\n`);
  } catch {
    console.log(`\n  [synapse] Could not add npm to PATH automatically.`);
    console.log(`  [synapse] Run: setx PATH "%PATH%;%APPDATA%\\npm"\n`);
  }
}
