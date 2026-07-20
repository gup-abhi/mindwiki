import { buildObservations } from '@/services/untangle/evidence'
import { type WikiPage } from '@/services/storage/wiki'
import { type GraphNode, type GraphEdge } from '@/services/storage/graph'

function page(id: string, title: string, content: string): WikiPage {
  return {
    id,
    title,
    category: null,
    content,
    entry_count: 3,
    version: 1,
    version_history: [],
    created_at: 1,
    updated_at: 1,
    dismissed_at: null,
  } as unknown as WikiPage
}

const nodes: GraphNode[] = []
const edges: GraphEdge[] = []

describe('buildObservations', () => {
  it('returns no more than two relevant pages with bounded excerpts', () => {
    const thought = 'I am anxious about my upcoming presentation at work'
    const pages: WikiPage[] = [
      page('p1', 'Work', 'You often feel anxious before presentations at work. The pressure builds before each review meeting.'),
      page('p2', 'Performance', 'Presentations are a recurring stressor. You have noted nerves before every quarterly talk.'),
      page('p3', 'Onboarding', 'First-day onboarding happens occasionally and is mostly uneventful.'),
    ]

    const res = buildObservations(thought, pages, nodes, edges)
    expect(res.observations.length).toBeLessThanOrEqual(2)
    for (const o of res.observations) {
      expect(o.excerpt.length).toBeLessThanOrEqual(600)
    }
  })

  it('links each excerpt to its source page id and title', () => {
    const thought = 'I am anxious about work'
    const pages: WikiPage[] = [page('p1', 'Work', 'You often feel anxious before presentations at work.')]

    const res = buildObservations(thought, pages, nodes, edges)
    const obs = res.observations
    expect(obs[0].pageId).toBe('p1')
    expect(obs[0].title).toBe('Work')
  })

  it('irrelevant pages are absent when nothing meets the relevance floor', () => {
    const thought = 'I am anxious about my upcoming presentation at work'
    const pages: WikiPage[] = [
      page('p9', 'Weather', 'It rains a lot sometimes. The forecast is mild.'),
      page('p10', 'Cooking', 'Pasta is easy to make on weeknights.'),
    ]

    const res = buildObservations(thought, pages, nodes, edges)
    expect(res.observations).toEqual([])
    expect(res.empty).toBe(true)
  })

  it('returns empty state when no wiki pages exist', () => {
    const thought = 'I am anxious about work'
    const res = buildObservations(thought, [], nodes, edges)
    expect(res.observations).toEqual([])
    expect(res.empty).toBe(true)
  })

  it('for a negative thought, ranks counterevidence pages higher than topically similar pages', () => {
    const pages: WikiPage[] = [
      page('p1', 'Work', 'Work deadlines are stressful and hard. I struggle every time.'),
      page('p2', 'Work wins', 'Work deadlines are stressful — but I managed to deliver on time each quarter and it got better.'),
      page('p3', 'Projects', 'Projects run on deadlines. Each one brought new challenges.'),
    ]

    // Negative thought: counterevidence pages have contrastive language
    const res = buildObservations('I am terrible at meeting work deadlines', pages, nodes, edges)
    // The page with contrastive phrasing should rank first
    expect(res.observations[0].pageId).toBe('p2')
    expect(res.observations[0].excerpt).toMatch(/but|managed|better/i)
  })

  it('retains general relevance for neutral thoughts', () => {
    const pages: WikiPage[] = [
      page('p1', 'Work', 'Work deadlines come and go. I handle them okay.'),
      page('p2', 'Hobby', 'I like painting on weekends.'),
    ]

    const res = buildObservations('What do my wiki pages say about work?', pages, nodes, edges)
    // Neutral query — should not bias toward contrastive
    expect(res.empty).toBe(false)
    expect(res.observations[0].pageId).toBe('p1')
  })
})
