import { materialKey, type Material } from './model.ts';

export type DispositionAction = 'archive' | 'delete' | 'restore';
export type Dispositions = Record<string, { action: DispositionAction; item: Material }>;

// Always retain the server's material, never client-supplied paths or metadata.
export function changeDisposition(state: Dispositions, known: Material[], submitted: Material, action: DispositionAction): Dispositions {
 const key = materialKey(submitted);
 const item = known.find(candidate => materialKey(candidate) === key) || state[key]?.item;
 if (!item) throw new Error('Материал не найден в этом чате. Обновите список и повторите.');
 return { ...state, [key]: { action, item: { ...item } } };
}

export function projectDispositions(materials: Material[], state: Dispositions): { materials: Material[]; archived: Material[] } {
 const visible = materials.filter(item => !state[materialKey(item)] || state[materialKey(item)].action === 'restore');
 const keys = new Set(visible.map(materialKey));
 const archived: Material[] = [];
 for (const [key, entry] of Object.entries(state)) {
  if (entry.action === 'archive') archived.push(entry.item);
  if (entry.action === 'restore' && !keys.has(key)) { visible.push(entry.item); keys.add(key); }
 }
 return { materials: visible, archived };
}

export function hasCompletedLatestTurn(rows: unknown[], status: string, queuedWork: string): boolean {
 if (status !== 'idle' || queuedWork !== 'none') return false;
 let latest: Record<string, unknown> | undefined;
 let pendingUser = false;
 for (const value of rows) {
  if (!value || typeof value !== 'object') continue;
  const row = value as Record<string, unknown>;
  if (row.kind === 'turn') {
   latest = row;
   pendingUser = false;
   if (Array.isArray(row.children)) for (const child of row.children) {
    if (child?.kind === 'conversation' && child.role === 'user') pendingUser = true;
    if (child?.kind === 'conversation' && child.role === 'assistant') pendingUser = false;
   }
  } else if (row.kind === 'conversation' && row.role === 'user') pendingUser = true;
 }
 return latest?.status === 'completed' && !pendingUser;
}
