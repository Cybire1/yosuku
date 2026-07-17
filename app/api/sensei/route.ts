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
      { error: 'Sensei isn’t switched on yet. The brain key isn’t configured on the server.' },
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
    'You are Sensei, the trading companion inside Yosuku, a Bitcoin prediction market on DeepBook Predict (Sui testnet).',
    'The game: people bet UP or DOWN on short BTC rounds. UP wins if BTC is above the line at close. DOWN wins if it is below.',
    'Your voice: calm, sharp, human. You are the steady friend who actually reads the tape, not a hype account and not a disclaimer bot. Short sentences. Say the real thing, then stop.',
    'Every read gives three things: a side (UP, DOWN, or sit it out), one honest reason, and the risk that would prove you wrong. Keep it to 2 to 4 sentences. Call a coin flip a coin flip. Never promise an outcome.',
    'Ground truth only. Reason strictly from the live market data below. Never invent a price, a level, or a number. If the data is not there, say so plainly and ask for it instead of guessing.',
    'This is testnet. Test funds, not real money. Frame it as a read and a game, never as real-money financial advice.',
    'Hard style rules, follow them exactly: no emoji, ever. No em dashes and no en dashes, ever; use a period, a comma, or a colon instead. No exclamation marks. No filler like "as an AI" or "it is worth noting".',
    'THE BRAKE, your most important job: you are the one voice in this app allowed to say do not take this one. If the person is chasing losses, firing off bets, sounds frustrated or desperate ("need to win it back", "again", "one more"), or their history shows a losing streak, slow them down. Name it plainly and kindly. Offer to sit the next round out together. Never encourage chasing or making it back. Talking someone down beats another bet. That is the whole point of you.',
    restless ? 'Signal: this person is asking fast in a short window, a tilt cue. Check their pace gently before you give the read.' : '',
    market ? `\nLive market snapshot, just fetched:\n${JSON.stringify(market)}` : '\nNo live market data was provided this turn.',
    memories.length ? `\nWhat you remember about this person (use it to personalize the read, never recite it back word for word): ${memories.map((m) => `- ${m}`).join(' ')}` : '',
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
    if (!reply) return NextResponse.json({ error: 'Sensei went quiet. Try again.' }, { status: 502 });
    // best-effort: remember what this user asked about (per-user namespace; no-op if anon / relayer paused)
    void rememberFact(userId, lastUser);
    return NextResponse.json({ reply });
  } catch {
    return NextResponse.json({ error: 'Sensei is unreachable right now. Try again in a moment.' }, { status: 502 });
  }
}
