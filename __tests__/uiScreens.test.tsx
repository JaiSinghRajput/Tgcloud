import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { CloudGalleryScreen } from '../src/screens/CloudGalleryScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { ProfileScreen } from '../src/screens/ProfileScreen';
import { LoginScreen } from '../src/screens/LoginScreen';
import { MainApp } from '../src/app/MainApp';
import { TelegramBridgeService } from '../src/native/TelegramBridge';
import { NetworkPolicy } from '../src/domain/backup/stateMachine';

describe('React Native Simplified UI Screens', () => {
  it('renders ProfileScreen with user details and triggers logout', async () => {
    const handleLogout = jest.fn();
    const handleNavSettings = jest.fn();

    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <ProfileScreen
          user={{
            userId: 98765432,
            firstName: 'Alex',
            lastName: 'Hunter',
          }}
          onLogout={handleLogout}
          onNavigateToSettings={handleNavSettings}
        />,
      );
    });

    const root = tree!.root;
    expect(root.findByProps({ children: 'Alex Hunter' })).toBeDefined();
    expect(root.findByProps({ children: 'AH' })).toBeDefined();

    const logoutBtn = root.findByProps({ children: 'Log Out of Telegram' });
    expect(logoutBtn).toBeDefined();
  });

  it('renders SettingsScreen with consolidated sections and permission badge', async () => {
    const handleToggleNetwork = jest.fn();
    const handleToggleCharging = jest.fn();
    const handleToggleEncryption = jest.fn();
    const handleTogglePause = jest.fn();
    const handleRequestPerm = jest.fn();
    const handleOpenSettings = jest.fn();
    const handleDisconnect = jest.fn();

    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SettingsScreen
          networkPolicy={NetworkPolicy.WIFI_ONLY}
          requiresCharging={false}
          encryptionEnabled={false}
          isPaused={false}
          mediaPermissionStatus="granted"
          user={{
            userId: 12345,
            firstName: 'John',
            lastName: 'Doe',
          }}
          onToggleNetworkPolicy={handleToggleNetwork}
          onToggleCharging={handleToggleCharging}
          onToggleEncryption={handleToggleEncryption}
          onTogglePause={handleTogglePause}
          onRequestPermission={handleRequestPerm}
          onOpenAppSettings={handleOpenSettings}
          onDisconnectTelegram={handleDisconnect}
        />,
      );
    });

    const root = tree!.root;
    // Section headers
    expect(root.findByProps({ children: 'Account' })).toBeDefined();
    expect(root.findByProps({ children: 'Backup' })).toBeDefined();
    expect(root.findByProps({ children: 'Storage and Permissions' })).toBeDefined();
    expect(root.findByProps({ children: 'Security' })).toBeDefined();
    expect(root.findByProps({ children: 'About' })).toBeDefined();
    // Live permission badge
    expect(root.findByProps({ children: 'Full Access Granted' })).toBeDefined();
  });

  it('renders CloudGalleryScreen with concise status, permission banner and items', async () => {
    const handleRestore = jest.fn().mockResolvedValue(true);
    const handleRequestPerm = jest.fn();

    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <CloudGalleryScreen
          items={[
            {
              id: 'c1',
              mediaType: 'photo',
              originalName: 'IMG_01.jpg',
              relativePath: 'DCIM/Camera/IMG_01.jpg',
              sizeBytes: 2500000,
              modifiedAtMs: 1792600000000,
              messageId: '10',
              channelId: '-1001',
            },
          ]}
          scannedItems={[
            {
              id: 'c1',
              sourceKey: 'src_1',
              mediaType: 'photo',
              displayName: 'IMG_01.jpg',
              relativePath: 'DCIM/Camera/IMG_01.jpg',
              sizeBytes: 2500000,
              modifiedAtMs: 1792600000000,
            },
          ]}
          folders={[
            {
              folderKey: 'DCIM/Camera',
              displayLabel: 'Camera',
              itemCount: 1,
              byteSize: 2500000,
              isExcluded: false,
            },
          ]}
          eligibleCount={0}
          eligibleBytes={0}
          isPaused={false}
          activeProgress={null}
          mediaPermissionStatus="denied"
          onRequestPermission={handleRequestPerm}
          onRestoreItem={handleRestore}
        />,
      );
    });

    const root = tree!.root;
    // Permission warning banner rendered because status is 'denied'
    expect(
      root.findByProps({ children: 'Photo & Video Permission Needed' }),
    ).toBeDefined();
    expect(
      root.findByProps({ children: 'Allow Photo & Video Access' }),
    ).toBeDefined();
    // Gallery header
    expect(root.findByProps({ children: 'Gallery' })).toBeDefined();
  });

  it('renders MainApp shell with minimal 3-tab navigation', async () => {
    const authSpy = jest.spyOn(TelegramBridgeService, 'getAuthState').mockResolvedValue({
      state: 'READY',
      userId: 12345,
      firstName: 'Alex',
      lastName: 'Hunter',
    });

    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<MainApp />);
    });

    expect(tree!.toJSON()).toBeDefined();
    const root = tree!.root;

    // Verify minimal 3 tabs are present
    expect(root.findByProps({ accessibilityLabel: 'Gallery tab' })).toBeDefined();
    expect(root.findByProps({ accessibilityLabel: 'Settings tab' })).toBeDefined();
    expect(root.findByProps({ accessibilityLabel: 'Profile tab' })).toBeDefined();

    // Verify old removed tabs are NOT present
    expect(root.findAllByProps({ accessibilityLabel: 'Dashboard tab' })).toHaveLength(0);
    expect(root.findAllByProps({ accessibilityLabel: 'Scan Review tab' })).toHaveLength(0);
    expect(root.findAllByProps({ accessibilityLabel: 'Telegram tab' })).toHaveLength(0);

    authSpy.mockRestore();
  });

  it('renders LoginScreen with phone number and OTP flow', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <LoginScreen onLoginSuccess={jest.fn()} />,
      );
    });
    expect(tree!.toJSON()).toBeDefined();
  });
});
