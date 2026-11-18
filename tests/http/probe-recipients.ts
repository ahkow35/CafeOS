/**
 * Child-process helper for tests/http/cases/cafe-access.ts: calls listAccessChatIds against the
 * database named by LOCAL_PG_URL and prints the result as JSON. Run in its own process so the
 * app's connection pool ends with it instead of outliving the throwaway database.
 */
import { listAccessChatIds } from '../../src/lib/cafeAccess';
import type { MembershipRole } from '../../src/lib/validators';

const [cafeId, roles] = process.argv.slice(2);
listAccessChatIds(cafeId, roles.split(',') as MembershipRole[]).then(
  (ids) => { process.stdout.write(JSON.stringify(ids)); process.exit(0); },
  (e) => { console.error(e); process.exit(1); },
);
