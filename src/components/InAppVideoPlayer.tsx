import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  requireNativeComponent,
  Platform,
  AppState,
} from 'react-native';

const NativeInAppVideoView =
  Platform.OS === 'android'
    ? requireNativeComponent<any>('InAppVideoView')
    : null;

export interface InAppVideoPlayerProps {
  sourceUri: string;
  isEncrypted?: boolean;
  onClose?: () => void;
  onError?: (err: string) => void;
  onPlaybackStateChange?: (state: 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error') => void;
  testID?: string;
}

export const InAppVideoPlayer: React.FC<InAppVideoPlayerProps> = ({
  sourceUri,
  isEncrypted = false,
  onClose,
  onError,
  onPlaybackStateChange,
  testID = 'in-app-video-player',
}) => {
  const [playbackState, setPlaybackState] = useState<
    'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error'
  >('loading');
  const [durationMs, setDurationMs] = useState<number>(0);
  const [currentPositionMs, setCurrentPositionMs] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [seekToTarget, setSeekToTarget] = useState<number | null>(null);
  const [showControls, setShowControls] = useState<boolean>(true);

  const controlsTimeoutRef = useRef<any>(null);

  const handleStateChange = useCallback(
    (newState: 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error') => {
      setPlaybackState(newState);
      onPlaybackStateChange?.(newState);
    },
    [onPlaybackStateChange],
  );

  // Auto-hide controls after 4 seconds of playback
  useEffect(() => {
    if (playbackState === 'playing') {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 4000);
    } else {
      setShowControls(true);
    }
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [playbackState]);

  // Handle app backgrounding
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active' && isPlaying) {
        setIsPlaying(false);
        handleStateChange('paused');
      }
    });
    return () => {
      subscription.remove();
    };
  }, [isPlaying, handleStateChange]);

  const handleNativeEvent = (event: any) => {
    const nativeData = event.nativeEvent || {};
    const { eventType, durationMs: dMs, currentPositionMs: cMs, errorMessage: eMsg } = nativeData;

    if (dMs !== undefined && dMs > 0) setDurationMs(dMs);
    if (cMs !== undefined) setCurrentPositionMs(cMs);

    switch (eventType) {
      case 'loading':
        handleStateChange('loading');
        break;
      case 'ready':
        handleStateChange('ready');
        break;
      case 'playing':
        setIsPlaying(true);
        handleStateChange('playing');
        break;
      case 'paused':
        setIsPlaying(false);
        handleStateChange('paused');
        break;
      case 'ended':
        setIsPlaying(false);
        handleStateChange('ended');
        break;
      case 'error':
        setIsPlaying(false);
        handleStateChange('error');
        setErrorMessage(eMsg || 'Video playback failed.');
        onError?.(eMsg || 'Video playback failed.');
        break;
      case 'progress':
        if (cMs !== undefined) setCurrentPositionMs(cMs);
        if (dMs !== undefined && dMs > 0) setDurationMs(dMs);
        break;
    }
  };

  const togglePlayPause = () => {
    if (playbackState === 'ended') {
      // Replay from start
      setSeekToTarget(0);
      setIsPlaying(true);
      handleStateChange('playing');
      return;
    }
    const next = !isPlaying;
    setIsPlaying(next);
    handleStateChange(next ? 'playing' : 'paused');
  };

  const handleSeek = (fraction: number) => {
    if (durationMs > 0) {
      const target = Math.floor(fraction * durationMs);
      setCurrentPositionMs(target);
      setSeekToTarget(target);
    }
  };

  const formatTime = (ms: number): string => {
    if (!ms || isNaN(ms) || ms < 0) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${pad(minutes)}:${pad(seconds)}`;
  };

  const progressFraction = durationMs > 0 ? Math.min(1, currentPositionMs / durationMs) : 0;

  return (
    <View style={styles.container} testID={testID}>
      {/* 1. Native Video Player View (or Test Surface) */}
      <View style={styles.videoSurface}>
        {NativeInAppVideoView ? (
          <NativeInAppVideoView
            style={styles.nativeVideo}
            sourceUrl={sourceUri}
            playWhenReady={isPlaying}
            seekToMs={seekToTarget ?? -1}
            onPlaybackStatus={handleNativeEvent}
            testID={`${testID}-native-view`}
          />
        ) : (
          <View style={styles.fallbackSurface} testID={`${testID}-fallback-surface`}>
            <Text style={styles.fallbackSurfaceIcon}>🎬</Text>
            <Text style={styles.fallbackSurfaceText}>In-App Video Player Active</Text>
            <Text style={styles.fallbackSurfaceUri} numberOfLines={1}>
              {sourceUri}
            </Text>
          </View>
        )}
      </View>

      {/* Tap surface to toggle controls overlay */}
      <TouchableOpacity
        activeOpacity={1}
        style={styles.tapSurface}
        onPress={() => setShowControls(prev => !prev)}
      />

      {/* 2. Loading Spinner Overlay */}
      {playbackState === 'loading' && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#34d399" />
          <Text style={styles.loadingText}>
            {isEncrypted ? 'Decrypting and preparing video...' : 'Buffering video...'}
          </Text>
        </View>
      )}

      {/* 3. Error Card Overlay */}
      {playbackState === 'error' && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorIcon}>⚠</Text>
          <Text style={styles.errorTitle}>Playback Error</Text>
          <Text style={styles.errorMessage}>{errorMessage || 'Unable to play video source.'}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              setErrorMessage(null);
              handleStateChange('loading');
              setIsPlaying(true);
            }}
          >
            <Text style={styles.retryBtnText}>↻ Retry Playback</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 4. Overlay Controls (Play/Pause, Timeline, Duration) */}
      {showControls && playbackState !== 'loading' && playbackState !== 'error' && (
        <View style={styles.controlsOverlay}>
          {/* Center Play/Pause/Replay Button */}
          <TouchableOpacity
            style={styles.centerControlBtn}
            onPress={togglePlayPause}
            testID={`${testID}-toggle-btn`}
            accessibilityLabel={isPlaying ? 'Pause video' : 'Play video'}
          >
            <Text style={styles.centerControlIcon}>
              {playbackState === 'ended' ? '↺' : isPlaying ? '⏸' : '▶'}
            </Text>
          </TouchableOpacity>

          {/* Bottom Timeline and Scrubber Bar */}
          <View style={styles.bottomBar}>
            <Text style={styles.timeLabel} testID={`${testID}-current-time`}>
              {formatTime(currentPositionMs)}
            </Text>

            {/* Scrubber Track */}
            <TouchableOpacity
              style={styles.scrubberTrack}
              activeOpacity={0.9}
              onPress={e => {
                const { locationX } = e.nativeEvent;
                // Approximate 200px width track
                const fraction = Math.max(0, Math.min(1, locationX / 200));
                handleSeek(fraction);
              }}
              testID={`${testID}-scrubber`}
            >
              <View style={styles.scrubberBackground} />
              <View
                style={[
                  styles.scrubberProgress,
                  { width: `${Math.round(progressFraction * 100)}%` },
                ]}
              />
              <View
                style={[
                  styles.scrubberThumb,
                  { left: `${Math.round(progressFraction * 100)}%` },
                ]}
              />
            </TouchableOpacity>

            <Text style={styles.timeLabel} testID={`${testID}-duration`}>
              {formatTime(durationMs)}
            </Text>

            {onClose && (
              <TouchableOpacity
                style={styles.closeBtnSmall}
                onPress={onClose}
                accessibilityLabel="Close player"
              >
                <Text style={styles.closeBtnSmallText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignSelf: 'stretch',
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  videoSurface: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nativeVideo: {
    width: '100%',
    height: '100%',
  },
  tapSurface: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  fallbackSurface: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0e1411',
  },
  fallbackSurfaceIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  fallbackSurfaceText: {
    color: '#34d399',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  fallbackSurfaceUri: {
    color: '#6b7280',
    fontSize: 12,
    maxWidth: '80%',
    textAlign: 'center',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  loadingText: {
    color: '#34d399',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
  },
  errorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 25,
  },
  errorIcon: {
    fontSize: 40,
    color: '#ef4444',
    marginBottom: 8,
  },
  errorTitle: {
    color: '#f87171',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  errorMessage: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: '#16221c',
    borderColor: '#34d399',
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#34d399',
    fontSize: 14,
    fontWeight: '600',
  },
  controlsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: 10,
  },
  centerControlBtn: {
    position: 'absolute',
    top: '42%',
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(16, 185, 129, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  centerControlIcon: {
    fontSize: 28,
    color: '#0a0f0d',
    fontWeight: 'bold',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(14, 20, 17, 0.9)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#243029',
  },
  timeLabel: {
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    minWidth: 42,
    textAlign: 'center',
  },
  scrubberTrack: {
    flex: 1,
    height: 30,
    justifyContent: 'center',
    marginHorizontal: 10,
  },
  scrubberBackground: {
    height: 4,
    backgroundColor: '#374151',
    borderRadius: 2,
    width: '100%',
  },
  scrubberProgress: {
    position: 'absolute',
    height: 4,
    backgroundColor: '#34d399',
    borderRadius: 2,
  },
  scrubberThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#10b981',
    marginLeft: -7,
    top: 8,
  },
  closeBtnSmall: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 6,
  },
  closeBtnSmallText: {
    color: '#9ca3af',
    fontSize: 16,
    fontWeight: '700',
  },
});
