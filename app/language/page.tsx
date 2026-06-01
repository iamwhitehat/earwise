import { redirect } from 'next/navigation'

// Buyer Language was renamed to Customer Voice (Phase 8 IA reposition).
// Keep the old path working for bookmarks / shared links.
export default function LanguageRedirect() {
  redirect('/customer-voice')
}
