import type { Product } from './types';
export const now = () => {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};
export const norm = (s: unknown) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
export const pn = (arr: Product[], id: number) => arr.find(x => x.id === id);
