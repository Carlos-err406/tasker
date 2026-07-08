import { useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Undo2, Trash2 } from 'lucide-react-native';
import type { Task } from '@tasker/core/types';
import { getDisplayDescription } from '@tasker/core/parsers';
import { useTaskStore } from '../../src/store-context';
import { SwipeAction } from '../../src/swipe-action';

const C = { bg: '#09090b', border: '#27272a', text: '#fafafa', muted: '#71717a', dim: '#52525b', zinc400: '#a1a1aa', green: '#22c55e' };

function getTitle(task: Task): string {
  return getDisplayDescription(task.description).split('\n')[0]!;
}

export default function TrashScreen() {
  const store = useTaskStore();
  const [items, setItems] = useState<Task[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadTrash = useCallback(async () => {
    const trash = await store.getTrashItems();
    setItems(trash);
  }, [store.getTrashItems]);

  useFocusEffect(
    useCallback(() => {
      loadTrash();
    }, [loadTrash]),
  );

  const onRefresh = async () => { setRefreshing(true); await loadTrash(); setRefreshing(false); };

  const restore = useCallback(async (id: string) => {
    await store.restoreTask(id);
    setTimeout(() => loadTrash(), 50);
  }, [store, loadTrash]);

  const empty = async () => { await store.clearTrash(); await loadTrash(); };

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <Trash2 size={18} color={C.muted} />
        <Text style={s.headerTitle}>Trash</Text>
        <Text style={s.count}>{items.length} item{items.length !== 1 ? 's' : ''}</Text>
        {items.length > 0 && <Pressable onPress={empty} style={s.emptyBtn}><Text style={s.emptyText}>Empty trash</Text></Pressable>}
      </View>
      {items.length === 0 ? (
        <View style={s.center}><Text style={{ color: C.muted }}>Trash is empty</Text></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.muted} />}
          renderItem={({ item }) => (
            <SwipeAction
              onSwipe={() => restore(item.id)}
              direction="right"
              icon={<Undo2 size={18} color="#fff" />}
              label="Restore"
              color={C.green}
            >
              <View style={s.row}>
                <View style={s.checkboxCol}>
                  <View style={s.trashIcon}>
                    <Trash2 size={12} color={C.dim} />
                  </View>
                  <Text style={s.taskId}>{item.id.slice(0, 3)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.title} numberOfLines={2}>{getTitle(item)}</Text>
                  <Text style={s.sub}>{item.listName}</Text>
                </View>
              </View>
            </SwipeAction>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 48, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border, gap: 8 },
  headerTitle: { fontSize: 14, fontWeight: '600', color: C.text, flex: 1 },
  count: { fontSize: 10, color: C.muted },
  emptyBtn: { backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  emptyText: { fontSize: 12, color: '#f87171' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  checkboxCol: { alignItems: 'center', marginTop: 1 },
  trashIcon: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: '#3f3f46', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(63,63,70,0.15)' },
  taskId: { fontSize: 9, color: '#3f3f46', marginTop: 3, fontFamily: 'monospace' },
  title: { fontSize: 14, color: C.muted, textDecorationLine: 'line-through' },
  sub: { fontSize: 10, color: C.dim, marginTop: 2 },
});
