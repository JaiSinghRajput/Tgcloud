export interface DiagnosticEvent {
  eventName: string;
  appVersion: string;
  osVersion: string;
  durationMs?: number;
  errorCode?: string;
  errorCategory?: 'network' | 'rate_limit' | 'storage' | 'auth' | 'system';
  jobCorrelationId?: string; // Random non-identifying UUID
  timestampMs: number;
}

export interface RawDiagnosticPayload {
  [key: string]: any;
}

// Strictly forbidden sensitive keys that must never be included in telemetry
const FORBIDDEN_KEYS = new Set([
  'filename',
  'originalName',
  'displayName',
  'name',
  'path',
  'relativePath',
  'fullPath',
  'content',
  'media',
  'bytes',
  'recoveryKey',
  'masterKey',
  'password',
  'code',
  'authCode',
  'token',
  'session',
  'tdlibDatabase',
]);

/**
 * Privacy-preserving diagnostics service adhering to PRD Section 5.8 and SECURITY_AND_PRIVACY.md.
 * Discards any events containing private metadata or sensitive credentials.
 */
export class DiagnosticsService {
  private isOptedIn = false;
  private readonly eventsLog: DiagnosticEvent[] = [];

  constructor(optIn: boolean = false) {
    this.isOptedIn = optIn;
  }

  setOptIn(enabled: boolean): void {
    this.isOptedIn = enabled;
    if (!enabled) {
      this.clearEvents();
    }
  }

  isDiagnosticsEnabled(): boolean {
    return this.isOptedIn;
  }

  /**
   * Scrubs raw payload and emits sanitized event only if diagnostics are opted-in
   * and no sensitive metadata is leaked.
   */
  recordEvent(
    event: DiagnosticEvent,
    rawPayload?: RawDiagnosticPayload,
  ): boolean {
    if (!this.isOptedIn) {
      return false;
    }

    if (rawPayload && this.containsSensitiveKeys(rawPayload)) {
      // Reject entire event to guarantee zero leak
      return false;
    }

    this.eventsLog.push(event);
    return true;
  }

  getEvents(): readonly DiagnosticEvent[] {
    return this.eventsLog;
  }

  clearEvents(): void {
    this.eventsLog.length = 0;
  }

  /**
   * Recursively audits a payload to ensure forbidden keys are not present.
   */
  private containsSensitiveKeys(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;

    for (const key of Object.keys(obj)) {
      if (FORBIDDEN_KEYS.has(key)) {
        return true;
      }
      if (
        typeof obj[key] === 'object' &&
        this.containsSensitiveKeys(obj[key])
      ) {
        return true;
      }
    }
    return false;
  }
}
