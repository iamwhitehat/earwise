import { redirect } from 'next/navigation'

// Customer Voice folded into the Voice surface (IA reshape). The body now lives
// in app/_components/customer-voice-view.tsx, rendered by /voice?view=words.
export default function CustomerVoiceRedirect() {
  redirect('/voice?view=words')
}
