import { useState, useEffect } from 'react';
import { View, Text, TextInput, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Minus, X } from 'lucide-react-native';
import { TaskStatus } from '@tasker/core/types';
import type { Task } from '@tasker/core/types';
import { getDisplayDescription } from '@tasker/core/parsers';
import { useTaskStore } from '../../src/store-context';

const C = { bg: '#09090b', border: '#27272a', text: '#fafafa', muted: '#71717a', dim: '#52525b', green: '#4ade80', amber: '#fbbf24', zinc400: '#a1a1aa' };

function getTitle(task: Task): string {
  return getDisplayDescription(task.description).split('\n')[0]!;
}

export default function SearchScreen() {
  const store = useTaskStore();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => store.setSearch(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.searchBar}>
        <TextInput value={query} onChangeText={setQuery} placeholder="Search... (tag:ui status:done)" placeholderTextColor={C.dim} style={s.input} autoCorrect={false} autoCapitalize="none" />
      </View>
      {query.trim() && store.tasks.length === 0 ? (
        <View style={s.center}><Text style={{ color: C.muted }}>No results for "{query}"</Text></View>
      ) : (
        <FlatList data={store.tasks} keyExtractor={i => i.id} renderItem={({ item }) => {
          const done = item.status === TaskStatus.Done;
          const wontDo = item.status === TaskStatus.WontDo;
          const inProg = item.status === TaskStatus.InProgress;
          return (
            <Pressable style={s.row} onPress={() => store.toggleStatus(item.id, item.status)}>
              <View style={[s.cb, done && s.cbDone, wontDo && s.cbWontDo, inProg && s.cbInProg]}>
                {done && <Check size={14} color={C.green} />}
                {wontDo && <X size={14} color={C.zinc400} />}
                {inProg && <Minus size={14} color={C.amber} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.title, (done || wontDo) && s.done]} numberOfLines={1}>{getTitle(item)}</Text>
                <Text style={s.sub}>{item.listName}</Text>
              </View>
            </Pressable>
          );
        }} />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  searchBar: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  input: { backgroundColor: '#27272a', color: C.text, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  cb: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: '#52525b', alignItems: 'center', justifyContent: 'center' },
  cbDone: { borderColor: C.green, backgroundColor: 'rgba(74,222,128,0.15)' },
  cbWontDo: { borderColor: '#71717a', backgroundColor: 'rgba(113,113,122,0.15)' },
  cbInProg: { borderColor: C.amber, backgroundColor: 'rgba(251,191,36,0.15)' },
  title: { fontSize: 14, color: C.text },
  done: { color: C.muted, textDecorationLine: 'line-through' },
  sub: { fontSize: 10, color: C.dim },
});
