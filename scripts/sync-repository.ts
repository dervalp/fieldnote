import 'dotenv/config';
import { syncRepository } from '../src/github/sync-repository';
import { integrationEnv } from '../src/lib/env-node';
integrationEnv();
const id = process.argv[2];
if (!id) throw new Error('Usage: pnpm github:sync repository:123');
const run = await syncRepository(id);
console.log(`Import run ${run.id}: ${run.state}`);
