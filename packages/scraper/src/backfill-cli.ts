#!/usr/bin/env tsx
/** `npm run backfill` — import historical snapshots from Internet Archive captures of the official API. */
import { openDatabase } from '@nj/database';
import { backfillFromArchive } from './backfill.ts';

const db = openDatabase();
const results = await backfillFromArchive(db);
const ok = results.filter((r) => r.status === 'success').length;
console.log(`[backfill] imported ${ok} new snapshots (${results.length} captures checked).`);
