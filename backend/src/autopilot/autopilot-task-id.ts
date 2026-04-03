import type { BaseJobPayload } from './autopilot.types';

export function resolveTaskId(payload: BaseJobPayload): string {
  const replayCount = payload.replay?.replayCount ?? 0;
  return `${payload.jobId}:r${replayCount}`;
}

