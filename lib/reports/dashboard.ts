/** Shape of the jsonb returned by `dashboard_summary` (supabase/migrations/20261112000700_reports.sql). */
export interface DashboardSummary {
  range: { from: string; to: string };
  sales: {
    total_paise: number;
    invoice_count: number;
    average_paise: number;
    tax_paise: number;
    taxable_paise: number;
    discount_paise: number;
    due_paise: number;
  };
  cancelled_count: number;
  credit_notes: { total_paise: number; count: number };
  payment_modes: Array<{ mode: string; amount_paise: number; payment_count: number }>;
  trend: TrendPoint[];
  top_by_revenue: TopProduct[];
  top_by_quantity: TopProduct[];
  sales_by_staff: Array<{ created_by: string | null; name: string; total_paise: number; invoice_count: number }>;
  purchases: { total_paise: number; count: number };
  low_stock: {
    count: number;
    items: Array<{ id: string; name: string; threshold: number; unit_code: string; quantity: number }>;
  };
  shipments: {
    pending_count: number;
    stuck_days: number;
    stuck_count: number;
    stuck: Array<{
      id: string;
      recipient_name: string;
      tracking_number: string | null;
      status: string;
      shipped_on: string;
      days_open: number;
    }>;
  };
  recent_cancellations: Array<{
    id: string;
    invoice_number: string;
    total_paise: number;
    cancel_reason: string | null;
    cancelled_at: string | null;
  }>;
  recent_credit_notes: Array<{
    id: string;
    invoice_id: string;
    credit_note_number: string;
    total_paise: number;
    reason: string | null;
    created_at: string;
  }>;
  failed_notifications: number;
}

export interface TrendPoint {
  day: string;
  total_paise: number;
  invoice_count: number;
}

export interface TopProduct {
  name: string;
  revenue_paise: number;
  quantity: number;
}
