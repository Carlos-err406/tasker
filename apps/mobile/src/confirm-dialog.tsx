import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';

const C = { bg: '#09090b', card: '#18181b', border: '#27272a', text: '#fafafa', muted: '#71717a', red: '#ef4444', redBg: 'rgba(239,68,68,0.12)' };

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ visible, title, message, confirmLabel = 'Delete', onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={s.overlay} onPress={onCancel}>
        <Pressable style={s.dialog} onPress={(e) => e.stopPropagation()}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.message}>{message}</Text>
          <View style={s.actions}>
            <Pressable onPress={onCancel} style={s.cancelBtn}>
              <Text style={s.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onConfirm} style={s.confirmBtn}>
              <Text style={s.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  dialog: { backgroundColor: C.card, borderRadius: 16, paddingTop: 24, paddingHorizontal: 24, paddingBottom: 16, width: '100%', maxWidth: 340, borderWidth: 1, borderColor: C.border },
  title: { color: C.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  message: { color: C.muted, fontSize: 14, lineHeight: 20, marginBottom: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, backgroundColor: '#27272a' },
  cancelText: { color: C.muted, fontSize: 14, fontWeight: '500' },
  confirmBtn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, backgroundColor: C.redBg },
  confirmText: { color: C.red, fontSize: 14, fontWeight: '600' },
});
