import { processEbmOutboxBatch } from '../src/services/ebm-outbox.service';
async function main() {
  const res = await processEbmOutboxBatch(50);
  console.log('RESULT:', JSON.stringify(res));
}
main();
