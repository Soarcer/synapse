// SPDX-License-Identifier: MIT
// Synapse one-time setup — opens firewall ports for LAN / remote approval.

import { execSync, exec as execCb } from 'child_process';

const RULE_NAME = 'Synapse';
const PORTS = '27246-27248';

function isWindows(): boolean {
  return process.platform === 'win32';
}

function isAdmin(): boolean {
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function firewallRuleExists(): boolean {
  try {
    execSync(`netsh advfirewall firewall show rule name="${RULE_NAME}"`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function addFirewallRule(): boolean {
  try {
    execSync(
      `netsh advfirewall firewall add rule name="${RULE_NAME}" dir=in action=allow protocol=TCP localport=${PORTS}`,
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

function elevateAndRerun(): void {
  const script = process.argv[1];
  const cmd = `Start-Process -Verb RunAs -FilePath "${process.execPath}" -ArgumentList '"${script}", "setup"'`;
  execCb(`powershell -Command "${cmd}"`, () => {
    /* parent exits after launching elevated child */
  });
}

export async function setup(): Promise<void> {
  console.log('\n  Synapse Setup');
  console.log('  =============\n');

  if (!isWindows()) {
    console.log('  Firewall setup is only needed on Windows.');
    console.log('  On Linux/macOS, ports are open by default (or use ufw/iptables manually).\n');
    return;
  }

  if (firewallRuleExists()) {
    console.log(`  [OK] Firewall rule "${RULE_NAME}" already exists (ports ${PORTS})\n`);
    return;
  }

  if (!isAdmin()) {
    console.log('  Requesting admin privileges...\n');
    elevateAndRerun();
    return;
  }

  if (addFirewallRule()) {
    console.log(`  [OK] Firewall rule added — ports ${PORTS} open for incoming TCP\n`);
  } else {
    console.error(`  [FAIL] Could not add firewall rule. Try running as administrator.\n`);
    process.exit(1);
  }
}
