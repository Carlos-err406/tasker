import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from './use-store';

type StoreType = ReturnType<typeof useStore>;

const StoreContext = createContext<StoreType | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useTaskStore(): StoreType {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useTaskStore must be used within StoreProvider');
  return ctx;
}
