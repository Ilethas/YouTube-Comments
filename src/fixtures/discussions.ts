import type { Author, Comment, ContentItem } from '../domain/discussion';

// Entirely synthetic application data; not captured or inferred extractor output.
const creator: Author = { sourceId: 'demo-author-studio', displayName: 'Quiet Workshop', handle: '@quietworkshop' };
export const demoNow = Date.parse('2026-09-20T12:00:00Z');
export const items: readonly ContentItem[] = [
  { id: 'video-demo', sourceId: 'synthetic-video', kind: 'video', title: 'A quieter desk, built one detail at a time',
    description: 'An afternoon in the workshop: a solid-wood desk, a cable tray, and a little more room to think.',
    author: creator, publishedAt: '2026-09-16T10:00:00Z', baselineDiscoveryId: 'video-baseline' },
  { id: 'post-demo', sourceId: 'synthetic-post', kind: 'post', author: creator,
    text: 'What should we build next?\n\nI’m sketching a reading lamp with replaceable parts. Tell me which small details make your workspace feel better.\n\nDzięki za wszystkie pomysły!',
    publishedAt: '2026-09-18T08:00:00Z', baselineDiscoveryId: 'post-baseline' },
];

type Seed = readonly [string, string | null, string | undefined, string, boolean];
const videoSeeds: readonly Seed[] = [
  ['v1', null, 'Marta', 'The cable tray is the detail I came for. Is there enough room for a large power brick?', true],
  ['v2', 'v1', 'Quiet Workshop', 'Yes — there is 9 cm of clearance. I left one side open so the cables can move.', true],
  ['v3', 'v2', 'Marta', 'That helps, thank you! I might try a removable felt liner too.', false],
  ['v4', 'v3', 'Jonas', 'A felt liner worked well on mine. Leave a gap near the power supply for airflow.', true],
  ['v5', 'v1', 'Anika', 'I used two shorter trays instead of one. It makes moving the desk much easier.', false],
  ['v6', null, 'Tomasz', 'Bardzo podoba mi się wykończenie drewna. Czy używasz oleju czy wosku?', false],
  ['v7', 'v6', 'Quiet Workshop', 'Dwie cienkie warstwy oleju. Po wyschnięciu powierzchnia nadal jest przyjemna w dotyku.', true],
  ['v8', null, 'Sam', 'Keeping the mistakes in the edit makes this much more useful than a perfect time-lapse.', true],
  ['v9', 'v8', 'Leah', 'Especially the section about drilling the pilot holes. I learned that the expensive way.', false],
  ['v10', null, undefined, 'Would this construction work with a narrower top? My room is only two metres wide.', false],
  ['v11', 'v10', 'Ravi', 'Mine is 55 cm deep. A monitor arm freed up most of the usable surface.', true],
  ['v12', null, 'Elliot', 'A small shelf under the desk is a good place to keep a notebook.\nNo more paper piles beside the keyboard.', false],
  ['v13', 'v12', 'Noor', 'I added a shallow drawer for exactly that reason.', false],
  ['v14', null, 'Ada', 'The quiet workshop audio was lovely. I watched this with a cup of tea on a rainy morning.', true],
  ['v15', null, 'Chris', 'For anyone following along: measure your chair armrests before choosing the final height.', false],
  ['v16', 'v15', 'Marta', 'And check where your knees meet the cable tray!', true],
];
const postSeeds: readonly Seed[] = [
  ['p1', null, 'Zofia', 'A warm light with a physical dimmer. I want to adjust it without opening an app.', false],
  ['p2', 'p1', 'Quiet Workshop', 'A physical knob is on the sketch already. Replaceable bulbs too.', true],
  ['p3', 'p2', 'Zofia', 'That sounds ideal. Please show how the switch is wired in the build video.', false],
  ['p4', 'p1', 'Ben', 'A heavy base matters more than I expected. My current lamp tips whenever I move it.', true],
  ['p5', null, 'Ola', 'Miejsce na kubek, którego nie potrącę łokciem. To byłaby prawdziwa rewolucja :)', true],
  ['p6', 'p5', 'Marek', 'U mnie sprawdziła się mała półka obok biurka.', false],
  ['p7', null, undefined, 'Please keep the design repairable. Standard screws are a small but meaningful detail.', false],
  ['p8', null, 'Alex', 'A shade that keeps the bulb out of my line of sight during evening reading.', false],
];

function makeComments(item: ContentItem, seeds: readonly Seed[]): readonly Comment[] {
  return seeds.map(([id, parentId, name, text, seen], index) => ({
    id, itemId: item.id, source: { kind: item.kind, itemId: item.sourceId, commentId: `synthetic-${id}` },
    parentId, text, seen,
    author: name ? (name === creator.displayName ? creator : { displayName: name }) : undefined,
    publishedAt: index === 9 || id === 'p7' ? undefined : new Date(demoNow - (seeds.length - index + 5) * 3600000).toISOString(),
    discovery: {
      firstDiscoveredAt: index === 2 ? '2026-09-20T11:00:00Z' : '2026-09-20T08:00:00Z',
      lastObservedAt: '2026-09-20T11:00:00Z',
      firstDiscoveryId: index === 2 ? `${item.id}-later` : item.baselineDiscoveryId,
    },
    likeCount: index % 4 === 1 ? undefined : index * 3,
    isCreator: name === creator.displayName ? true : undefined,
    isPinned: index === 0 && item.kind === 'video' ? true : undefined,
  }));
}

export const initialComments: Readonly<Record<string, readonly Comment[]>> = {
  'video-demo': makeComments(items[0], videoSeeds),
  'post-demo': makeComments(items[1], postSeeds),
};

// Fixed presentation examples only. No production NEW lifetime/window is selected.
export const demoNewCommentIds: ReadonlySet<string> = new Set(['v3', 'p3']);
