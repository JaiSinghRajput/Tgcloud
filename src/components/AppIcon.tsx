import React from 'react';
import {
  Text,
  TouchableOpacity,
  StyleSheet,
  View,
  StyleProp,
  ViewStyle,
  TextStyle,
} from 'react-native';

export type IconName =
  | 'trash'
  | 'close'
  | 'back'
  | 'play'
  | 'pause'
  | 'replay'
  | 'refresh'
  | 'download'
  | 'upload'
  | 'selectAll'
  | 'check'
  | 'checkbox'
  | 'checkboxChecked'
  | 'more'
  | 'lock'
  | 'unlock'
  | 'grid'
  | 'list'
  | 'gallery'
  | 'cloud'
  | 'settings'
  | 'profile'
  | 'chevronLeft'
  | 'chevronRight';

const ICON_GLYPHS: Record<IconName, string> = {
  trash: '🗑',
  close: '✕',
  back: '←',
  play: '▶',
  pause: '❚❚',
  replay: '↺',
  refresh: '↻',
  download: '⤓',
  upload: '⤒',
  selectAll: '☑',
  check: '✓',
  checkbox: '☐',
  checkboxChecked: '☑',
  more: '⋯',
  lock: '🔒',
  unlock: '🔓',
  grid: '⊞',
  list: '☰',
  gallery: '🖼',
  cloud: '☁',
  settings: '⚙',
  profile: '👤',
  chevronLeft: '‹',
  chevronRight: '›',
};

export interface AppIconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

export const AppIcon: React.FC<AppIconProps> = ({
  name,
  size = 20,
  color = '#f8fafc',
  style,
}) => {
  const glyph = ICON_GLYPHS[name] || '•';
  return (
    <Text
      style={[
        styles.iconText,
        {
          fontSize: size,
          lineHeight: size * 1.15,
          color,
        },
        style,
      ]}
      allowFontScaling={false}
    >
      {glyph}
    </Text>
  );
};

export interface IconButtonProps {
  name: IconName;
  onPress?: () => void;
  size?: number;
  iconSize?: number;
  color?: string;
  variant?:
    | 'default'
    | 'filled'
    | 'tinted'
    | 'destructive'
    | 'secondary'
    | 'surface';
  disabled?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  badge?: string | number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const IconButton: React.FC<IconButtonProps> = ({
  name,
  onPress,
  size = 44,
  iconSize,
  color,
  variant = 'default',
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  badge,
  style,
  testID,
}) => {
  const computedIconSize = iconSize ?? Math.round(size * 0.48);

  const getVariantStyles = () => {
    switch (variant) {
      case 'destructive':
        return {
          bg: 'rgba(239, 68, 68, 0.16)',
          border: 'rgba(239, 68, 68, 0.35)',
          text: color || '#f87171',
        };
      case 'filled':
        return {
          bg: '#2563eb',
          border: '#3b82f6',
          text: color || '#ffffff',
        };
      case 'tinted':
        return {
          bg: 'rgba(59, 130, 246, 0.15)',
          border: 'rgba(59, 130, 246, 0.3)',
          text: color || '#60a5fa',
        };
      case 'secondary':
        return {
          bg: 'rgba(51, 65, 85, 0.6)',
          border: 'rgba(100, 116, 139, 0.3)',
          text: color || '#cbd5e1',
        };
      case 'surface':
        return {
          bg: 'rgba(15, 23, 42, 0.75)',
          border: 'rgba(255, 255, 255, 0.12)',
          text: color || '#f8fafc',
        };
      case 'default':
      default:
        return {
          bg: 'transparent',
          border: 'transparent',
          text: color || '#f8fafc',
        };
    }
  };

  const v = getVariantStyles();

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={[
        styles.buttonBase,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size / 2),
          backgroundColor: v.bg,
          borderColor: v.border,
          borderWidth: v.border !== 'transparent' ? 1 : 0,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      <AppIcon name={name} size={computedIconSize} color={v.text} />
      {badge !== undefined && (
        <View style={styles.badgeContainer}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  iconText: {
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  buttonBase: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeContainer: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
});
