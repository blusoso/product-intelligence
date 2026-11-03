export type Severity = 'critical' | 'warning' | 'info';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  count: number;
  samples: any[];
  auto_fixable: boolean;
}

export interface AuditSection {
  id: string;
  title: string;
  icon: string;
  findings: Finding[];
}

export interface AuditReport {
  generated_at: string;
  source: string;
  total: number;
  score: number;
  summary: { critical: number; warning: number; info: number };
  sections: AuditSection[];
}

export interface CleanChange {
  product_index: number;
  product_id: any;
  field: string;
  before: any;
  after: any;
  rule: string;
}

export interface DroppedRecord {
  product_id: any;
  name: string;
  reason: string;
  original: any;
}

export interface PipelineResult {
  input_count: number;
  output_count: number;
  dropped: DroppedRecord[];
  changes: CleanChange[];
  report_before: AuditReport;
  report_after: AuditReport;
  products: any[];
  elapsed_ms: number;
}