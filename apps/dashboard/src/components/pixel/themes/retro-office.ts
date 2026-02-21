// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { PixelTheme } from '../engine/types';

export const RETRO_OFFICE: PixelTheme = {
  name: 'retro-office',
  grid: { cols: 42, rows: 28, tileSize: 32 },
  palette: {
    floor: ['#c4a47a', '#b8986e'],
    carpet: ['#2b5329', '#3a6b37'],
    wall: '#a09080',
    wallTop: '#d4c5a9',
    wallTrim: '#6b5b4b',
    door: '#5b3a1a',
    doorFrame: '#8b6b4b',
    desk: ['#9b7924', '#7b5914'],
    skin: '#f0c8a0',
    error: '#ff4444',
    success: '#44dd44',
    gold: '#ffd700',
    sparkle: '#ffffaa',
    shadow: 'rgba(0,0,0,0.25)',
  },
  stations: [
    { name: 'Read',  col: 5,  row: 8,  icon: 'cabinet' },
    { name: 'Write', col: 11, row: 8,  icon: 'typewriter' },
    { name: 'Edit',  col: 29, row: 8,  icon: 'drafting' },
    { name: 'Bash',  col: 35, row: 8,  icon: 'terminal' },
    { name: 'Glob',  col: 5,  row: 15, icon: 'magnifier' },
    { name: 'Grep',  col: 11, row: 15, icon: 'bookshelf' },
    { name: 'Web',   col: 29, row: 15, icon: 'globe' },
    { name: 'Task',  col: 35, row: 15, icon: 'dispatch' },
  ],
  models: {
    opus:    { width: 24, height: 32, speed: 90,  bodyColor: '#b82030', accentColor: '#ffd700', label: 'Opus' },
    sonnet:  { width: 20, height: 28, speed: 130, bodyColor: '#2855a0', accentColor: '#b0c0d0', label: 'Sonnet' },
    haiku:   { width: 16, height: 22, speed: 200, bodyColor: '#1e8c3a', accentColor: '#d0f0d0', label: 'Haiku' },
    manager: { width: 20, height: 28, speed: 100, bodyColor: '#2a2a2a', accentColor: '#cc2233', label: 'Manager' },
  },
  decorations: [
    { type: 'plant',  col: 2,  row: 3 },
    { type: 'plant',  col: 39, row: 3 },
    { type: 'plant',  col: 2,  row: 22 },
    { type: 'plant',  col: 39, row: 22 },
    { type: 'coffee', col: 37, row: 5 },
    { type: 'clock',  col: 20, row: 2 },
    { type: 'board',  col: 3,  row: 5 },
    { type: 'cooler', col: 37, row: 20 },
  ],
  door: { col: 20, row: 0, width: 2 },
  spawnArea: { col: 20, row: 22 },
  outputStation: { col: 19, row: 21 },
  homeDesks: [
    { col: 7, row: 10 },
    { col: 13, row: 10 },
    { col: 7, row: 17 },
    { col: 13, row: 17 },
    { col: 31, row: 10 },
    { col: 31, row: 17 },
    { col: 37, row: 10 },
    { col: 37, row: 17 },
  ],
  pointsOfInterest: [
    { col: 37, row: 5, name: 'coffee', icon: 'coffee' },
    { col: 37, row: 20, name: 'cooler', icon: 'cooler' },
  ],
};
