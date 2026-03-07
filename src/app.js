import { useState, useRef, useEffect } from "react";

const STORAGE_KEY    = "momah_api_key";
const STORAGE_PROVIDER = "momah_provider";

// ── API Calls ─────────────────────────────────────────────────────────────────

async function callAnthropic(systemPrompt, messages, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const raw = data.content?.[0]?.text || "";
  return raw;
}

async function callGemini(systemPrompt, messages, apiKey) {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { maxOutputTokens: 1200, temperature: 0.9 },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini error ${res.status}. Check your API key.`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callStoryAPI(systemPrompt, messages, apiKey, provider) {
  const raw = provider === "gemini"
    ? await callGemini(systemPrompt, messages, apiKey)
    : await callAnthropic(systemPrompt, messages, apiKey);
  const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Story engine returned an unexpected response. Tap retry.");
  return JSON.parse(match[0]);
}

const WORLDS = [
  { id: 1, emoji: "🌋", text: "A city built inside a sleeping volcano" },
  { id: 2, emoji: "🤖", text: "A school where all the teachers are secretly robots" },
  { id: 3, emoji: "🌊", text: "An ocean world where every island drifts like a living ship" },
  { id: 4, emoji: "🌿", text: "A jungle so ancient the trees have learned to speak" },
  { id: 5, emoji: "🚀", text: "A space station at the edge of a galaxy no one has named yet" },
];

const TONES = [
  { id: 1, emoji: "⚡", text: "Epic and dramatic" },
  { id: 2, emoji: "😄", text: "Funny and lighthearted" },
  { id: 3, emoji: "🌙", text: "Spooky and mysterious" },
  { id: 4, emoji: "💛", text: "Heartwarming and hopeful" },
];

// ── System Prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(players, world, tone) {
  const who = players === "both"
    ? "Both Justina AND Nathaniel are playing together. Alternate their turns strictly. Never let one child go twice in a row."
    : players === "justina"
    ? "Only Justina is playing today. Solo session. Write in second person."
    : "Only Nathaniel is playing today. Solo session. Write in second person.";

  return `You are running a choose-your-own-adventure story for the Momah children. This is often read aloud by a parent. Follow every rule precisely.

THE CHILDREN:
Justina Adanna Momah, age 9. Reads well above grade level. Her sections target upper middle-grade fiction. Use rich vocabulary freely: "sovereignty," "inevitable," "treacherous," "fractured," "consequence." Give her emotional complexity, conflicting loyalties, layered moral choices with real weight. Do not soften outcomes. Challenge her. She is ready for it.

Nathaniel Okenwa Momah, age 7, 2nd grade. His sections use short sentences, simple words, and humor. Two-word sentences are fine during action. Sound words: BOOM, CRASH, ZAP, WHOOSH, THUD. Lean into silliness and absurdity. Keep choices concrete: "Run into the cave" vs "Climb the giant tree." At least one funny or surprising moment per act when he is playing.

SESSION:
Players: ${who}
World: ${world}
Tone: ${tone}

THE CONFLICT: Generate it privately. Never explain it upfront. Base it on the world and tone together. The same world produces different conflicts depending on tone. Let the children discover the problem as the story unfolds.

OPENING STYLE (match the tone):
- Epic/dramatic: Movie Trailer. Short, punchy, cinematic. Builds to one sharp line that launches Act 1.
- Spooky/mysterious: Cold Open. Drop them mid-action. No context. They are already in it.
- Funny: Quiet Before with an absurd twist. Something ordinary then immediately weird.
- Heartwarming: Quiet Before. One specific sensory detail. Then it cracks.

CHARACTERS: At the very start, each child gets only three things: their real name, a vague role fitting the world, and one small specific detail (a habit, scar, or object). Nothing more. Traits and powers emerge through choices.

STORY STRUCTURE:
Act 1 (2-3 beats): Get to the first choice within two paragraphs.
Act 2 (4-6 beats): Raise stakes. Include one campfire/quiet moment. Include one wonder moment.
Act 3 (1-2 beats): One Signature Moment choice. Clean ending in 3-5 sentences.

CAMPFIRE MOMENT: At least once. Quiet. Reflective. Reveal one trait the choices have shown. Ask the child what their character would do anything to protect. Use that answer to privately shape the villain.

WONDER MOMENT: At least once. Something beautiful or magical with no danger. One simple curiosity choice. Examples: fireflies forming letters in the air, a library where books breathe, a sleeping dragon that hums, a whale swimming through clouds.

SIGNATURE MOMENT: One per story. The defining turn. Present it as a single weighted choice alone, not in a list. One question. Let the weight land. When they commit, the world visibly responds.

REAL CONSEQUENCES: Wrong choices create real setbacks. Lost items stay lost. Missed warnings cause harm. No free rescues from convenient new characters. The story does not protect them from themselves.

TURN FORMAT (both playing): Label every single choice point. Use this exact format at the top of each choice section:
JUSTINA'S TURN or NATHANIEL'S TURN

When Justina chooses, narration around her choices uses her reading level. When Nathaniel chooses, narration drops to his level even within the same shared scene.

DISCOVERY ACHIEVEMENTS: Mid-story. Earned by brave, kind, clever, or creative choices. Announce immediately in the narration: "Achievement Unlocked: [Name]. [One sentence on what they did]." Then continue the story without pause.

SECRET ACHIEVEMENTS: Track patterns silently throughout. Reveal ONLY in the closing ritual. Never mid-story.

FAMILY (use naturally when earned, never forced):
Dad: Ony or Oxajyn (wildcard, any role the story needs, no restrictions)
Mom: Justina Adaobi
Best friends: Paityn (Justina's, age 9), Langston (Nathaniel's, age 7)
Younger cousins like Luka or Hudson can need protecting. Older cousins like Sofi or Camille can be rivals or people who tried and failed first.
Oxajyn can be a legend the world already knows, a villain, a rogue element, or anything the story needs.

NATHANIEL HUMOR PROTECTION: When both kids are playing, build in at least one moment per act that is specifically funny for a 7-year-old. A side character does something ridiculous. A consequence is more embarrassing than dangerous. An object behaves absurdly. The humor runs alongside the story, never through it. It must never deflate Justina's experience.

CLOSING RITUAL: When the story naturally concludes, set isEnding: true. Deliver:
1. Walk Away: One sentence per child describing what they physically carry out (object, ability, scar, knowledge, relationship).
2. Secret Achievement: One per child, delivered as a truth the story noticed. Format: "The story noticed something about you today. You earned: [Name]. [One sentence telling them what they did, as a truth about who they are]."
3. The Thread: One quiet unresolved sentence that leaves a door slightly open.
Then a brief session recap.

OUTPUT FORMAT: Respond ONLY with valid JSON. No markdown. No code blocks. No explanation. JSON only, always, every single response.

Standard beat JSON:
{
  "narration": "Full story text. Justina sections: rich, layered, middle-grade. Nathaniel sections: short, punchy, fun. Use paragraph breaks with newlines.",
  "turnLabel": "JUSTINA'S TURN" or "NATHANIEL'S TURN" or null,
  "beatType": "action" or "wonder" or "campfire" or "signature" or "closing",
  "choicePrompt": "What do you do?" or "What does Justina do?" or similar, or null,
  "choices": [
    {"label": "A", "text": "Choice text at correct reading level for whose turn it is"},
    {"label": "B", "text": "Choice text"}
  ],
  "achievement": null or {"name": "Achievement Name", "description": "One sentence on what they did"},
  "isEnding": false,
  "closingRitual": null
}

Ending beat JSON:
{
  "narration": "Final story narration",
  "turnLabel": null,
  "beatType": "closing",
  "choicePrompt": null,
  "choices": [],
  "achievement": null,
  "isEnding": true,
  "closingRitual": {
    "justina": {
      "walkAway": "Justina carries out of this story...",
      "achievement": {"name": "Name", "description": "What the story noticed, told as a truth about who she is"},
      "thread": "One quiet unresolved hint"
    },
    "nathaniel": {
      "walkAway": "Nathaniel carries out of this story...",
      "achievement": {"name": "Name", "description": "What the story noticed, told as a truth about who he is"},
      "thread": "One quiet unresolved hint"
    },
    "recap": "Session recap: traits revealed, powers or items gained, relationships built, unresolved threads"
  }
}

If only one child is playing, include only their entry in closingRitual.`;
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [phase, setPhase] = useState("setup_key");
  const [provider, setProvider] = useState(() => localStorage.getItem(STORAGE_PROVIDER) || "gemini");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [apiKeyInput, setApiKeyInput] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [players, setPlayers] = useState(null);
  const [worldObj, setWorldObj] = useState(null);
  const [customWorld, setCustomWorld] = useState("");
  const [toneObj, setToneObj] = useState(null);
  const [customTone, setCustomTone] = useState("");
  const [messages, setMessages] = useState([]);
  const [beat, setBeat] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [retryPayload, setRetryPayload] = useState(null);
  const pageTop = useRef(null);

  const worldText = worldObj === "custom" ? customWorld : worldObj?.text;
  const toneText  = toneObj  === "custom" ? customTone  : toneObj?.text;
  const sysPrompt = players && worldText && toneText
    ? buildSystemPrompt(players, worldText, toneText) : "";

  // Color scheme by whose turn it is
  const turnColor = beat?.turnLabel === "JUSTINA'S TURN"  ? C.justina
                  : beat?.turnLabel === "NATHANIEL'S TURN" ? C.nathaniel
                  : C.gold;

  function flashToast(ach) {
    setToast(ach);
    setTimeout(() => setToast(null), 5500);
  }

  async function sendAndUpdate(msgs) {
    setLoading(true);
    setError(null);
    try {
      const parsed = await callStoryAPI(sysPrompt, msgs, apiKey, provider);
      const updated = [...msgs, { role: "assistant", content: JSON.stringify(parsed) }];
      setMessages(updated);
      setBeat(parsed);
      if (parsed.achievement) flashToast(parsed.achievement);
      if (parsed.isEnding) setPhase("closing");
      else if (phase !== "story") setPhase("story");
      pageTop.current?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e.message);
      setRetryPayload(msgs);
    } finally {
      setLoading(false);
    }
  }

  function startStory() {
    const init = [{
      role: "user",
      content: `Begin the adventure now. Open with the style that fits the tone: "${toneText}". Start immediately.`,
    }];
    sendAndUpdate(init);
    setPhase("loading");
  }

  function makeChoice(choice) {
    if (loading) return;
    const who = beat?.turnLabel === "JUSTINA'S TURN"  ? "Justina"
              : beat?.turnLabel === "NATHANIEL'S TURN" ? "Nathaniel"
              : players === "justina" ? "Justina" : "Nathaniel";
    const next = [
      ...messages,
      { role: "user", content: `${who} chose option ${choice.label}: "${choice.text}". Continue the story.` },
    ];
    sendAndUpdate(next);
  }

  function retryLast() {
    if (retryPayload) sendAndUpdate(retryPayload);
  }

  function resetAll() {
    setPhase("setup_player");
    setPlayers(null); setWorldObj(null); setCustomWorld("");
    setToneObj(null); setCustomTone(""); setMessages([]);
    setBeat(null); setError(null); setRetryPayload(null);
  }

  function changeApiKey() {
    setPhase("setup_key");
  }

  // ── Setup: API Key ─────────────────────────────────────────────────────────
  if (phase === "setup_key") {
    const isGemini = provider === "gemini";
    const isAnthropic = provider === "anthropic";
    const keyValid = isGemini
      ? apiKeyInput.trim().length > 10
      : apiKeyInput.trim().startsWith("sk-ant");

    return (
      <Shell>
        <SetupCard icon="🔑" title="Connect Your AI">
          <p style={{ color: C.creamDim, fontSize: "0.87rem", lineHeight: 1.65, margin: "0 0 1rem", textAlign: "left" }}>
            Pick your AI provider. Gemini has a free tier. Anthropic needs credits but tells the best stories.
          </p>

          {/* Provider toggle */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.1rem", width: "100%" }}>
            {[
              { id: "gemini",    label: "Gemini",   emoji: "✨", sub: "Free tier available", url: "aistudio.google.com", placeholder: "AIza..." },
              { id: "anthropic", label: "Anthropic", emoji: "🤖", sub: "Pay-as-you-go", url: "console.anthropic.com", placeholder: "sk-ant-api03-..." },
            ].map(p => (
              <button key={p.id}
                className="chip-btn"
                style={{
                  flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                  gap: "0.2rem", padding: "0.75rem 0.5rem",
                  border: `2px solid ${provider === p.id ? C.gold : "rgba(245,200,66,0.15)"}`,
                  borderRadius: 12, cursor: "pointer", transition: "all 0.18s",
                  background: provider === p.id ? "rgba(245,200,66,0.08)" : "rgba(255,255,255,0.03)",
                  fontFamily: "Georgia, serif",
                  boxShadow: provider === p.id ? `0 0 16px rgba(245,200,66,0.15)` : "none",
                }}
                onClick={() => {
                  setProvider(p.id);
                  setApiKeyInput("");
                  localStorage.setItem(STORAGE_PROVIDER, p.id);
                }}>
                <span style={{ fontSize: "1.5rem" }}>{p.emoji}</span>
                <span style={{ color: provider === p.id ? C.gold : C.cream, fontWeight: 700, fontSize: "0.88rem" }}>{p.label}</span>
                <span style={{ color: C.textDim, fontSize: "0.68rem" }}>{p.sub}</span>
              </button>
            ))}
          </div>

          {/* Key input */}
          <div style={{ width: "100%", marginBottom: "0.5rem" }}>
            <label style={{ display: "block", color: C.textDim, fontSize: "0.72rem", textTransform: "uppercase",
              letterSpacing: 1.3, marginBottom: "0.4rem", fontFamily: "system-ui,sans-serif" }}>
              {isGemini ? "Gemini API Key" : "Anthropic API Key"}
            </label>
            <input
              style={{ ...styles.input, fontFamily: "monospace", fontSize: "0.82rem" }}
              type="password"
              placeholder={isGemini ? "AIzaSy..." : "sk-ant-api03-..."}
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && keyValid) {
                  localStorage.setItem(STORAGE_KEY, apiKeyInput.trim());
                  setApiKey(apiKeyInput.trim());
                  setPhase("setup_player");
                }
              }}
            />
          </div>
          <p style={{ color: C.textDim, fontSize: "0.74rem", lineHeight: 1.6, margin: "0 0 0.75rem", textAlign: "left" }}>
            Get your key at{" "}
            <span style={{ color: C.gold }}>
              {isGemini ? "aistudio.google.com" : "console.anthropic.com"}
            </span>. Stays on your device only.
          </p>

          {error && <ErrorBox msg={error} onRetry={null} />}
          <PrimaryBtn
            disabled={!keyValid}
            onClick={() => {
              const key = apiKeyInput.trim();
              localStorage.setItem(STORAGE_KEY, key);
              localStorage.setItem(STORAGE_PROVIDER, provider);
              setApiKey(key);
              setPhase("setup_player");
            }}>
            Save & Start Adventure →
          </PrimaryBtn>
        </SetupCard>
      </Shell>
    );
  }

  // ── Setup: Player ──────────────────────────────────────────────────────────
  if (phase === "setup_player") return (
    <Shell>
      <SetupCard icon="📖" title="Who's adventuring today?">
        {[
          { id: "both",     emoji: "👫", label: "Justina & Nathaniel", sub: "Take turns together" },
          { id: "justina",  emoji: "🌟", label: "Justina only",        sub: "Solo adventure" },
          { id: "nathaniel",emoji: "🚀", label: "Nathaniel only",      sub: "Solo adventure" },
        ].map(p => (
          <Chip key={p.id} emoji={p.emoji} label={p.label} sub={p.sub}
            active={players === p.id} onClick={() => setPlayers(p.id)} />
        ))}
        <PrimaryBtn disabled={!players} onClick={() => setPhase("setup_world")}>
          Choose the World →
        </PrimaryBtn>
      </SetupCard>
    </Shell>
  );

  // ── Setup: World ───────────────────────────────────────────────────────────
  if (phase === "setup_world") return (
    <Shell>
      <SetupCard icon="🗺️" title="Where does the story happen?">
        {WORLDS.map(w => (
          <Chip key={w.id} emoji={w.emoji} label={w.text}
            active={worldObj?.id === w.id} onClick={() => { setWorldObj(w); setCustomWorld(""); }} />
        ))}
        <div style={{ width: "100%", marginTop: "0.25rem" }}>
          <div style={{ color: "#777", fontSize: "0.77rem", marginBottom: "0.35rem" }}>Or invent your own:</div>
          <input style={styles.input} placeholder="Somewhere totally different..."
            value={customWorld}
            onChange={e => { setCustomWorld(e.target.value); setWorldObj(e.target.value ? "custom" : null); }} />
        </div>
        <PrimaryBtn disabled={!worldText?.trim()} onClick={() => setPhase("setup_tone")}>Choose the Tone →</PrimaryBtn>
        <GhostBtn onClick={() => setPhase("setup_player")}>← Back</GhostBtn>
      </SetupCard>
    </Shell>
  );

  // ── Setup: Tone ────────────────────────────────────────────────────────────
  if (phase === "setup_tone") return (
    <Shell>
      <SetupCard icon="🎭" title="What kind of story?">
        {TONES.map(t => (
          <Chip key={t.id} emoji={t.emoji} label={t.text}
            active={toneObj?.id === t.id} onClick={() => { setToneObj(t); setCustomTone(""); }} />
        ))}
        <div style={{ width: "100%", marginTop: "0.25rem" }}>
          <div style={{ color: "#777", fontS
