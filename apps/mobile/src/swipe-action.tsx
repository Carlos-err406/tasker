import { useRef, useState } from 'react';
import { View, Text, Animated, PanResponder, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';

const C = { bg: '#09090b' };

interface SwipeActionProps {
  onSwipe: () => void;
  direction?: 'left' | 'right';
  icon: ReactNode;
  label: string;
  color: string;
  children: ReactNode;
}

export function SwipeAction({ onSwipe, direction = 'left', icon, label, color, children }: SwipeActionProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const rowHeight = useRef(new Animated.Value(-1)).current; // -1 = not collapsing
  const [collapsing, setCollapsing] = useState(false);
  const heightRef = useRef(0);

  const isLeft = direction === 'left';
  const threshold = 120;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 10 && Math.abs(gs.dx) > Math.abs(gs.dy),
      onPanResponderMove: (_, gs) => {
        if (isLeft && gs.dx < 0) translateX.setValue(gs.dx);
        if (!isLeft && gs.dx > 0) translateX.setValue(gs.dx);
      },
      onPanResponderRelease: (_, gs) => {
        const triggered = isLeft ? gs.dx < -threshold : gs.dx > threshold;
        if (triggered) {
          Animated.timing(translateX, {
            toValue: isLeft ? -500 : 500,
            duration: 180,
            useNativeDriver: true,
          }).start(() => {
            // Now collapse the height
            rowHeight.setValue(heightRef.current);
            setCollapsing(true);
            Animated.timing(rowHeight, {
              toValue: 0,
              duration: 200,
              useNativeDriver: false,
            }).start(onSwipe);
          });
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
        }
      },
    }),
  ).current;

  const iconOpacity = isLeft
    ? translateX.interpolate({ inputRange: [-80, -20, 0], outputRange: [1, 0.3, 0], extrapolate: 'clamp' })
    : translateX.interpolate({ inputRange: [0, 20, 80], outputRange: [0, 0.3, 1], extrapolate: 'clamp' });

  return (
    <Animated.View style={[{ overflow: 'hidden' }, collapsing && { height: rowHeight }]}>
      <View onLayout={(e) => { heightRef.current = e.nativeEvent.layout.height; }}>
        <Animated.View style={[
          s.action,
          { backgroundColor: color },
          isLeft ? { justifyContent: 'flex-end', paddingRight: 24 } : { justifyContent: 'flex-start', paddingLeft: 24 },
          { opacity: iconOpacity },
        ]}>
          {icon}
          <Text style={s.actionLabel}>{label}</Text>
        </Animated.View>
        <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX }], backgroundColor: C.bg }}>
          {children}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  action: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600' },
});
