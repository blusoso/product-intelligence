export type Platform = 'tiktok' | 'shopee';
export type ProductStatus = 'Active' | 'ซ่อน' | 'รอตรวจ';
export type RelStatus = 'รอตรวจ' | 'อนุมัติ' | 'ซ่อน';
export type JobStatus = 'สำเร็จ' | 'ล้มเหลว' | 'กำลังรัน';

export interface Product {
  id: number; sku: string; ext: string; name: string;
  plat: Platform; cat: string; price: number; cm: number;
  t: number; rel: number; st: ProductStatus; up: string;
  a: string; g: number; sty: string[]; au: string[];
  [key: string]: any;
}
export interface Relation {
  id: number; a: number; b: number; ty: string; c: number;
  ev: string; src: 'Auto' | 'Manual'; st: RelStatus; w: number;
  x: Record<string, string>;
}
export interface Job { t: string; s: string; n: number | string; u: number | string; f: number | string; st: JobStatus; }
export interface Source { id: string; n: string; sub: string; on: boolean; nw: number; up: number; f: number; note: string; p: string; }
export interface Activity { who: 'Admin' | 'ระบบ'; text: string; when: string; }
