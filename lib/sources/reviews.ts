// Reviews connector (G2 / Capterra / app stores) — scaffold.
// No public free API exists for these, so this is a stub behind the
// SourceConnector interface: drop in a fetch implementation later and
// ingestion picks it up automatically.
import type { SourceConnector } from './types'

export const reviewsConnector: SourceConnector = {
  id: 'reviews',
  async search() {
    // TODO: integrate a reviews source (G2/Capterra/app-store scrape or API).
    return []
  },
}
