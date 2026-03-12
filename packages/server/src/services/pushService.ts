// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard
//
// No-op stub for push notifications. Phase B replaces this
// with real web-push VAPID implementation.

export interface PushPayload {
  title: string;
  body: string;
  requestId: string;
  url: string;
}

/** No-op in Phase A — Phase B replaces with real web-push. */
export async function sendToAll(_payload: PushPayload): Promise<void> {
  // Intentionally empty — stub for Phase A compilation
}
