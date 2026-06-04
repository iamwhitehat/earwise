// Shared category constants — usable from both server and client components
// (no `server-only` import here). Design language matches the dashboard
// system in app/globals.css (cls drives semantic color CSS vars).

export type Category = 'pain_point' | 'feature_request' | 'tool_complaint' | 'other'

export const CATEGORY_ORDER: Category[] = [
  'pain_point',
  'feature_request',
  'tool_complaint',
  'other',
]

export type IconName = 'alert' | 'sparkles' | 'wrench' | 'dots'

export const CATEGORY_CONFIG: Record<
  Category,
  { label: string; short: string; cls: string; icon: IconName }
> = {
  pain_point: {
    label: 'Pain Points',
    short: 'pain point',
    cls: 'pain',
    icon: 'alert',
  },
  feature_request: {
    label: 'Feature Requests',
    short: 'feature request',
    cls: 'feature',
    icon: 'sparkles',
  },
  tool_complaint: {
    label: 'Tool Complaints',
    short: 'tool complaint',
    cls: 'tool',
    icon: 'wrench',
  },
  other: {
    label: 'Other',
    short: 'post',
    cls: 'other',
    icon: 'dots',
  },
}
