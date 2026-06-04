import { redirect } from 'next/navigation'

// Buyer Language → Customer Voice → now the Voice surface's Words tab.
// Keep the old path working for bookmarks / shared links.
export default function LanguageRedirect() {
  redirect('/voice?view=words')
}
