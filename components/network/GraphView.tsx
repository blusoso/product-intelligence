'use client';

import { useMemo, useState } from 'react';
import { Ic } from '@/components/icons';
import { cols, nf, short, type GraphEdge, type GraphNode, type GraphPayload } from './shared';

const NODE_COLOR: Record<string, string> = {
  product: '#7FA83A',
  variant: '#9DBB6A',
  shop: '#6C5CE7',
  brand: '#FF8F5E',
  category: '#0E9F8E',
  product_type: '#3B82C4',
  province: '#B9A9FF',
  region: '#E8A33D',
  use_case: '#D9557A',
  function: '#8E7CC3',
  context: '#2FA8A0',
  style: '#C39B2E',
  space: '#5E9E5E',
  audience: '#D96BA0',
  price_segment: '#9C6B3F',
  ai_attribute: '#B05BD0',
};

const NODE_RING: Record<string, number> = {
  region: 78,
  category: 132,
  product_type: 196,
  brand: 252,
  province: 316,
  shop: 372,
  product: 436,
  variant: 500,
  price_segment: 40,
  use_case: 56,
  function: 68,
  context: 90,
  style: 106,
  space: 120,
  audience: 134,
  ai_attribute: 60,
};

const NODE_LABEL: Record<string, string> = {
  product: 'สินค้า',
  variant: 'ตัวเลือก',
  shop: 'ร้านค้า',
  brand: 'แบรนด์',
  category: 'หมวด',
  product_type: 'ประเภท',
  province: 'จังหวัด',
  region: 'ภาค',
  use_case: 'use case',
  function: 'ฟังก์ชัน',
  context: 'บริบท',
  style: 'สไตล์',
  space: 'พื้นที่',
  audience: 'กลุ่มผู้ใช้',
  price_segment: 'ช่วงราคา',
  ai_attribute: 'AI อนุมาน',
};

type Point = { x: number; y: number };

export function GraphView({
  graph,
  loading,
  error,
  onBuild,
  building,
  compact = false,
}: {
  graph: GraphPayload | null;
  loading?: boolean;
  error: string | null;
  onBuild: () => void;
  building: boolean;
  compact?: boolean;
}) {
  const [openNodes, setOpenNodes] = useState<Record<string, boolean>>({ product: true, shop: true });

  const layout = useMemo(() => {
    if (!graph) {
      return { points: new Map<string, Point>(), visibleNodes: [] as GraphNode[], visibleEdges: [] as GraphEdge[] };
    }
    const visibleNodes = graph.nodes.filter((n) => (openNodes[n.type] ?? true) && (!compact || n.type !== 'product'));
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = graph.edges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
    );

    const groups = new Map<string, GraphNode[]>();
    for (const n of visibleNodes) {
      const list = groups.get(n.type) ?? [];
      list.push(n);
      groups.set(n.type, list);
    }

    const points = new Map<string, Point>();
    const cx = 450;
    const cy = 450;
    for (const [type, list] of groups) {
      const r = NODE_RING[type] ?? 420;
      const offset = (type.charCodeAt(0) % 7) * 0.09;
      list.forEach((n, i) => {
        const angle = (i / Math.max(1, list.length)) * Math.PI * 2 + offset;
        points.set(n.id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
      });
    }
    return { points, visibleNodes, visibleEdges };
  }, [graph, openNodes, compact]);

  if (!graph) {
    return (
      <div className="card" style={{ alignItems: 'flex-start' }}>
        <h3>{error ? 'ยังไม่มีกราฟ' : 'กำลังโหลดกราฟ…'}</h3>
        <div className="m">{error ?? 'กราฟจะถูกสร้างและบันทึกเป็น snapshot ให้อัตโนมัติ'}</div>
        <button className="btn" onClick={onBuild} disabled={building || loading} style={{ alignSelf: 'flex-start' }}>
          <Ic n="nodes" s={17} /> {building ? 'กำลังสร้าง…' : 'สร้างกราฟและบันทึก'}
        </button>
      </div>
    );
  }

  const stats = graph.stats;
  const typeCounts = stats.by_node_type ?? {};
  const edgeCounts = stats.by_edge_type ?? {};

  return (
    <>
      <div className="g">
        <div className="card" style={{ flex: '2 1 640px' }}>
          <h3>
            <span>โครงข่ายสินค้า</span>
            <span className="m" style={{ fontWeight: 500 }}>
              {nf.format(layout.visibleNodes.length)} nodes · {nf.format(layout.visibleEdges.length)} edges
            </span>
          </h3>
          <div className="chs">
            {Object.keys(NODE_COLOR).map((t) => (
              <button
                key={t}
                className={`ch ${openNodes[t] ?? true ? 'on' : ''}`}
                onClick={() => setOpenNodes((prev) => ({ ...prev, [t]: !(prev[t] ?? true) }))}
              >
                {NODE_LABEL[t] ?? t}
                <span className="m" style={{ marginLeft: 6 }}>
                  {typeCounts[t] ?? 0}
                </span>
              </button>
            ))}
          </div>
          <svg viewBox="0 0 900 900" style={{ width: '100%', height: 'auto', maxHeight: compact ? 420 : 640 }}>
            <circle cx={450} cy={450} r={150} fill="none" stroke="var(--line)" strokeDasharray="4 8" />
            <circle cx={450} cy={450} r={300} fill="none" stroke="var(--line)" strokeDasharray="4 8" />
            {layout.visibleEdges.map((e, i) => {
              const a = layout.points.get(e.source);
              const b = layout.points.get(e.target);
              if (!a || !b) return null;
              const strong =
                e.type === 'similar_to' ||
                e.type === 'substitute' ||
                e.type === 'complements' ||
                e.type === 'same_context' ||
                e.type === 'used_with';
              return (
                <line
                  key={e.id ?? `${e.source}-${e.target}-${i}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={strong ? 'var(--lilT)' : 'var(--line)'}
                  strokeWidth={strong ? 0.9 : 0.6}
                  opacity={strong ? 0.75 : 0.5}
                />
              );
            })}
            {layout.visibleNodes.map((n) => {
              const p = layout.points.get(n.id);
              if (!p) return null;
              const isProduct = n.type === 'product';
              const r = isProduct ? 3.6 : n.type === 'region' ? 8 : 6;
              return (
                <g key={n.id}>
                  <circle cx={p.x} cy={p.y} r={r} fill={NODE_COLOR[n.type] ?? '#888'}>
                    <title>{`${NODE_LABEL[n.type] ?? n.type}: ${n.label}`}</title>
                  </circle>
                  {!isProduct && (
                    <text
                      x={p.x + r + 3}
                      y={p.y + 3.5}
                      fontSize={9}
                      fill="var(--mute)"
                      style={{ pointerEvents: 'none' }}
                    >
                      {short(n.label, 18)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="m" style={{ fontSize: 12 }}>
            เส้นสีม่วง = ความสัมพันธ์เชิงทดแทน/เสริมกัน · เส้นจาง = ความสัมพันธ์เชิงโครงสร้าง (ร้าน หมวด แบรนด์ พื้นที่)
            {typeCounts.ai_attribute ? ' · โหนดสีม่วงเข้ม = ค่าที่ AI อนุมาน (แยกจากหลักฐาน)' : ''}
          </div>
        </div>

        <div className="card" style={{ flex: '1 1 300px' }}>
          <h3>สถิติเครือข่าย</h3>
          {[
            ['Nodes', nf.format(stats.node_count)],
            ['Edges', nf.format(stats.edge_count)],
            ['Components', nf.format(stats.components)],
            ['Isolates', `${nf.format(stats.isolates.length)} (${(stats.isolate_ratio * 100).toFixed(0)}%)`],
            ['Avg degree', stats.avg_degree.toFixed(2)],
            ['Density', stats.density.toFixed(4)],
            ['Clustering', stats.clustering.toFixed(3)],
          ].map(([k, v]) => (
            <div key={k} className="row sp">
              <span className="m">{k}</span>
              <b>{v}</b>
            </div>
          ))}
          <div style={{ height: 1, background: 'var(--line)' }} />
          <h3 style={{ fontSize: 15 }}>Readiness breakdown</h3>
          {Object.entries(stats.readiness_breakdown ?? {}).map(([k, v]) => (
            <div key={k}>
              <div className="row sp" style={{ marginBottom: 4 }}>
                <span className="m">{k}</span>
                <span className="m">{Math.round(v)}%</span>
              </div>
              <div className="bar" style={{ height: 8 }}>
                <i style={{ height: 8, width: `${Math.max(2, Math.min(100, v))}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {!compact && (
        <div className="g">
          <div className="card">
            <h3>Top hubs</h3>
            <div className="tbw">
              <div className="tbl" style={{ minWidth: 420 }}>
                {(stats.top_hubs ?? []).map((h) => (
                  <div key={h.id} className="tr" style={cols('1fr 110px 80px')}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.label}</span>
                    <span className="tg t-mut">{NODE_LABEL[h.type] ?? h.type}</span>
                    <b>{h.degree}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <h3>สัดส่วน edge</h3>
            {Object.entries(edgeCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <div key={k}>
                  <div className="row sp" style={{ marginBottom: 4 }}>
                    <span className="m">{k}</span>
                    <span className="m">{nf.format(v)}</span>
                  </div>
                  <div className="bar" style={{ height: 8 }}>
                    <i
                      style={{
                        height: 8,
                        width: `${Math.max(1, (v / Math.max(1, stats.edge_count)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </>
  );
}
