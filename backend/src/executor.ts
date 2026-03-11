import { execSync } from 'node:child_process';
import { config } from './config.js';

const { leoProjectDir, adminPrivateKey, aleoNetwork, aleoEndpoint } = config;

/**
 * Execute a Leo program function on-chain.
 * Mirrors the pattern from resolver.mjs — uses `leo execute` CLI.
 */
export function leoExecute(fn: string, args: string[]): boolean {
  const argsStr = args.join(' ');
  const cmd = `cd "${leoProjectDir}" && leo execute ${fn} ${argsStr} --no-local --broadcast --yes --private-key ${adminPrivateKey} --network ${aleoNetwork} --endpoint ${aleoEndpoint} 2>&1`;
  console.log(`  [Exec] leo execute ${fn} ${argsStr}`);

  try {
    const output = execSync(cmd, { timeout: 180_000, encoding: 'utf-8' });

    if (output.includes('Execution confirmed')) {
      console.log(`  [Exec] ${fn} confirmed on-chain`);
      return true;
    }
    if (output.includes('Transaction accepted')) {
      console.log(`  [Exec] ${fn} accepted`);
      return true;
    }
    if (output.includes('Broadcasted transaction')) {
      const txMatch = output.match(/transaction ID: '(at1\w+)'/);
      console.log(`  [Exec] ${fn} broadcasted: ${txMatch ? txMatch[1] : 'unknown'}`);
      return true;
    }

    console.log(`  [Exec] ${fn} output (last 300 chars):\n${output.slice(-300)}`);
    return false;
  } catch (err: any) {
    const stderr = err.stdout || err.stderr || err.message;
    // Check if it was actually broadcast despite error (timeout on confirmation)
    if (stderr.includes('Broadcasted transaction')) {
      console.log(`  [Exec] ${fn} broadcasted (confirmation timed out, likely ok)`);
      return true;
    }
    console.error(`  [Exec] ${fn} failed: ${stderr.slice(-300)}`);
    return false;
  }
}

/**
 * Transfer seed USDCx to the pool before creating a round.
 * Uses @provablehq/sdk to call test_usdcx_stablecoin.aleo/transfer_public.
 */
export async function transferSeedToPool(amount: number): Promise<boolean> {
  const poolAddr = config.programAddress;
  // seed_amount * 2 because we seed both YES and NO sides
  const totalSeed = amount * 2;
  console.log(`  [Exec] test_usdcx_stablecoin.aleo transfer_public ${poolAddr} ${totalSeed}u128`);

  try {
    const { Account, ProgramManager } = await import('@provablehq/sdk');
    const account = new Account({ privateKey: adminPrivateKey });
    const pm = new ProgramManager(aleoEndpoint, undefined, undefined);
    pm.setAccount(account);

    const txId = await pm.execute({
      programName: 'test_usdcx_stablecoin.aleo',
      functionName: 'transfer_public',
      inputs: [poolAddr, `${totalSeed}u128`],
      priorityFee: 0,
      privateFee: false,
    });

    console.log(`  [Exec] USDCx seed transfer succeeded: ${txId}`);
    return true;
  } catch (err: any) {
    console.error(`  [Exec] USDCx seed transfer failed: ${err.message?.slice(-300) || err}`);
    return false;
  }
}
