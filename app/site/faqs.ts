// Shared so the marketing page renders them AND the server layout can emit
// FAQPage JSON-LD (rich results) from the same source.
export const FAQS: { q: string; a: string }[] = [
  {
    q: 'What exactly does earwise do?',
    a: 'It watches the subreddits where your buyers talk, reads and classifies every post (pain point, feature request, tool complaint), then rolls them into ranked opportunities, live trends, the exact phrases buyers use, and high-intent threads — each with a drafted reply. In short: it turns public demand into your next move.',
  },
  {
    q: 'Is this just keyword alerts?',
    a: 'No. Keyword alerts dump every mention in your lap. earwise reads intent — it tells you which threads actually signal demand, scores them, spots when a topic is heating up, and drafts a grounded reply. You get the move, not the noise.',
  },
  {
    q: 'Where does the data come from?',
    a: 'Public Reddit threads in the subreddits you choose to watch. Every insight links straight back to the source post, so you can always read the evidence yourself — nothing is invented or black-boxed.',
  },
  {
    q: 'Will my replies look like spam?',
    a: "Not if you use earwise the way it's built. Drafts are grounded in the person's actual post and written helpful-first. You always edit and post yourself — earwise gets you to a thoughtful first draft in seconds, it doesn't auto-blast anything.",
  },
  {
    q: 'Do I need a big audience or budget?',
    a: 'No. earwise is built for solo founders and small teams. Start on the free plan with three subreddits and your first scan runs in about a minute.',
  },
  {
    q: 'Can I export what I find?',
    a: 'Yes — signals, buyer language, and trends export to Markdown and CSV on Pro and above, so the insight lives wherever you already work.',
  },
]
