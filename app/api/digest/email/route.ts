import type { NextRequest } from 'next/server'
import { sendDigestEmail, isEmailConfigured } from '@/lib/email'
import type { DigestBrief } from '@/lib/digest-types'

// POST /api/digest/email — email the supplied digest brief (the one on screen)
// via Resend, on demand. The weekly cron (/api/cron/run) sends it automatically;
// this is the "email it to me now" button. Returns { sent, configured } — never
// throws, and reports cleanly when email isn't set up so the UI can guide setup.
export async function POST(req: NextRequest) {
  if (!isEmailConfigured()) {
    return Response.json({ sent: false, configured: false })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const brief = (body as { brief?: unknown })?.brief
  if (!brief || typeof brief !== 'object') {
    return Response.json({ error: 'Missing digest brief' }, { status: 400 })
  }

  try {
    const sent = await sendDigestEmail(brief as DigestBrief)
    return Response.json({ sent, configured: true })
  } catch (err) {
    console.error('[digest/email] error:', err)
    return Response.json({ sent: false, configured: true }, { status: 200 })
  }
}
