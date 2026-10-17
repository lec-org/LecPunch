import { create } from 'zustand';
import type { User } from '@lecpunch/shared';

interface AuthSnapshot {
  token: string | null;
  user: User | null;
}

export interface AuthStoreState {
  auth: AuthSnapshot;
  authInitializing: boolean;
  sessionError: string | null;
  retrySession: number;
  setSessionError: (error: string | null) => void;
  retrySessionRestore: () => void;
  setAuth: (payload: AuthSnapshot) => void;
  updateUser: (patch: Partial<User>) => void;
  setAuthInitializing: (value: boolean) => void;
  logout: () => void;
}

const EMPTY_AUTH: AuthSnapshot = { token: null, user: null };

export const useAuthStore = create<AuthStoreState>((set) => ({
  auth: EMPTY_AUTH,
  authInitializing: true,
  sessionError: null, retrySession: 0,
  setSessionError: (sessionError) => set({ sessionError }),
  retrySessionRestore: () => set(state => ({ retrySession: state.retrySession + 1, sessionError: null })),
  setAuth: (payload) => set({ auth: payload }),
  updateUser: (patch) =>
    set((state) => ({
      auth: {
        ...state.auth,
        user: state.auth.user ? { ...state.auth.user, ...patch } : null
      }
    })),
  setAuthInitializing: (value) => set({ authInitializing: value }),
  logout: () => set({ auth: EMPTY_AUTH })
}));
