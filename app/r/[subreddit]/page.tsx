import PostList from './post-list'

export default async function SubredditPage({
  params,
}: {
  params: Promise<{ subreddit: string }>
}) {
  const { subreddit } = await params
  return <PostList subreddit={subreddit} />
}
