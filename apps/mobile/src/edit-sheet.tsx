import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Modal, Animated, Dimensions, PanResponder, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Circle, CircleDot, CircleCheck, CircleSlash } from 'lucide-react-native';
import { TaskStatus } from '@tasker/core/types';
import { parseTaskDescription } from '@tasker/core/parsers';
import { localDb } from './db';

const C = { bg: '#09090b', card: '#18181b', border: '#27272a', text: '#fafafa', muted: '#71717a', dim: '#52525b', blue: '#3b82f6', green: '#4ade80', amber: '#fbbf24', zinc400: '#a1a1aa' };
const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.7;

const statuses = [
  { label: 'Pending', value: TaskStatus.Pending, Icon: Circle, color: C.muted },
  { label: 'In Progress', value: TaskStatus.InProgress, Icon: CircleDot, color: C.amber },
  { label: 'Done', value: TaskStatus.Done, Icon: CircleCheck, color: C.green },
  { label: "Won't Do", value: TaskStatus.WontDo, Icon: CircleSlash, color: C.zinc400 },
];

interface EditSheetProps {
  taskId: string | null;
  onClose: () => void;
  onRefresh: () => void;
}

export function EditSheet({ taskId, onClose, onRefresh }: EditSheetProps) {
  const visible = taskId !== null;
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [modalVisible, setModalVisible] = useState(false);

  const [desc, setDesc] = useState('');
  const [origDesc, setOrigDesc] = useState('');
  const [currentStatus, setCurrentStatus] = useState<number>(0);
  const [taskShortId, setTaskShortId] = useState('');

  // Load task data when taskId changes
  useEffect(() => {
    if (!taskId) return;
    localDb.getOptional<any>('SELECT * FROM tasks WHERE id = ?', [taskId]).then(t => {
      if (t) {
        setDesc(t.description);
        setOrigDesc(t.description);
        setCurrentStatus(t.status);
        setTaskShortId(t.id.slice(0, 3));
      }
    });
  }, [taskId]);

  // Animate open/close
  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      translateY.setValue(SHEET_HEIGHT);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 28, stiffness: 220 }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    } else if (modalVisible) {
      dismiss();
    }
  }, [visible]);

  const dismiss = () => {
    // Save on dismiss
    if (taskId) {
      const v = desc.trim();
      if (v && v !== origDesc) {
        const parsed = parseTaskDescription(v);
        localDb.execute(
          'UPDATE tasks SET description = ?, due_date = ?, priority = ?, tags = ? WHERE id = ?',
          [v, parsed.dueDate ?? null, parsed.priority ?? null, parsed.tags?.length ? JSON.stringify(parsed.tags) : null, taskId],
        );
        onRefresh();
      }
    }
    Animated.parallel([
      Animated.timing(translateY, { toValue: SHEET_HEIGHT, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => { setModalVisible(false); onClose(); });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 5,
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) {
          translateY.setValue(gs.dy);
          backdropOpacity.setValue(Math.max(0, 1 - gs.dy / (SHEET_HEIGHT * 0.4)));
        }
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 80 || gs.vy > 0.4) {
          dismiss();
        } else {
          Animated.parallel([
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 28, stiffness: 220 }),
            Animated.timing(backdropOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
          ]).start();
        }
      },
    }),
  ).current;

  const changeStatus = (s: number) => {
    if (!taskId) return;
    const completedAt = (s === TaskStatus.Done || s === TaskStatus.WontDo) ? new Date().toISOString() : null;
    localDb.execute('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?', [s, completedAt, taskId]);
    setCurrentStatus(s);
    onRefresh();
  };

  if (!modalVisible) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <View style={{ flex: 1 }}>
        <Animated.View style={[st.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={{ flex: 1 }} onPress={dismiss} />
        </Animated.View>

        <Animated.View style={[st.sheet, { height: SHEET_HEIGHT, transform: [{ translateY }] }]}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            {/* Drag handle */}
            <View {...panResponder.panHandlers} style={st.handleZone}>
              <View style={st.handle} />
            </View>

            <View style={st.header}>
              <Text style={st.headerTitle}>Edit Task</Text>
              <Text style={st.taskId}>{taskShortId}</Text>
              <Pressable onPress={dismiss} style={st.saveBtn}>
                <Text style={st.saveText}>Done</Text>
              </Pressable>
            </View>

            {/* Description */}
            <View style={{ paddingHorizontal: 16, paddingTop: 12, flex: 1 }}>
              <TextInput
                value={desc}
                onChangeText={setDesc}
                multiline
                autoFocus
                style={st.textArea}
                placeholderTextColor={C.dim}
                placeholder="Task description..."
              />
            </View>

            {/* Status picker */}
            <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
              <Text style={st.label}>STATUS</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {statuses.map(({ label, value, Icon, color }) => (
                  <Pressable key={value} onPress={() => changeStatus(value)} style={[st.statusPill, currentStatus === value && st.statusActive]}>
                    <Icon size={14} color={color} />
                    <Text style={st.statusLabel}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  handleZone: { alignItems: 'center', paddingTop: 12, paddingBottom: 8 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#3f3f46' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { fontSize: 16, fontWeight: '700', color: C.text, flex: 1 },
  taskId: { fontSize: 11, color: '#3f3f46', fontFamily: 'monospace', marginRight: 12 },
  saveBtn: { backgroundColor: C.blue, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 7 },
  saveText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  textArea: { backgroundColor: C.card, color: C.text, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, flex: 1, textAlignVertical: 'top' },
  label: { fontSize: 10, color: C.muted, marginBottom: 8, letterSpacing: 1 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  statusActive: { borderColor: C.muted, backgroundColor: '#27272a' },
  statusLabel: { fontSize: 12, color: '#d4d4d8' },
});
