import { gatherMaterial } from '@/services/digest/agents/retriever'
import { type Entry } from '@/services/storage/entries'
import { type GraphNode, type GraphEdge } from '@/services/storage/graph'
import { type WikiPage } from '@/services/storage/wiki'

const entry = (id: string, over: Partial<Entry> = {}): Entry => ({
  id,
  created_at: 0,
  mood: 3,
  situation: 'something happened',
  thought: 'a thought',
  behavior: null,
  closing_note: null,
  emotion: null,
  named_emotion: null,
  energy: null,
  distortion: null,
  mood_score: null,
  topic: null,
  tagged_at: null,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  raw_text: null,
  source: 'journal',
  ...over,
})

const node = (id: string, label: string): GraphNode => ({
  id,
  type: 'emotion',
  label,
  frequency: 1,
  created_at: 0,
  updated_at: 0,
})

const page = (id: string, title: string, content: string): WikiPage => ({
  id,
  title,
  category: null,
  content,
  entry_count: 3,
  version: 1,
  version_history: [],
  created_at: 0,
  updated_at: 0,
  dismissed_at: null,
  corrected_at: null,
  merged_into: null,
})

describe('gatherMaterial', () => {
  it('picks the top emotion + distortion as focus and gathers matching material', () => {
    const entries = [
      entry('1', { emotion: 'anxiety', situation: 'big work deadline', thought: 'I will fail' }),
      entry('2', { emotion: 'anxiety', distortion: 'catastrophizing', thought: 'everything is ruined' }),
      entry('3', { emotion: 'calm', situation: 'a walk outside' }),
    ]
    const nodes = [node('a', 'anxiety'), node('b', 'work')]
    const edges: GraphEdge[] = [
      { id: 'e1', source_id: 'a', target_id: 'b', weight: 1, created_at: 0, updated_at: 0 },
    ]
    const pages = [page('p1', 'Anxiety', 'notes about anxiety and deadlines'), page('p2', 'Sleep', 'rest')]

    const m = gatherMaterial(entries, nodes, edges, pages)

    expect(m.focus).toEqual(expect.arrayContaining(['anxiety', 'catastrophizing']))
    expect(m.entries.length).toBeGreaterThan(0)
    expect(m.neighborhoods.map((n) => n.node.label)).toContain('anxiety')
    expect(m.pages.map((p) => p.id)).toContain('p1')
  })

  it('falls back to recent entries when there are no tags to focus on', () => {
    const entries = [entry('1'), entry('2')]
    const m = gatherMaterial(entries, [], [], [])
    expect(m.focus).toEqual([])
    expect(m.entries).toHaveLength(2)
    expect(m.pages).toEqual([])
  })
})
