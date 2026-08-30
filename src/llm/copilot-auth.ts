/**
 * GitHub Copilot OAuth Device Flow
 * Obtains a ghu_ token that works with Copilot's internal API.
 * 
 * Usage: npx tsx src/llm/copilot-auth.ts
 */

const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const POLL_INTERVAL_MS = 5000;

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `client_id=${COPILOT_CLIENT_ID}&scope=read:user`,
  });

  if (!res.ok) throw new Error(`Device code request failed: ${res.status}`);
  return res.json() as Promise<DeviceCodeResponse>;
}

async function pollForToken(deviceCode: string, interval: number): Promise<string> {
  const pollInterval = Math.max(interval, 5) * 1000;

  while (true) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `client_id=${COPILOT_CLIENT_ID}&device_code=${deviceCode}&grant_type=urn:ietf:params:oauth:grant-type:device_code`,
    });

    const data = await res.json() as TokenResponse;

    if (data.access_token) {
      return data.access_token;
    }

    if (data.error === 'authorization_pending') {
      process.stdout.write('.');
      continue;
    }

    if (data.error === 'slow_down') {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    if (data.error === 'expired_token') {
      throw new Error('Device code expired. Please run again.');
    }

    throw new Error(`Token poll error: ${data.error} — ${data.error_description}`);
  }
}

async function main() {
  console.log('GitHub Copilot OAuth Device Flow\n');

  // Step 1: Request device code  
  const device = await requestDeviceCode();

  console.log(`1. Open: ${device.verification_uri}`);
  console.log(`2. Enter code: ${device.user_code}\n`);

  // Try to open browser automatically
  try {
    const { exec } = await import('child_process');
    exec(`open "${device.verification_uri}"`);
    console.log('(Browser opened automatically)');
  } catch {}

  console.log('Waiting for authorization...');

  // Step 2: Poll for token
  const token = await pollForToken(device.device_code, device.interval);

  console.log(`\n✓ Token obtained: ${token.slice(0, 12)}...`);
  console.log(`\nAdd to .env:`);
  console.log(`GITHUB_TOKEN=${token}`);

  // Verify token works with Copilot
  console.log('\nVerifying Copilot access...');
  const verifyRes = await fetch('https://api.github.com/copilot_internal/v2/token', {
    headers: {
      'Authorization': `token ${token}`,
      'Editor-Version': 'vscode/1.96.2',
      'User-Agent': 'GitHubCopilotChat/0.26.7',
      'X-Github-Api-Version': '2025-04-01',
    },
  });

  if (verifyRes.ok) {
    const session = await verifyRes.json() as any;
    console.log(`✓ Copilot token exchange works! Expires: ${new Date(session.expires_at * 1000).toISOString()}`);
  } else {
    console.warn(`⚠ Token exchange returned ${verifyRes.status} — token may not have Copilot access.`);
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
