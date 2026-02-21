// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

export const TILE = 32;

export interface GridConfig {
  cols: number;
  rows: number;
  tileSize: number;
}

export interface StationDef {
  name: string;
  col: number;
  row: number;
  icon: string;
}

export interface ModelConfig {
  width: number;
  height: number;
  speed: number;
  bodyColor: string;
  accentColor: string;
  label: string;
}

export interface DecorationDef {
  type: string;
  col: number;
  row: number;
}

export interface DeskDef {
  col: number;
  row: number;
}

export interface PointOfInterestDef {
  col: number;
  row: number;
  name: string;
  icon: string;
}

export type IdleBehavior = 'sit' | 'wander' | 'coffee' | 'socialize';

export interface Palette {
  floor: [string, string];
  carpet: [string, string];
  wall: string;
  wallTop: string;
  wallTrim: string;
  door: string;
  doorFrame: string;
  desk: [string, string];
  skin: string;
  error: string;
  success: string;
  gold: string;
  sparkle: string;
  shadow: string;
}

export interface PixelTheme {
  name: string;
  grid: GridConfig;
  palette: Palette;
  stations: StationDef[];
  models: Record<string, ModelConfig>;
  decorations: DecorationDef[];
  door: { col: number; row: number; width: number };
  spawnArea: { col: number; row: number };
  outputStation: { col: number; row: number };
  homeDesks: DeskDef[];
  pointsOfInterest: PointOfInterestDef[];
}

export type SceneCommand =
  | { type: 'spawnAgent'; agentId: string; model: string; agentType: string; parentAgentId?: string }
  | { type: 'despawnAgent'; agentId: string; success: boolean }
  | { type: 'dispatchToStation'; agentId: string; stationName: string }
  | { type: 'stationComplete'; agentId: string; stationName: string; success: boolean }
  | { type: 'promptArrived'; text: string; agentId: string }
  | { type: 'tokenStream'; agentId: string; count: number }
  | { type: 'cacheHit'; agentId: string }
  | { type: 'sessionStart'; sessionId: string }
  | { type: 'sessionEnd'; sessionId: string }
  | { type: 'updateCost'; costUsd: number };

export type CharacterState = 'idle' | 'walking' | 'working' | 'spawning' | 'despawning';
export type Direction = 'up' | 'down' | 'left' | 'right';
