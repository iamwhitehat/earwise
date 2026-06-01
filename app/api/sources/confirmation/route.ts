import { getSupabase } from '@/lib/supabase'
import { crossSourceConfirmation } from '@/lib/sources/confirmation'

// GET /api/sources/confirmation — canonical topic → distinct sources that
// mention it. Used to show "confirmed in N sources" on opportunity cards.
// Empty object when the signals table isn't migrated yet.
export async function GET() {
  let db
  try {
    db = getSupabase()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Configuration error' },
      { status: 500 }
    )
  }

  const confirmation = await crossSourceConfirmation(db)
  return Response.json({ confirmation })
}
