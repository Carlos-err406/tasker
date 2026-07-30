import { useState, useCallback, useEffect, memo, useMemo } from 'react';
import { View, Text, Pressable, TextInput, RefreshControl, StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Minus, X, ChevronDown, Plus, Eye, EyeOff, Undo2, Redo2, ChevronsUp, ChevronUp, ChevronDown as ChevronDownIcon, Send, ChevronsDownUp, ArrowUpDown, Info, Trash2, CornerLeftUp, CornerRightDown, Ban, Link2, Calendar } from 'lucide-react-native';
import { TaskStatus, Priority } from '@tasker/core/types';
import type { Task } from '@tasker/core/types';
import { getDisplayDescription, parseTaskDescription } from '@tasker/core/parsers';
import { useTaskStore } from '../../src/store-context';
import { ConfirmDialog } from '../../src/confirm-dialog';
import { HelpPanel } from '../../src/help-panel';
import { EditSheet } from '../../src/edit-sheet';
import { SwipeAction } from '../../src/swipe-action';
import { powerSyncDb } from '../../src/db';
import { Markdown } from '../../src/markdown';

const C = { bg: '#09090b', card: '#18181b', border: '#27272a', text: '#fafafa', muted: '#71717a', dim: '#52525b', green: '#4ade80', amber: '#fbbf24', red: '#ef4444', blue: '#3b82f6', orange: '#f97316', zinc400: '#a1a1aa' };

function StatusIcon({ status }: { status: number }) {
  if (status === TaskStatus.Pending) return null;
  if (status === TaskStatus.InProgress) return <Minus size={9} color={C.amber} />;
  if (status === TaskStatus.Done) return <Check size={9} color={C.green} />;
  if (status === 3 /* WontDo */) return <X size={9} color={C.muted} />;
  return null;
}

function RelBadgeText({ id, label, details, color }: { id: string; label: string; details: Record<string, { title: string; status: number }>; color?: string }) {
  const d = details[id];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flex: 1 }}>
      <Text style={[{ fontSize: 10, color: color ?? C.muted, fontFamily: 'monospace' }]}>
        {label} ({id}) {d?.title ?? ''}
      </Text>
      {d != null && <StatusIcon status={d.status} />}
    </View>
  );
}

function getTitle(task: Task): string {
  return getDisplayDescription(task.description).split('\n')[0]!;
}

function getDescriptionPreview(task: Task): string | null {
  const display = getDisplayDescription(task.description);
  const lines = display.split('\n');
  if (lines.length <= 1) return null;
  const rest = lines.slice(1);
  let start = 0;
  while (start < rest.length && rest[start]!.trim() === '') start++;
  let end = rest.length - 1;
  while (end >= start && rest[end]!.trim() === '') end--;
  if (start > end) return null;
  return rest.slice(start, end + 1).join('\n');
}

const TaskItem = memo(function TaskItem({ task, onToggle, onDelete, onEdit }: { task: Task; onToggle: (id: string, s: TaskStatus) => void; onDelete: (id: string) => void; onEdit: (id: string) => void }) {
  const done = task.status === TaskStatus.Done;
  const wontDo = task.status === TaskStatus.WontDo;
  const inProg = task.status === TaskStatus.InProgress;
  const terminal = done || wontDo;
  const pColor = task.priority === Priority.High ? C.red : task.priority === Priority.Medium ? C.orange : task.priority === Priority.Low ? C.blue : undefined;
  const preview = getDescriptionPreview(task);
  const parsed = parseTaskDescription(task.description);

  // Fetch titles + statuses for referenced task IDs
  const [relDetails, setRelDetails] = useState<Record<string, { title: string; status: number }>>({});
  const refIds = [parsed.parentId, ...(parsed.hasSubtaskIds ?? []), ...(parsed.blocksIds ?? []), ...(parsed.blockedByIds ?? []), ...(parsed.relatedIds ?? [])].filter(Boolean) as string[];
  useEffect(() => {
    if (refIds.length === 0) return;
    const placeholders = refIds.map(() => '?').join(',');
    powerSyncDb.getAll<any>(`SELECT id, description, status FROM tasks WHERE id IN (${placeholders})`, refIds).then(rows => {
      const details: Record<string, { title: string; status: number }> = {};
      for (const r of rows) {
        details[r.id] = { title: getDisplayDescription(r.description).split('\n')[0]!, status: r.status };
      }
      setRelDetails(details);
    });
  }, [task.description]);

  return (
    <SwipeAction onSwipe={() => onDelete(task.id)} direction="left" icon={<Trash2 size={18} color="#fff" />} label="Delete" color={C.red}>
    <Pressable style={s.taskRow} onPress={() => onEdit(task.id)}>
      {/* Checkbox + ID column (like desktop) */}
      <View style={s.checkboxCol}>
        <Pressable onPress={() => onToggle(task.id, task.status)} style={[s.checkbox, done && s.cbDone, wontDo && s.cbWontDo, inProg && s.cbInProg]}>
          {done && <Check size={14} color={C.green} />}
          {wontDo && <X size={14} color={C.zinc400} />}
          {inProg && <Minus size={14} color={C.amber} />}
        </Pressable>
        <Text style={s.taskId}>{task.id.slice(0, 3)}</Text>
      </View>

      {/* Content column */}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {pColor && task.priority === Priority.High && <ChevronsUp size={14} color={pColor} />}
          {pColor && task.priority === Priority.Medium && <ChevronUp size={14} color={pColor} />}
          {pColor && task.priority === Priority.Low && <ChevronDownIcon size={14} color={pColor} />}
          <Text style={[s.taskTitle, terminal && s.taskDone]} numberOfLines={2}>{getTitle(task)}</Text>
        </View>

        {/* Description preview (markdown) */}
        {preview && (
          <Markdown content={preview} style={{ marginTop: 3 }} />
        )}

        {/* Relationships */}
        {parsed.parentId && (
          <View style={s.relRow}>
            <CornerLeftUp size={11} color={C.muted} />
            <RelBadgeText id={parsed.parentId} label="Subtask of" details={relDetails} />
          </View>
        )}
        {parsed.hasSubtaskIds?.map(id => (
          <View key={`sub-${id}`} style={s.relRow}>
            <CornerRightDown size={11} color={C.muted} />
            <RelBadgeText id={id} label="Subtask" details={relDetails} />
          </View>
        ))}
        {parsed.blocksIds?.map(id => (
          <View key={`blk-${id}`} style={s.relRow}>
            <Ban size={11} color={C.amber} />
            <RelBadgeText id={id} label="Blocks" details={relDetails} color="rgba(251,191,36,0.7)" />
          </View>
        ))}
        {parsed.blockedByIds?.map(id => (
          <View key={`blkby-${id}`} style={s.relRow}>
            <Ban size={11} color={C.amber} />
            <RelBadgeText id={id} label="Blocked by" details={relDetails} color="rgba(251,191,36,0.7)" />
          </View>
        ))}
        {parsed.relatedIds?.map(id => (
          <View key={`rel-${id}`} style={s.relRow}>
            <Link2 size={11} color="#2dd4bf" />
            <RelBadgeText id={id} label="Related to" details={relDetails} color="rgba(45,212,191,0.7)" />
          </View>
        ))}

        {/* Due date */}
        {task.dueDate && (
          <View style={s.relRow}>
            <Calendar size={11} color={C.muted} />
            <Text style={s.meta}>{task.dueDate}</Text>
          </View>
        )}

        {/* Tags */}
        {task.tags && task.tags.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
            {task.tags.map(t => <View key={t} style={s.tag}><Text style={s.tagText}>#{t}</Text></View>)}
          </View>
        )}
      </View>
    </Pressable>
    </SwipeAction>
  );
});

function InlineInput({ placeholder, onSubmit, onCancel, buttonLabel }: { placeholder: string; onSubmit: (v: string) => void; onCancel: () => void; buttonLabel: string }) {
  const [value, setValue] = useState('');
  const submit = () => { const v = value.trim(); if (v) { onSubmit(v); setValue(''); } };
  return (
    <View style={s.inlineInput}>
      <TextInput value={value} onChangeText={setValue} onSubmitEditing={submit} placeholder={placeholder} placeholderTextColor={C.dim} autoFocus multiline={buttonLabel === 'Add'} style={s.input} />
      <View style={s.inlineActions}>
        <Pressable onPress={onCancel} style={s.inlineCancel}><Text style={{ color: C.muted, fontSize: 13 }}>Cancel</Text></Pressable>
        <Pressable onPress={submit} style={[s.inlineSubmit, !value.trim() && { opacity: 0.4 }]}>
          <Send size={14} color="#fff" />
          <Text style={s.inlineSubmitText}>{buttonLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ListSection({ listName, tasks, collapsed, hideCompleted, isDefault, onToggleCollapsed, onToggleHideCompleted, onToggleStatus, onDelete, onAdd, onDeleteList, onEdit }: { listName: string; tasks: Task[]; collapsed: boolean; hideCompleted: boolean; isDefault: boolean; onToggleCollapsed: () => void; onToggleHideCompleted: () => void; onToggleStatus: (id: string, s: TaskStatus) => void; onDelete: (id: string) => void; onAdd: (desc: string, list: string) => void; onDeleteList: (name: string) => void; onEdit: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [confirmDeleteList, setConfirmDeleteList] = useState(false);
  const doneCount = tasks.filter(t => t.status === TaskStatus.Done || t.status === TaskStatus.WontDo).length;

  const rotation = useSharedValue(collapsed ? -90 : 0);
  useEffect(() => {
    rotation.value = withTiming(collapsed ? -90 : 0, { duration: 200 });
  }, [collapsed]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View style={s.section}>
      <ConfirmDialog visible={confirmDeleteList} title="Delete list?" message={`"${listName}" and all its tasks will be deleted.`} onConfirm={() => { setConfirmDeleteList(false); onDeleteList(listName); }} onCancel={() => setConfirmDeleteList(false)} />
      <Pressable style={s.sectionHeader} onPress={onToggleCollapsed} onLongPress={!isDefault ? () => setConfirmDeleteList(true) : undefined}>
        <Animated.View style={chevronStyle}><ChevronDown size={14} color={C.muted} /></Animated.View>
        <Text style={s.sectionTitle}>{listName}</Text>
        <Text style={s.sectionCount}>{tasks.length} task{tasks.length !== 1 ? 's' : ''}</Text>
        {doneCount > 0 && <Pressable onPress={onToggleHideCompleted} style={s.iconBtn}>{hideCompleted ? <EyeOff size={14} color={C.muted} /> : <Eye size={14} color={C.muted} />}</Pressable>}
        <Pressable onPress={() => setAdding(true)} style={s.iconBtn}><Plus size={16} color={C.muted} /></Pressable>
      </Pressable>
      {adding && (
        <InlineInput placeholder="New task... (p1, @date, #tag)" buttonLabel="Add" onSubmit={(v) => { onAdd(v, listName); setAdding(false); }} onCancel={() => setAdding(false)} />
      )}
    </View>
  );
}

export default function ListsScreen() {
  const store = useTaskStore();
  const [refreshing, setRefreshing] = useState(false);
  const [creatingList, setCreatingList] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    store.refresh();
    store.showStatus('Refreshed');
    setRefreshing(false);
  }, [store.refresh]);

  // Build flat data array for FlashList: [header, task, task, ..., header, task, ...]
  type FlatItem = { type: 'header'; name: string } | { type: 'task'; task: Task };
  const flatData = useMemo(() => {
    const items: FlatItem[] = [];
    for (const name of store.lists) {
      items.push({ type: 'header', name });
      if (!store.collapsedLists.has(name)) {
        const tasks = store.tasksByList[name] ?? [];
        const hideCompleted = store.hideCompletedLists.has(name);
        const visible = hideCompleted
          ? tasks.filter(t => t.status !== TaskStatus.Done && t.status !== TaskStatus.WontDo)
          : tasks;
        for (const task of visible) {
          items.push({ type: 'task', task });
        }
      }
    }
    return items;
  }, [store.lists, store.tasksByList, store.collapsedLists, store.hideCompletedLists]);

  if (store.loading) return <SafeAreaView style={s.root} edges={['top']}><View style={s.center}><Text style={{ color: C.muted }}>Loading...</Text></View></SafeAreaView>;

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <HelpPanel visible={showHelp} onClose={() => setShowHelp(false)} />
      <EditSheet taskId={editingTaskId} onClose={() => setEditingTaskId(null)} onRefresh={store.refresh} />
      <View style={s.header}>
        <Text style={s.headerTitle}>Tasker</Text>
        <Pressable onPress={store.undo} style={s.headerBtn}><Undo2 size={17} color={C.muted} /></Pressable>
        <Pressable onPress={store.redo} style={s.headerBtn}><Redo2 size={17} color={C.muted} /></Pressable>
        <Pressable onPress={store.toggleCollapseAll} style={s.headerBtn}><ChevronsDownUp size={17} color={C.muted} /></Pressable>
        <Pressable onPress={store.applySystemSort} style={s.headerBtn}><ArrowUpDown size={17} color={C.muted} /></Pressable>
        <Pressable onPress={() => setCreatingList(true)} style={s.headerBtn}><Plus size={17} color={C.muted} /></Pressable>
        <Pressable onPress={() => setShowHelp(v => !v)} style={s.headerBtn}><Info size={17} color={showHelp ? C.blue : C.muted} /></Pressable>
      </View>
      {creatingList && (
        <InlineInput placeholder="List name..." buttonLabel="Create" onSubmit={(v) => { store.createList(v); setCreatingList(false); }} onCancel={() => setCreatingList(false)} />
      )}
      <FlashList
        data={flatData}
        renderItem={({ item }) => {
          if (item.type === 'header') {
            return (
              <ListSection
                key={item.name}
                listName={item.name}
                tasks={store.tasksByList[item.name] ?? []}
                collapsed={store.collapsedLists.has(item.name)}
                hideCompleted={store.hideCompletedLists.has(item.name)}
                isDefault={item.name === store.defaultList}
                onToggleCollapsed={() => store.toggleCollapsed(item.name)}
                onToggleHideCompleted={() => store.toggleHideCompleted(item.name)}
                onToggleStatus={store.toggleStatus}
                onDelete={store.deleteTask}
                onAdd={store.addTask}
                onDeleteList={store.deleteList}
                onEdit={setEditingTaskId}
              />
            );
          }
          return <TaskItem task={item.task} onToggle={store.toggleStatus} onDelete={store.deleteTask} onEdit={setEditingTaskId} />;
        }}
        getItemType={(item) => item.type}
        keyExtractor={(item) => item.type === 'header' ? `h-${item.name}` : item.task.id}
        drawDistance={300}
        keyboardShouldPersistTaps="handled"
        refreshing={refreshing}
        onRefresh={onRefresh}
        extraData={store.collapsedLists}
      />
      <View style={s.statusBar}>
        <Text style={s.statusText}>{store.statusMessage || `${store.pendingCount} pending, ${store.totalCount} total`}</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: C.text, flex: 1 },
  headerBtn: { padding: 8 },
  section: { borderBottomWidth: 1, borderBottomColor: C.border },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.card },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: C.text, flex: 1 },
  sectionCount: { fontSize: 10, color: C.muted },
  iconBtn: { padding: 4 },
  // Inline input (shared by add task + create list)
  inlineInput: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: '#0f0f12' },
  input: { backgroundColor: '#27272a', color: C.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  inlineActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  inlineCancel: { paddingVertical: 8, paddingHorizontal: 12 },
  inlineSubmit: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.blue, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  inlineSubmitText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  // Task row
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  checkboxCol: { alignItems: 'center', marginTop: 1 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: '#52525b', alignItems: 'center', justifyContent: 'center' },
  cbDone: { borderColor: C.green, backgroundColor: 'rgba(74,222,128,0.15)' },
  cbWontDo: { borderColor: '#71717a', backgroundColor: 'rgba(113,113,122,0.15)' },
  cbInProg: { borderColor: C.amber, backgroundColor: 'rgba(251,191,36,0.15)' },
  taskId: { fontSize: 9, color: '#3f3f46', marginTop: 3, fontFamily: 'monospace' },
  taskTitle: { fontSize: 14, color: C.text, flex: 1 },
  taskDone: { color: C.muted, textDecorationLine: 'line-through' },
  descPreview: { fontSize: 12, color: C.dim, marginTop: 3, lineHeight: 16 },
  relRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  relText: { fontSize: 10, color: C.muted, fontFamily: 'monospace' },
  meta: { fontSize: 10, color: C.muted },
  tag: { backgroundColor: 'rgba(59,130,246,0.15)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  tagText: { fontSize: 10, color: '#93c5fd' },
  empty: { color: C.dim, fontSize: 12, textAlign: 'center', paddingVertical: 16 },
  statusBar: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(24,24,27,0.8)', borderTopWidth: 1, borderTopColor: C.border },
  statusText: { fontSize: 10, color: C.muted },
});
