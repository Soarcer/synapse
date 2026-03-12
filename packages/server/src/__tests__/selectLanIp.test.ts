import { describe, it, expect } from 'vitest';
import os from 'os';
import { selectLanIp } from '../routes/network.js';

// Test the pure heuristic function, not the Express route
describe('selectLanIp', () => {
  it('selects 192.168.x.x address', () => {
    const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      lo: [
        {
          address: '127.0.0.1',
          family: 'IPv4',
          internal: true,
          netmask: '255.0.0.0',
          mac: '',
          cidr: '',
        },
      ],
      eth0: [
        {
          address: '192.168.1.100',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.255.0',
          mac: '',
          cidr: '',
        },
      ],
    };
    expect(selectLanIp(interfaces)).toBe('192.168.1.100');
  });

  it('selects 10.x.x.x address', () => {
    const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      eth0: [
        {
          address: '10.0.0.42',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.255.0',
          mac: '',
          cidr: '',
        },
      ],
    };
    expect(selectLanIp(interfaces)).toBe('10.0.0.42');
  });

  it('excludes Docker bridge (172.17.x.x)', () => {
    const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      docker0: [
        {
          address: '172.17.0.1',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.0.0',
          mac: '',
          cidr: '',
        },
      ],
      eth0: [
        {
          address: '192.168.1.50',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.255.0',
          mac: '',
          cidr: '',
        },
      ],
    };
    expect(selectLanIp(interfaces)).toBe('192.168.1.50');
  });

  it('excludes Tailscale (100.x.x.x)', () => {
    const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      tailscale0: [
        {
          address: '100.64.0.1',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.255.0',
          mac: '',
          cidr: '',
        },
      ],
      eth0: [
        {
          address: '10.0.1.5',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.255.0',
          mac: '',
          cidr: '',
        },
      ],
    };
    expect(selectLanIp(interfaces)).toBe('10.0.1.5');
  });

  it('excludes link-local (169.254.x.x)', () => {
    const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      wlan0: [
        {
          address: '169.254.1.1',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.0.0',
          mac: '',
          cidr: '',
        },
      ],
    };
    expect(selectLanIp(interfaces)).toBeNull();
  });

  it('returns null when no suitable interface found', () => {
    const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      lo: [
        {
          address: '127.0.0.1',
          family: 'IPv4',
          internal: true,
          netmask: '255.0.0.0',
          mac: '',
          cidr: '',
        },
      ],
    };
    expect(selectLanIp(interfaces)).toBeNull();
  });

  it('excludes IPv6 addresses', () => {
    const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      eth0: [
        {
          address: 'fe80::1',
          family: 'IPv6',
          internal: false,
          netmask: 'ffff::',
          mac: '',
          cidr: '',
          scopeid: 0,
        },
      ],
    };
    expect(selectLanIp(interfaces)).toBeNull();
  });
});
