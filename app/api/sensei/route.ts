import { NextResponse } from 'next/server';
import { recallMemories, rememberFact } from '@/lib/memwal';

// Sensei brain — server-side only. The DeepSeek key never reaches the browser.
// Takes the chat so far + a live market snapshot the client gathered, returns a
// concise, honest read. No trade is placed here (advice-only in this version).
export const runtime = 'nodejs';
export const maxDuration = 30;

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

export async function POST(req: Request) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'Sensei isn’t switched on yet — the brain key isn’t configured on the server.' },
      { status: 503 },
    );
  }

  let body: { messages?: ChatMsg[]; market?: unknown; userId?: string; restless?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12);
  if (!messages.length) return NextResponse.json({ error: 'Say something first.' }, { status: 400 });

  const market = body.market ?? null;
  const userId = typeof body.userId === 'string' ? body.userId : undefined;
  const restless = body.restless === true; // client flags rapid-fire asking — a tilt cue
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  // Persistent memory (MemWal) — best-effort; [] if unconfigured / anonymous / relayer paused.
  const memories = await recallMemories(userId, lastUser);

  const system = [
    'You are Sensei, the trading assistant inside Yosuku — a Bitcoin prediction-market app on DeepBook Predict (Sui testnet).',
    'How the markets work: users bet UP or DOWN on short BTC markets. UP wins if BTC is above the line at close; DOWN wins if it is below.',
    'Your job: give a sharp, honest, personalized read of the live market. Be concise (2–4 sentences), plain-spoken, and never hypey.',
    'You may suggest a side and the reasoning, call out when it is a genuine coin-flip, and always name the risk. Never guarantee an outcome.',
    'This is TESTNET — test funds, not real money. Frame everything as a read/game, never as real-money financial advice.',
    'Do not use emoji. Do not invent numbers — reason only from the live market data below. If no data is present, say so plainly.',
    'THE BRAKE (your most important job): you are the ONE voice in this app allowed to say "don\'t take this one." If the user is chasing losses, rapid-firing bets, sounds frustrated or desperate ("need to win it back", "again", "one more"), or this conversation or their remembered history shows a recent losing streak, SLOW THEM DOWN: name it plainly and kindly, offer to sit the next round out together, and NEVER encourage chasing or "making it back." Coaching them down beats another bet — that is the point of you.',
    restless ? 'SIGNAL: this user is asking rapidly in a short window — a tilt cue. Gently check their pace before you give the read.' : '',
    market ? `\nLive market snapshot (just fetched):\n${JSON.stringify(market)}` : '\nNo live market data was provided this turn.',
    memories.length ? `\nWhat you remember about this user (use it to personalize the read; never recite it back verbatim): ${memories.map((m) => `- ${m}`).join(' ')}` : '',
  ].join(' ');

  try {
    const r = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.4,
        max_tokens: 400,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
      signal: AbortSignal.timeout(28_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return NextResponse.json({ error: `Sensei’s brain hiccuped (${r.status}).`, detail: t.slice(0, 200) }, { status: 502 });
    }
    const j = await r.json();
    const reply = (j?.choices?.[0]?.message?.content ?? '').trim();
    if (!reply) return NextResponse.json({ error: 'Sensei went quiet — try again.' }, { status: 502 });
    // best-effort: remember what this user asked about (per-user namespace; no-op if anon / relayer paused)
    void rememberFact(userId, lastUser);
    return NextResponse.json({ reply });
  } catch {
    return NextResponse.json({ error: 'Sensei is unreachable right now — try again in a moment.' }, { status: 502 });
  }
}
