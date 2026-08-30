import { CronJob } from 'cron';
import { crawlGitHub } from './github.js';
import { crawlNpm } from './npm.js';
import { runSlaProbes } from '../trust/sla-prober.js';
import { verifyAllAgents } from '../trust/verifier.js';

// GitHub crawl weekly on Sundays at 4am
// npm crawl weekly on Wednesdays at 4am
// SLA probes every 6 hours
// Verification daily at 5am (after crawls + probes)
export function startCrawlScheduler() {
  // GitHub: weekly Sunday at 4am
  const githubCron = new CronJob('0 4 * * 0', async () => {
    console.log('[scheduler] Starting GitHub crawl...');
    try {
      const result = await crawlGitHub(10);
      console.log(`[scheduler] GitHub crawl complete: ${result.processed} agents`);
    } catch (err) {
      console.error('[scheduler] GitHub crawl failed:', err);
    }
  });

  // npm: weekly Wednesday at 4am
  const npmCron = new CronJob('0 4 * * 3', async () => {
    console.log('[scheduler] Starting npm crawl...');
    try {
      const result = await crawlNpm(500);
      console.log(`[scheduler] npm crawl complete: ${result.processed} agents`);
    } catch (err) {
      console.error('[scheduler] npm crawl failed:', err);
    }
  });

  // SLA probes: every 6 hours
  const slaCron = new CronJob('0 */6 * * *', async () => {
    console.log('[scheduler] Starting SLA probes...');
    try {
      const stats = await runSlaProbes();
      console.log(`[scheduler] SLA probes complete:`, stats);
    } catch (err) {
      console.error('[scheduler] SLA probes failed:', err);
    }
  });

  // Verification: daily at 5am
  const verifyCron = new CronJob('0 5 * * *', async () => {
    console.log('[scheduler] Starting verification run...');
    try {
      const result = await verifyAllAgents();
      console.log(`[scheduler] Verification complete:`, result.tiers);
    } catch (err) {
      console.error('[scheduler] Verification failed:', err);
    }
  });

  githubCron.start();
  npmCron.start();
  slaCron.start();
  verifyCron.start();

  console.log('Crawl scheduler started:');
  console.log('  - GitHub: weekly Sunday at 4am');
  console.log('  - npm: weekly Wednesday at 4am');
  console.log('  - SLA probes: every 6 hours');
  console.log('  - Verification: daily at 5am');
}
