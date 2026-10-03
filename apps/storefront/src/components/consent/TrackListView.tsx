'use client';

import { useEffect } from 'react';
import { track, type TrackItem } from '@/lib/tracking';

/** Records a product list (or search results) view once per rendered list.
 * A no-op without analytics/marketing consent (LR-003). */
export function TrackListView({ listName, items, searchTerm }: { listName: string; items: TrackItem[]; searchTerm?: string }) {
  const key = `${listName}|${searchTerm ?? ''}|${items.map((i) => i.styleCode).join(',')}`;
  useEffect(() => {
    track.viewItemList(listName, items);
    if (searchTerm) track.search(searchTerm, items);
  }, [key]);
  return null;
}
