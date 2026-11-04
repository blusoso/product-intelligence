'use client';
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Product, Relation, Job, Source, Activity, ProductStatus } from './types';
import { initialProducts, initialRelations, initialJobs, initialSources, initialActivity } from './data';
import { now } from './utils';

type Modal =
  | { kind: 'none' }
  | { kind: 'product'; id?: number }
  | { kind: 'import' }
  | { kind: 'delete'; id: number }
  | { kind: 'bulkDelete' }
  | { kind: 'relAdd' };

interface Ctx {
  products: Product[]; setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  relations: Relation[]; setRelations: React.Dispatch<React.SetStateAction<Relation[]>>;
  jobs: Job[]; setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  sources: Source[]; setSources: React.Dispatch<React.SetStateAction<Source[]>>;
  activity: Activity[]; pushActivity: (who: 'Admin' | 'ระบบ', text: string) => void;
  sel: Set<number>; setSel: React.Dispatch<React.SetStateAction<Set<number>>>;
  q: string; setQ: (s: string) => void;
  modal: Modal; setModal: (m: Modal) => void;
  theme: 'light' | 'dark'; toggleTheme: () => void;
  toast: string | null; showToast: (s: string) => void;
  apiKey: string; regenKey: () => void;
  refreshFromServer: () => Promise<{ count: number }>;
}

const C = createContext<Ctx | null>(null);
export const useApp = () => { const v = useContext(C); if (!v) throw new Error('no ctx'); return v; };

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [relations, setRelations] = useState<Relation[]>(initialRelations);
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [sources, setSources] = useState<Source[]>(initialSources);
  const [activity, setActivity] = useState<Activity[]>(initialActivity);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<Modal>({ kind: 'none' });
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [toast, setToast] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string>('pi_live_init');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => { setApiKey('pi_live_' + Math.random().toString(36).slice(2, 14)); }, []);
  useEffect(() => { document.documentElement.dataset.pi = theme; }, [theme]);

  // initial load from server
  useEffect(() => {
    fetch('/api/products')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (j && Array.isArray(j.products) && j.products.length) setProducts(j.products);
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
  }, []);

  // ✅ ลบ autosave effect ออกแล้ว
  // เพราะทุก action (updateStatus, bulkUpdateStatus, hideOne, Modal) 
  // เรียก API โดยตรงอยู่แล้ว + autosave ทำให้ข้อมูลจาก ingestion หาย

  const refreshFromServer = useCallback(async () => {
    const r = await fetch('/api/products', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (Array.isArray(j.products)) {
      setProducts(j.products);
      return { count: j.products.length };
    }
    throw new Error('bad response');
  }, []);

  // auto-refresh on tab visibility back
  useEffect(() => {
    if (!hydrated) return;
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        refreshFromServer().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [hydrated, refreshFromServer]);

  const showToast = useCallback((s: string) => {
    setToast(s);
    setTimeout(() => setToast(null), 2300);
  }, []);
  const pushActivity = useCallback((who: 'Admin' | 'ระบบ', text: string) => {
    setActivity(a => [{ who, text, when: 'เมื่อกี้' }, ...a].slice(0, 6));
  }, []);
  const toggleTheme = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), []);
  const regenKey = useCallback(() => {
    setApiKey('pi_live_' + Math.random().toString(36).slice(2, 14));
  }, []);

  const val = useMemo<Ctx>(() => ({
    products, setProducts, relations, setRelations,
    jobs, setJobs, sources, setSources, activity, pushActivity,
    sel, setSel, q, setQ, modal, setModal,
    theme, toggleTheme, toast, showToast, apiKey, regenKey,
    refreshFromServer,
  }), [products, relations, jobs, sources, activity, sel, q, modal, theme, toast, apiKey, refreshFromServer]);

  return <C.Provider value={val}>{children}</C.Provider>;
}

export function usePending() {
  const { products, relations, jobs } = useApp();
  return {
    products: products.filter(x => x.st === 'รอตรวจ').length,
    relations: relations.filter(x => x.st === 'รอตรวจ').length,
    jobs: jobs.filter(x => x.st === 'ล้มเหลว').length,
  };
}

export const statusClass = (s: ProductStatus) =>
  s === 'Active' ? 't-lime' : s === 'ซ่อน' ? 't-mut' : 't-amb';

export const timeNow = now;