import { auditProducts } from './audit';
import { cleanProduct } from './clean';
import { normalizeProduct } from './normalize';
import type { PipelineResult, DroppedRecord, CleanChange } from './types';

export function runPipeline(products: any[], source = 'products.json'): PipelineResult {
  const start = Date.now();
  const report_before = auditProducts(products, `${source} (before)`);

  const dropped: DroppedRecord[] = [];
  const changes: CleanChange[] = [];
  const cleaned: any[] = [];
  const seenIds = new Set<string>();

  products.forEach((p, i) => {
    const pid = p.product_id ?? p.ext?.split(':').pop() ?? p.id;
    const name = String(p.name ?? '').trim();
    const price = Number(p.price);

    if (!name) {
      dropped.push({ product_id: pid, name, reason: 'empty name', original: p });
      return;
    }
    if (!pid) {
      dropped.push({ product_id: pid, name: name.slice(0, 40), reason: 'missing product_id', original: p });
      return;
    }
    if (!price || price <= 0 || isNaN(price)) {
      dropped.push({ product_id: pid, name: name.slice(0, 40), reason: 'invalid price', original: p });
      return;
    }
    if (seenIds.has(String(pid))) {
      dropped.push({ product_id: pid, name: name.slice(0, 40), reason: 'duplicate product_id', original: p });
      return;
    }
    seenIds.add(String(pid));

    const { cleaned: c, changes: ch } = cleanProduct(p, i);
    changes.push(...ch);
    cleaned.push(normalizeProduct(c));
  });

  const report_after = auditProducts(cleaned, `${source} (after)`);

  return {
    input_count: products.length,
    output_count: cleaned.length,
    dropped,
    changes,
    report_before,
    report_after,
    products: cleaned,
    elapsed_ms: Date.now() - start,
  };
}