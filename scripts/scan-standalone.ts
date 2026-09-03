// CLI front-end for the demand scan. All logic lives in scan-core.ts, which the
// dashboard server shares.
//
//   npx tsx scripts/scan-standalone.ts
//   SKIP_REDDIT=1 npx tsx scripts/scan-standalone.ts

import { runScan, type ScanOptions } from './scan-core'

const opts: ScanOptions = {
  subreddits: process.env.SKIP_REDDIT === '1' ? [] : ['webdev', 'SaaS', 'selfhosted'],
  hnQueries: ['looking for a tool', 'is there anything that'],
  soQueries: ['recommendation tool'],
  minTopicPosts: Number(process.env.MIN_TOPIC_POSTS ?? 2),
}

runScan(opts, (msg) => console.log('  ' + msg))
  .then((r) => {
    if (r.topics.length) {
      console.log('\n  score  posts  unanswered  tools  topic')
      console.log('  -----  -----  ----------  -----  -----')
      for (const t of r.topics.slice(0, 20)) {
        console.log(
          `  ${t.whitespace.toFixed(3)}  ${String(t.posts).padStart(5)}` +
            `  ${String(t.unanswered).padStart(10)}  ${String(t.distinctTools).padStart(5)}  ${t.topic}`,
        )
      }
    } else {
      console.log(
        `\n  No topic reached ${opts.minTopicPosts} posts (${r.distinctTopics} topics, all below` +
          ` threshold). The whitespace model did not run — collect more before drawing conclusions.`,
      )
    }
    console.log('\n  wrote scan-output/scan.json')
  })
  .catch((e) => {
    console.error('\n  ' + (e as Error).message)
    process.exit(1)
  })
