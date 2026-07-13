/**
 * gopeak notify — Interactive notification shown before AI CLI tools
 *
 * Called by the shell hook when a notification exists.
 * Shows update prompt (y/n) and star prompt (y/n, one-time).
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import {
  NOTIFY_FILE,
  STAR_PROMPTED_FILE,
  ONBOARDING_SHOWN_FILE,
  ensureGopeakDir,
  getLocalVersion,
  commandExists,
  runCommand,
} from './utils.js';
import { updateGoPeak } from './update.js';

const REPO = 'HaD0Yun/Doyunha-Gopeak';
const REPO_URL = `https://github.com/${REPO}`;

export async function showNotification(): Promise<void> {
  ensureGopeakDir();

  const hasUpdate = existsSync(NOTIFY_FILE);
  const hasStarPrompted = existsSync(STAR_PROMPTED_FILE);

  // Nothing to show → exit silently (fast path)
  if (!hasUpdate && hasStarPrompted) {
    return;
  }

  // --- Update notification ---
  if (hasUpdate) {
    const updateInfo = readFileSync(NOTIFY_FILE, 'utf-8').trim();

    console.log('');
    console.log(`  ${updateInfo}`);
    console.log('');

    const wantsUpdate = await askYesNo('  Update now? (y/n): ');
    if (wantsUpdate) {
      console.log('  Updating...');
      try {
        await updateGoPeak();
        console.log('  ✅ Updated successfully!');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`  ⚠️  Update failed: ${message}`);
        console.log('  Run manually: gopeak update');
      }
    }

    // Remove notify file (shown once)
    rmSync(NOTIFY_FILE, { force: true });
    console.log('');
  }

  // --- Star prompt (one-time) ---
  if (!hasStarPrompted) {
    const wantsStar = await askYesNo('  \u2b50 Star GoPeak on GitHub? (y/n): ');
    if (wantsStar) {
      await handleStar();
    }
    writeFileSync(STAR_PROMPTED_FILE, new Date().toISOString());
    console.log('');
  }
}

async function handleStar(): Promise<void> {
  const hasGh = await commandExists('gh');
  if (!hasGh) {
    console.log(`  ℹ️  gh CLI not installed. Star directly: ${REPO_URL}`);
    return;
  }

  const authResult = await runCommand('gh', ['auth', 'status']);
  if (authResult.code !== 0) {
    console.log(`  ℹ️  gh not authenticated. Star directly: ${REPO_URL}`);
    return;
  }

  // Check if already starred
  const checkResult = await runCommand('gh', ['api', `user/starred/${REPO}`]);
  if (checkResult.code === 0) {
    console.log('  ⭐ Already starred! Thank you!');
    return;
  }

  const starResult = await runCommand('gh', ['api', '-X', 'PUT', `user/starred/${REPO}`]);
  if (starResult.code === 0) {
    console.log('  ⭐ Starred! Thank you for your support!');
  } else {
    console.log(`  ⚠️  Could not star automatically. Star directly: ${REPO_URL}`);
  }
}

function askYesNo(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}
