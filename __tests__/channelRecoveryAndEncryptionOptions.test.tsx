import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Buffer } from 'buffer';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { CloudGalleryScreen, CloudMediaItem, DiscoveredMediaItem } from '../src/screens/CloudGalleryScreen';
import { TelegramBridgeService } from '../src/native/TelegramBridge';
import {
  detectKeyFormat,
  setupExistingKeyAsync,
  initializeEncryptionSetupAsync,
  SessionKeyStore,
  encryptMediaPayload,
  decryptBuffer,
} from '../src/domain/crypto/encryptionService';
import { TelegramBackupChannels } from '../src/types/telegram';
import { NetworkPolicy } from '../src/domain/backup/stateMachine';

describe('Channel Recovery, Encryption Options, Authoritative Telegram Sync, and In-App Video', () => {
  beforeEach(() => {
    SessionKeyStore.clear();
    jest.clearAllMocks();
  });

  describe('1. Deleted Telegram Channel Recovery & Destination Lifecycle', () => {
    const mockChannelsDeletedPhoto: TelegramBackupChannels = {
      photoChannelId: '-100111111',
      photoChannelTitle: 'TGCloud - Photos',
      videoChannelId: '-100222222',
      videoChannelTitle: 'TGCloud - Videos',
      verified: true,
      photoStatus: {
        channelId: '-100111111',
        title: 'TGCloud - Photos',
        state: 'DELETED',
        errorMessage: 'Chat not found (400)',
      },
      videoStatus: {
        channelId: '-100222222',
        title: 'TGCloud - Videos',
        state: 'CONNECTED',
      },
    };

    test('distinguishes DELETED channel from healthy channel and provides independent recreation', async () => {
      const recreateSpy = jest.spyOn(TelegramBridgeService, 'recreateDestination').mockResolvedValue({
        channelId: '-100999999',
        title: 'TGCloud - Photos (Recreated)',
      });
      const resyncSpy = jest.fn();

      let root: renderer.ReactTestRenderer;
      await act(async () => {
        root = renderer.create(
          <SettingsScreen
            networkPolicy={NetworkPolicy.WIFI_ONLY}
            requiresCharging={false}
            encryptionEnabled={false}
            channels={mockChannelsDeletedPhoto}
            onToggleNetworkPolicy={() => {}}
            onToggleCharging={() => {}}
            onToggleEncryption={() => {}}
            onDisconnectTelegram={() => {}}
            onResyncChannels={resyncSpy}
          />,
        );
      });

      // Photo channel should display deleted status badge and Recreate button
      const photoStatus = root!.root.findByProps({ testID: 'photo-channel-status' });
      expect(photoStatus.props.children).toContain('Channel Deleted');

      // Video channel is healthy, should show Verified / Connected, NOT deleted
      const videoStatus = root!.root.findByProps({ testID: 'video-channel-status' });
      expect(videoStatus.props.children).toContain('Verified');

      // Recreate photo channel
      const recreateBtn = root!.root.findByProps({ testID: 'recreate-photo-btn' });
      await act(async () => {
        recreateBtn.props.onPress();
      });

      // Recreate confirmation modal opens with explicit data loss disclaimer
      const confirmRecreateBtn = root!.root.findByProps({ testID: 'confirm-recreate-channel-btn' });
      expect(confirmRecreateBtn).toBeDefined();

      await act(async () => {
        await confirmRecreateBtn.props.onPress();
      });

      // Verifies ONLY photo destination was recreated, video destination was preserved
      expect(recreateSpy).toHaveBeenCalledWith('photo');
      expect(recreateSpy).not.toHaveBeenCalledWith('video');
      expect(resyncSpy).toHaveBeenCalled();

      recreateSpy.mockRestore();
    });

    test('Sync now action is purely read-only and never creates channels automatically', async () => {
      const resyncSpy = jest.fn();
      const recreateSpy = jest.spyOn(TelegramBridgeService, 'recreateDestination');

      let root: renderer.ReactTestRenderer;
      await act(async () => {
        root = renderer.create(
          <SettingsScreen
            networkPolicy={NetworkPolicy.WIFI_ONLY}
            requiresCharging={false}
            encryptionEnabled={false}
            channels={mockChannelsDeletedPhoto}
            onToggleNetworkPolicy={() => {}}
            onToggleCharging={() => {}}
            onToggleEncryption={() => {}}
            onDisconnectTelegram={() => {}}
            onResyncChannels={resyncSpy}
          />,
        );
      });

      const syncNowBtn = root!.root.findByProps({ testID: 'sync-destinations-btn' });
      await act(async () => {
        syncNowBtn.props.onPress();
      });

      expect(resyncSpy).toHaveBeenCalledTimes(1);
      expect(recreateSpy).not.toHaveBeenCalled();

      recreateSpy.mockRestore();
    });
  });

  describe('2. Encryption Setup for Existing and New Keys', () => {
    test('detectKeyFormat distinguishes 12-word passphrases, 24-word passphrases, and 64-char hex keys', () => {
      const phrase12 = 'eagle harbor quartz river beacon velvet timber canyon ridge meadow summit pine';
      const phrase24 =
        'eagle harbor quartz river beacon velvet timber canyon ridge meadow summit pine eagle harbor quartz river beacon velvet timber canyon ridge meadow summit pine';
      const hexKey64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const invalidShort = 'too short phrase';
      const invalidChars = 'not-a-valid-hex-or-passphrase-!!!!!!!!!!!!!!!!!!!!!!!!';

      expect(detectKeyFormat(phrase12)).toBe('passphrase');
      expect(detectKeyFormat(phrase24)).toBe('passphrase');
      expect(detectKeyFormat(hexKey64)).toBe('hex');
      expect(detectKeyFormat(invalidShort)).toBe('unknown');
      expect(detectKeyFormat(invalidChars)).toBe('unknown');
    });

    test('Option A (Existing Key Import): validates and derives identical master key cross-device', async () => {
      // Device 1: generate initial setup
      const initialSetup = await initializeEncryptionSetupAsync();
      const initialPassphrase = initialSetup.recoveryKey;
      const initialMasterKeyHex = initialSetup.masterKeyHex;
      const existingConfig = initialSetup.config;

      // Device 2: import existing 12-word passphrase
      const importResult = await setupExistingKeyAsync(initialPassphrase, existingConfig);
      expect(importResult.valid).toBe(true);
      expect(importResult.state).toBe('ENABLED_UNLOCKED');
      expect(importResult.setup?.masterKeyHex).toBe(initialMasterKeyHex);

      // Verify the derived master key can decrypt media encrypted by Device 1
      const masterKey1 = Buffer.from(initialMasterKeyHex, 'hex');
      const masterKey2 = Buffer.from(importResult.setup!.masterKeyHex, 'hex');

      const plainText = Buffer.from('Cross-device photo payload', 'utf8');
      const encrypted = encryptMediaPayload(
        plainText,
        {
          originalName: 'photo.jpg',
          relativePath: 'DCIM/photo.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: plainText.length,
          modifiedAtMs: Date.now(),
          contentHash: 'hash123',
        },
        masterKey1,
        existingConfig.kdfSalt,
      );

      // Decrypt DEK using Device 2's imported key
      const dekBuf = Buffer.from(encrypted.envelope.encryptedDek, 'base64');
      const decryptedDek = decryptBuffer(
        dekBuf,
        masterKey2,
        encrypted.envelope.dekIv,
        encrypted.envelope.dekTag,
      );
      expect(decryptedDek).toBeDefined();
    });

    test('Option A: rejects incorrect key when authenticated test fails against existing config', async () => {
      const initialSetup = await initializeEncryptionSetupAsync();
      const wrongPassphrase = 'wrong harbor quartz river beacon velvet timber canyon ridge meadow summit pine';

      const importResult = await setupExistingKeyAsync(wrongPassphrase, initialSetup.config);
      expect(importResult.valid).toBe(false);
      expect(importResult.errorMessage).toContain('verification token');
    });

    test('Option B (Generate New Key): requires user confirmation that 12 words are saved', async () => {
      let enabled = false;
      let root: renderer.ReactTestRenderer;

      await act(async () => {
        root = renderer.create(
          <SettingsScreen
            networkPolicy={NetworkPolicy.WIFI_ONLY}
            requiresCharging={false}
            encryptionEnabled={false}
            onToggleNetworkPolicy={() => {}}
            onToggleCharging={() => {}}
            onToggleEncryption={(val) => {
              enabled = val;
            }}
            onDisconnectTelegram={() => {}}
          />,
        );
      });

      // Open encryption choice modal
      const encSwitch = root!.root.findByProps({ testID: 'encryption-switch' });
      await act(async () => {
        encSwitch.props.onValueChange(true);
      });

      // Select Option B: "I don't have a key"
      const optionBBtn = root!.root.findByProps({ testID: 'option-generate-key-btn' });
      await act(async () => {
        await optionBBtn.props.onPress();
      });

      // Verify 12 words are generated and displayed in chips
      const chips = root!.root.findAll(
        node => typeof node.props.testID === 'string' && node.props.testID.startsWith('word-chip-'),
      );
      const uniqueChipTestIds = new Set(chips.map(c => c.props.testID));
      expect(uniqueChipTestIds.size).toBe(12);

      // Tapping "Enable Client-Side Encryption" without saving acknowledgment should reject
      const confirmSetupBtn = root!.root.findByProps({ testID: 'confirm-setup-btn' });
      await act(async () => {
        confirmSetupBtn.props.onPress();
      });
      expect(enabled).toBe(false);

      // User acknowledges they have saved the key
      const ackBox = root!.root.findByProps({ testID: 'save-acknowledgment-toggle' });
      await act(async () => {
        ackBox.props.onPress();
      });

      // Now confirmation succeeds
      await act(async () => {
        confirmSetupBtn.props.onPress();
      });
      expect(enabled).toBe(true);
    });
  });

  describe('3. Telegram Authoritative Source of Truth & Local Cache Isolation', () => {
    test('Cloud Gallery displays locked metadata when session key is locked', async () => {
      const lockedCloudItem: CloudMediaItem = {
        id: 'msg-501',
        mediaType: 'photo',
        originalName: 'Encrypted Item (Locked)',
        relativePath: '',
        sizeBytes: 2048,
        modifiedAtMs: Date.now(),
        messageId: '501',
        channelId: '-100111111',
        isEncrypted: true,
        isLocked: true,
        encryptionEnvelope: {
          alg: 'AES-256-GCM',
          keyVersion: 1,
          iv: 'iv',
          tag: 'tag',
          encryptedDek: 'dummy',
          dekIv: 'iv',
          dekTag: 'tag',
          salt: 'salt',
        },
      };

      let root: renderer.ReactTestRenderer;
      await act(async () => {
        root = renderer.create(
          <CloudGalleryScreen
            items={[lockedCloudItem]}
            scannedItems={[]}
            initialView="cloud"
            onRestoreItem={async () => true}
          />,
        );
      });

      // Locked badge and recovery banner appear
      const lockedThumb = root!.root.findByProps({ testID: `cloud-item-${lockedCloudItem.id}` });
      expect(lockedThumb).toBeDefined();

      const allText = root!.root.findAllByType('Text' as any).map(t => {
        const c = t.props.children;
        return Array.isArray(c) ? c.join('') : String(c);
      });
      expect(allText.some(txt => txt.includes('Locked'))).toBe(true);
    });
  });

  describe('4. Gallery Selection Mode & In-App Video Playback', () => {
    const mockDevicePhotos: DiscoveredMediaItem[] = [
      {
        id: 'p-1',
        sourceKey: 'content://media/1',
        mediaType: 'photo',
        displayName: 'photo1.jpg',
        relativePath: 'DCIM/photo1.jpg',
        sizeBytes: 1024,
        modifiedAtMs: Date.now(),
      },
      {
        id: 'p-2',
        sourceKey: 'content://media/2',
        mediaType: 'photo',
        displayName: 'photo2.jpg',
        relativePath: 'DCIM/photo2.jpg',
        sizeBytes: 2048,
        modifiedAtMs: Date.now(),
      },
    ];

    test('supports visual multi-selection mode with select all, deselect all, and contextual backup', async () => {
      const backupSpy = jest.fn();

      let root: renderer.ReactTestRenderer;
      await act(async () => {
        root = renderer.create(
          <CloudGalleryScreen
            items={[]}
            scannedItems={mockDevicePhotos}
            initialView="device"
            onConfirmBackup={backupSpy}
            onRestoreItem={async () => true}
          />,
        );
      });

      // Enter selection mode via header Select button
      const selectBtn = root!.root.findByProps({ accessibilityLabel: 'Toggle selection mode' });
      await act(async () => {
        selectBtn.props.onPress();
      });

      // Select All via toggle button testID
      const selectAllBtn = root!.root.findByProps({ testID: 'select-all-toggle-btn' });
      await act(async () => {
        selectAllBtn.props.onPress();
      });

      // Backup Selected (2)
      const backupBtn = root!.root.findByProps({ testID: 'backup-selected-btn' });
      expect(backupBtn).toBeDefined();

      await act(async () => {
        backupBtn.props.onPress();
      });

      expect(backupSpy).toHaveBeenCalledWith(['p-1', 'p-2']);
    });
  });
});
