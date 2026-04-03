import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AutopilotTaskStateService } from './autopilot-task-state.service';

const DEFAULT_RUNNING_RECOVERY_THRESHOLD_MS = 10 * 60 * 1000;

@Injectable()
export class AutopilotRecoveryScannerService implements OnModuleInit {
  private readonly logger = new Logger(AutopilotRecoveryScannerService.name);

  constructor(private readonly taskStateService: AutopilotTaskStateService) {}

  onModuleInit(): void {
    void this.runRecovery('startup');
  }

  @Cron('*/1 * * * *')
  async heartbeatRecovery(): Promise<void> {
    await this.runRecovery('cron');
  }

  private async runRecovery(trigger: 'startup' | 'cron'): Promise<void> {
    const maxRunningAgeMs = Number.parseInt(
      process.env.AUTOPILOT_RUNNING_RECOVERY_THRESHOLD_MS ?? String(DEFAULT_RUNNING_RECOVERY_THRESHOLD_MS),
      10,
    );
    const threshold = Number.isFinite(maxRunningAgeMs) && maxRunningAgeMs > 0
      ? maxRunningAgeMs
      : DEFAULT_RUNNING_RECOVERY_THRESHOLD_MS;
    const recovered = await this.taskStateService.recoverStaleRunning(threshold);
    if (recovered > 0) {
      this.logger.warn(`[RecoveryScanner] trigger=${trigger} recovered stale running tasks count=${recovered}`);
    }
  }
}

