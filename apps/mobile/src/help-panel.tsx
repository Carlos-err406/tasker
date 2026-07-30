import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Modal, Animated, Dimensions, PanResponder } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Undo2, Redo2, ChevronsDownUp, ArrowUpDown, Plus, Info, Hand, CheckSquare, Trash2, ArrowDown, Eye, ChevronDown, Calendar, Hash, CircleSlash, CircleCheck, CircleDot, Circle, Minus } from 'lucide-react-native';
import * as Updates from 'expo-updates';

const C = { bg: '#09090b', card: '#18181b', border: '#27272a', text: '#fafafa', muted: '#71717a', dim: '#52525b', mono: '#a1a1aa', blue: '#3b82f6', green: '#4ade80', amber: '#fbbf24' };
const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.92;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ icon, label, desc }: { icon?: React.ReactNode; label: string; desc: string }) {
  return (
    <View style={s.row}>
      <View style={s.rowLabelCol}>
        {icon && <View style={{ marginRight: 8 }}>{icon}</View>}
        <Text style={s.rowLabel}>{label}</Text>
      </View>
      <Text style={s.rowDesc}>{desc}</Text>
    </View>
  );
}

function CodeRow({ code, desc }: { code: string; desc: string }) {
  return (
    <View style={s.row}>
      <Text style={s.codeLabel}>{code}</Text>
      <Text style={s.rowDesc}>{desc}</Text>
    </View>
  );
}

function UpdateInfo() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const version = Updates.runtimeVersion ?? '—';
  const channel = Updates.channel ?? '—';
  const source = Updates.isEmbeddedLaunch ? 'embedded (APK)' : 'OTA update';
  const updateId = Updates.updateId ? Updates.updateId.slice(0, 8) : '—';
  const created = Updates.createdAt ? Updates.createdAt.toISOString().slice(0, 16).replace('T', ' ') + 'Z' : '—';

  const check = async () => {
    setBusy(true);
    setStatus('Checking…');
    try {
      const res = await Updates.checkForUpdateAsync();
      if (res.isAvailable) {
        setStatus('Downloading…');
        await Updates.fetchUpdateAsync();
        setStatus('Restarting…');
        await Updates.reloadAsync();
      } else {
        setStatus('Up to date ✓');
      }
    } catch (e: any) {
      setStatus('Failed: ' + (e?.message ?? 'error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Version">
      <Row label="App version" desc={version} />
      <Row label="Channel" desc={channel} />
      <Row label="Running" desc={`${source} · ${updateId}`} />
      <Row label="Published" desc={created} />
      {Updates.isEnabled ? (
        <Pressable onPress={check} disabled={busy} style={({ pressed }) => [s.updateBtn, (pressed || busy) && { opacity: 0.6 }]}>
          <Text style={s.updateBtnText}>{busy ? 'Working…' : 'Check for updates'}</Text>
        </Pressable>
      ) : (
        <Text style={s.updateStatus}>Updates disabled (dev build)</Text>
      )}
      {status && <Text style={s.updateStatus}>{status}</Text>}
    </Section>
  );
}

export function HelpPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      translateY.setValue(SHEET_HEIGHT);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 28, stiffness: 220 }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    } else if (modalVisible) {
      Animated.parallel([
        Animated.timing(translateY, { toValue: SHEET_HEIGHT, duration: 250, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setModalVisible(false));
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: SHEET_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
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
        if (gs.dy > 100 || gs.vy > 0.4) {
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

  if (!modalVisible) return null;

  const I = 13;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <View style={{ flex: 1 }}>
        <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={{ flex: 1 }} onPress={dismiss} />
        </Animated.View>

        <Animated.View style={[s.sheet, { height: SHEET_HEIGHT, transform: [{ translateY }] }]}>
          <View {...panResponder.panHandlers} style={s.handleZone}>
            <View style={s.handle} />
          </View>

          <View style={s.header}>
            <Text style={s.headerTitle}>Help</Text>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 50 }} bounces={false}>
            <Section title="Gestures">
              <Row icon={<Hand size={I} color={C.muted} />} label="Tap task" desc="Edit description + status" />
              <Row icon={<CheckSquare size={I} color={C.muted} />} label="Tap checkbox" desc="Toggle done / pending" />
              <Row icon={<Trash2 size={I} color={C.muted} />} label="Swipe left" desc="Delete task" />
              <Row icon={<Trash2 size={I} color={C.muted} />} label="Long-press list" desc="Delete list" />
              <Row icon={<ArrowDown size={I} color={C.muted} />} label="Pull down" desc="Refresh" />
              <Row icon={<Eye size={I} color={C.muted} />} label="Eye icon" desc="Hide/show completed" />
              <Row icon={<ChevronDown size={I} color={C.muted} />} label="Chevron" desc="Collapse/expand list" />
            </Section>

            <Section title="Header Actions">
              <Row icon={<Undo2 size={I} color={C.muted} />} label="Undo" desc="Reverse last action" />
              <Row icon={<Redo2 size={I} color={C.muted} />} label="Redo" desc="Re-apply undone action" />
              <Row icon={<ChevronsDownUp size={I} color={C.muted} />} label="Collapse" desc="Collapse/expand all" />
              <Row icon={<ArrowUpDown size={I} color={C.muted} />} label="Sort" desc="System sort (status/priority/due)" />
              <Row icon={<Plus size={I} color={C.muted} />} label="New list" desc="Create a new list" />
              <Row icon={<Info size={I} color={C.muted} />} label="Help" desc="This panel" />
            </Section>

            <Section title="Metadata Prefixes">
              <Text style={s.sectionDesc}>Add on a separate last line when creating or editing.</Text>
              <CodeRow code="p1  p2  p3" desc="Priority (high, medium, low)" />
              <CodeRow code="@date" desc="Due date" />
              <CodeRow code="#tag" desc="Tag" />
              <CodeRow code="^abc" desc="Subtask of task abc" />
              <CodeRow code="!abc" desc="Blocks task abc" />
              <CodeRow code="-^abc" desc="Has subtask abc" />
              <CodeRow code="-!abc" desc="Blocked by task abc" />
              <CodeRow code="~abc" desc="Related to task abc" />
            </Section>

            <Section title="Date Formats">
              <CodeRow code="today  tomorrow" desc="Relative days" />
              <CodeRow code="mon ... sun" desc="Next weekday" />
              <CodeRow code="jan15  feb3" desc="Month + day" />
              <CodeRow code="+3d" desc="Days from now" />
              <CodeRow code="2026-12-25" desc="Exact date (ISO)" />
            </Section>

            <Section title="Search Filters">
              <Text style={s.sectionDesc}>Use in the Search tab. Combine freely.</Text>
              <CodeRow code="tag:name" desc="Filter by tag" />
              <CodeRow code="status:done" desc="pending, wip, done, wontdo" />
              <CodeRow code="priority:high" desc="high/p1, medium/p2, low/p3" />
              <CodeRow code="due:today" desc="today, overdue, week, month" />
              <CodeRow code="list:name" desc="Filter by list" />
              <CodeRow code="has:subtasks" desc="subtasks, parent, due, tags" />
              <CodeRow code="id:abc" desc="Task ID prefix" />
              <CodeRow code="!value" desc="Negate any filter" />
            </Section>

            <Section title="Task Statuses">
              <Row icon={<Circle size={I} color={C.muted} />} label="Pending" desc="Default state" />
              <Row icon={<CircleDot size={I} color={C.amber} />} label="In Progress" desc="Actively working on" />
              <Row icon={<CircleCheck size={I} color={C.green} />} label="Done" desc="Completed" />
              <Row icon={<CircleSlash size={I} color={C.mono} />} label="Won't Do" desc="Intentionally skipped" />
            </Section>

            <Section title="About">
              <Text style={s.aboutText}>
                Tasker — a lightweight task manager.{'\n'}
                This mobile app shares its data layer with the CLI and desktop menu bar app.{'\n\n'}
                Tasks support inline metadata, subtask hierarchies, blocking dependencies, and related task links.
              </Text>
            </Section>

            <UpdateInfo />
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  handleZone: { alignItems: 'center', paddingTop: 12, paddingBottom: 8 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#3f3f46' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: C.text },
  section: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: C.text, marginBottom: 8, letterSpacing: 0.3 },
  sectionDesc: { fontSize: 12, color: C.dim, marginBottom: 8, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1e1e24' },
  rowLabelCol: { flexDirection: 'row', alignItems: 'center', width: 140 },
  rowLabel: { fontSize: 13, color: '#d4d4d8' },
  rowDesc: { flex: 1, fontSize: 12, color: C.muted },
  codeLabel: { width: 140, fontSize: 12, color: C.mono, fontFamily: 'monospace' },
  aboutText: { fontSize: 12, color: C.dim, lineHeight: 18 },
  updateBtn: { marginTop: 12, backgroundColor: C.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  updateBtnText: { fontSize: 13, color: C.blue, fontWeight: '600' },
  updateStatus: { fontSize: 12, color: C.muted, marginTop: 8, textAlign: 'center' },
});
