import { ImageResponse } from 'next/og'

// Dynamically-generated social card (lime-on-near-black, the signal-burst mark).
// File-convention: Next serves this at /opengraph-image and wires the meta tags.
export const alt = 'earwise — find buyers on Reddit and reply in your voice'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0E0F13',
          padding: '74px 80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <svg width="48" height="48" viewBox="0 0 256 256">
            <circle cx="96" cy="170" r="15" fill="#B6FF3C" />
            <path d="M135,170 A39,39 0 0 0 96,131" fill="none" stroke="#B6FF3C" strokeWidth="16" strokeLinecap="round" />
            <path d="M167,170 A71,71 0 0 0 96,99" fill="none" stroke="#B6FF3C" strokeWidth="16" strokeLinecap="round" />
            <path d="M199,170 A103,103 0 0 0 96,67" fill="none" stroke="#9BE22A" strokeWidth="16" strokeLinecap="round" />
          </svg>
          <div style={{ fontSize: 38, fontWeight: 700, color: '#ECEFE8', letterSpacing: -1 }}>earwise</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 66, fontWeight: 700, color: '#ECEFE8', lineHeight: 1.08, letterSpacing: -2 }}>
            {"See who's asking to buy"}
          </div>
          <div style={{ fontSize: 66, fontWeight: 700, color: '#B6FF3C', lineHeight: 1.08, letterSpacing: -2 }}>
            {'what you sell — right now.'}
          </div>
        </div>

        <div style={{ fontSize: 27, color: '#9AA0A6' }}>
          {'Free Reddit buyer scan · drafts the reply in your voice · no signup'}
        </div>
      </div>
    ),
    size,
  )
}
