/**
 * Characterization tests for the CafeOS workflow routes, driven over HTTP against
 * a real `next dev` server and a throwaway local Postgres. They pin what the code
 * does TODAY, so a later server refactor can be shown to change nothing.
 *
 * ONE entry file on purpose: node:test runs every *.test.ts file in its own
 * process, and this suite needs exactly one server and one database. The case
 * modules in ./cases are not named *.test.ts, so they are only loaded from here.
 *
 * Skipped unless TEST_DATABASE_URL is set (CI has no database). See
 * docs/LOCAL_DEV.md, "Running the HTTP tests".
 */
import { describe, before, after } from 'node:test';
import { skip, startHarness, stopHarness } from './harness';
import { accessCases } from './cases/access';
import { timesheetCases } from './cases/timesheets';
import { timesheetEntryCases } from './cases/timesheet-entries';
import { timesheetRuleCases } from './cases/timesheet-rules';
import { leaveCases } from './cases/leave';
import { claimCases } from './cases/claims';
import { taskCases } from './cases/tasks';
import { cafeStatusCases } from './cases/cafe-status';
import { signInAttemptCases } from './cases/sign-in-attempts';
import { signInAttemptResetCases } from './cases/sign-in-attempts-reset';

describe('http workflows', { skip }, () => {
  before(startHarness, { timeout: 150_000 });
  after(stopHarness, { timeout: 30_000 });

  accessCases();
  timesheetCases();
  timesheetEntryCases();
  timesheetRuleCases();
  leaveCases();
  claimCases();
  taskCases();
  cafeStatusCases();
  signInAttemptCases();
  signInAttemptResetCases();
});
