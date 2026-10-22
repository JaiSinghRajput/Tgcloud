import { TelegramBridgeService } from '../src/native/TelegramBridge';

describe('TelegramBridgeService', () => {
  it('initializes TDLib client cleanly', async () => {
    const initialized = await TelegramBridgeService.initialize(
      1234567,
      'test-hash-string',
    );
    expect(initialized).toBe(true);
  });

  it('queries authentication state correctly', async () => {
    const auth = await TelegramBridgeService.getAuthState();
    expect(auth).toBeDefined();
    expect(typeof auth.state).toBe('string');
  });

  it('sets up private photo and video backup channels', async () => {
    const channels = await TelegramBridgeService.setupChannels();
    expect(channels).toBeDefined();
    expect(channels.photoChannelId).toBeDefined();
    expect(channels.videoChannelId).toBeDefined();
    expect(channels.verified).toBe(true);
  });

  it('runs Phase 1 proof-of-concept validation suite with all 10 steps', async () => {
    const result = await TelegramBridgeService.runPocTest();
    expect(result.success).toBe(true);
    expect(result.totalSteps).toBe(10);
    expect(result.passedSteps).toBe(10);
    expect(result.steps).toHaveLength(10);

    const stepNames = result.steps.map(s => s.name);
    expect(stepNames).toContain('TDLib Storage Initialization');
    expect(stepNames).toContain('Telegram Authorization Check');
    expect(stepNames).toContain('Private Backup Channels Setup');
    expect(stepNames).toContain('Test Media Preparation');
    expect(stepNames).toContain('Metadata Envelope Generation');
    expect(stepNames).toContain('Media Upload with Metadata');
    expect(stepNames).toContain('Channel History Read & Reconstruction');
    expect(stepNames).toContain('Transfer Idempotency Reconciliation');
    expect(stepNames).toContain('Media Download & Verification');
    expect(stepNames).toContain('Temporary File Cleanup');
  });
});
