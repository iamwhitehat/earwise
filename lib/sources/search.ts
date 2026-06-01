// Search-volume connector (keyword demand proxy) — scaffold.
// A real implementation would hit a search-trends / keyword API; for now it's
// a stub behind the SourceConnector interface so ingestion is drop-in.
import type { SourceConnector } from './types'

export const searchConnector: SourceConnector = {
  id: 'search',
  async search() {
    // TODO: integrate a search-volume / keyword-demand source.
    return []
  },
}
