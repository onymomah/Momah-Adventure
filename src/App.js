import { useState, useEffect, useRef, useCallback } from "react";

// ─── COLOR SYSTEM ───
const C = {
  ink: "#050e07", bg: "#0d1a0f", bgMid: "#132214", card: "#0f1e11",
  green: "#1e6b35", greenLight: "#2d9e52", gold: "#f5c842", goldDark: "#c9971a",
  terra: "#d45c1a", terraLight: "#f07640", cream: "#f5ead0",
  creamDim: "#c8b99a", textBody: "#e8dfc8", textDim: "#8a7d68",
  border: "rgba(245,200,66,0.18)", borderSoft: "rgba(245,200,66,0.09)",
  justina: "#00c49a", nathaniel: "#ff8c5a",
};
const UNKNOWN_COLORS = ["#a78bfa", "#f472b6", "#60a5fa", "#34d399"];

// ─── KNOWN PLAYERS ───
const KNOWN_PLAYERS = {
  justina: { id: "justina", name: "Justina", fullName: "Justina Adanna Momah", age: 9, grade: "4th", color: C.justina,
    reading: "Upper middle-grade. Rich vocabulary, emotional complexity, layered moral choices with real weight. Words like sovereignty, inevitable, treacherous, fractured, consequence are appropriate. Target feel: a strong upper middle-grade novel that respects the reader." },
  nathaniel: { id: "nathaniel", name: "Nathaniel", fullName: "Nathaniel Okenwa Momah", age: 7, grade: "2nd", color: C.nathaniel,
    reading: "2nd grade. Short sentences, simple words, sound words (BOOM, CRASH, ZAP, WHOOSH, THUD), humor, silliness, concrete choices. Two-word sentences are fine during action. Target feel: an early chapter book, lively and fast-moving." },
};

// ─── FAMILY CAST ───
const FAMILY_CAST = `Known Family Cast (use for cameos and supporting roles):
Parents: Ony/Oxajyn (Dad, wildcard: legend, villain, rogue element, no role restrictions), Mom (Justina Adaobi).
Grandparents: the Momahs (Engr. Nathan and Gloria), the Anusionwus (Professor Donatus and Justina Iwuoha).
Great-grandparents: Nathaniel Momah, Kelechi Momah.
Momah uncles/aunts: Uncle Chi, Auntie ChiChi, Aunty Fey (Ifechi), Uncle Arinze, Uncle E (Ifeanyi).
Anusionwu uncles/aunts: Captain A, Auntie Arpita, Uncle R (Reagan), Auntie Ofon, Uncle K (Kissinger), Auntie Megan, Uncle Churchill.
Cousins (Momah): Sofi (13), Kobi (11), Jidenna (8), Kamsi (6), Luka (4).
Cousins (Anusionwu): Maxwell (7), RJ (10), Ella/Urenna (8), Olanna (4), Camille (12), Emerson (8), Hudson (4).
Extended: Toboy, Kiko, Kai (11), Aya (9), Umi (7).
Best friends: Justina's best friend Paityn (age 9), Nathaniel's best friend Langston (age 7). They can appear as allies, sidekicks, rivals, or complications. Loyal but opinionated.
Oxajyn (Dad) is the wildcard. He can be a mentor, legend, villain, mysterious force, rogue element, or anything the story needs.
Ideas: The Momahs as ancient keepers of lost technology. The Anusionwus running a secret academy. Aunty Fey as a healer with a secret. Uncle E gone missing years ago. Younger cousins needing protecting. Older cousins as rivals or reluctant allies.`;

const FAMILY_NAMES = ["justina","nathaniel","ony","oxajyn","paityn","langston","sofi","kobi","jidenna","kamsi","luka","maxwell","rj","ella","urenna","olanna","camille","emerson","hudson","toboy","kiko","kai","aya","umi"];

// ─── PROVIDERS ───
const PROVIDERS = [
  { id: "anthropic", label: "Claude (recommended)", model: "claude-sonnet-4-20250514", prefix: "sk-ant-" },
  { id: "gemini", label: "Gemini", model: "gemini-2.0-flash", prefix: "" },
  { id: "deepseek", label: "DeepSeek", model: "deepseek-chat", prefix: "" },
  { id: "groq", label: "Groq", model: "llama-3.3-70b-versatile", prefix: "" },
];

// ─── TONE OPTIONS ───
const TONES = [
  { id: "epic", label: "Epic and dramatic", emoji: "⚔️" },
  { id: "funny", label: "Funny and lighthearted", emoji: "😂" },
  { id: "spooky", label: "Spooky and mysterious", emoji: "👻" },
  { id: "warm", label: "Heartwarming and hopeful", emoji: "💛" },
];

// ─── DURATION OPTIONS ───
const DURATIONS = [
  { id: "20", label: "20 minutes", sub: "4-5 decisions, lean narration" },
  { id: "45", label: "45 minutes", sub: "6-8 decisions, full experience" },
  { id: "60", label: "60+ minutes", sub: "Up to 12 decisions, everything" },
];

// ─── FALLBACK WORLDS ───
const FALLBACK_WORLDS = [
  { title: "Cloud Summit", desc: "A mountain range where clouds are solid enough to walk on" },
  { title: "Backwards Village", desc: "A village where time flows backwards after sunset" },
  { title: "The Vanishing Circus", desc: "A traveling circus that appears only in places no one remembers" },
  { title: "Bone Kingdom", desc: "An underwater kingdom built inside the bones of an ancient creature" },
  { title: "The Season Doors", desc: "A forest where every tree is a door to a different season" },
];

// ─── BEAT TYPE STYLES ───
const BEAT_STYLES = {
  campfire: { bg: "linear-gradient(135deg, #d45c1a 0%, #f07640 100%)", icon: "🔥", label: "Campfire" },
  wonder: { bg: "linear-gradient(135deg, #0d7377 0%, #14b8a6 100%)", icon: "✨", label: "Wonder" },
  signature: { bg: "linear-gradient(135deg, #6d28d9 0%, #a78bfa 100%)", icon: "⭐", label: "The Defining Turn" },
};

// ─── UTILITIES ───
const sanitizeId = (name) => name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, "_");
const getLS = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const setLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));

function readingLevelForAge(age) {
  if (age <= 7) return "Ages 5-7: Short sentences, simple words, sound words (BOOM, CRASH, ZAP), concrete choices, humor. Target feel: a lively early chapter book.";
  if (age <= 10) return "Ages 8-10: Mixed sentence length, richer vocabulary, emotional complexity starts. Choices can carry moral weight. Target feel: a confident middle-grade novel.";
  return "Ages 11+: Long layered sentences, full vocabulary, moral complexity, real sacrifice. Target feel: a strong upper middle-grade or YA novel that respects the reader.";
}

function getPlayerColor(playerId, playerColors) {
  if (playerId === "justina") return C.justina;
  if (playerId === "nathaniel") return C.nathaniel;
  return playerColors[playerId] || C.gold;
}

function assignColors(playerList) {
  const colors = {};
  let idx = 0;
  playerList.forEach(p => {
    if (p.id === "justina" || p.id === "nathaniel") return;
    colors[p.id] = UNKNOWN_COLORS[idx % UNKNOWN_COLORS.length];
    idx++;
  });
  return colors;
}

// ─── SOUND SYSTEM (Web Audio API) ───
let audioCtx = null;
const MuteRef = { muted: false };
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone({ freq = 440, freq2, type = "sine", gain = 0.18, duration = 0.12, delay = 0 }) {
  try {
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    if (freq2) osc.frequency.linearRampToValueAtTime(freq2, ctx.currentTime + delay + duration);
    g.gain.setValueAtTime(0, ctx.currentTime + delay);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + delay + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration + 0.05);
  } catch {}
}

const SFX = {
  click: () => { if (MuteRef.muted) return; playTone({ freq: 520, freq2: 580, gain: 0.12, duration: 0.08 }); },
  select: () => { if (MuteRef.muted) return; playTone({ freq: 660, freq2: 780, gain: 0.14, duration: 0.1 }); },
  back: () => { if (MuteRef.muted) return; playTone({ freq: 440, freq2: 330, gain: 0.1, duration: 0.1 }); },
  next: () => { if (MuteRef.muted) return;
    playTone({ freq: 440, gain: 0.13, duration: 0.1 });
    playTone({ freq: 550, gain: 0.13, duration: 0.1, delay: 0.08 });
    playTone({ freq: 660, gain: 0.13, duration: 0.12, delay: 0.16 });
  },
  achievement: () => { if (MuteRef.muted) return;
    playTone({ freq: 523, gain: 0.2, duration: 0.12 });
    playTone({ freq: 659, gain: 0.2, duration: 0.12, delay: 0.1 });
    playTone({ freq: 784, gain: 0.2, duration: 0.12, delay: 0.2 });
    playTone({ freq: 1047, gain: 0.22, duration: 0.25, delay: 0.3 });
  },
  begin: () => { if (MuteRef.muted) return;
    [0, 0.1, 0.2, 0.32, 0.46].forEach((d, i) => {
      playTone({ freq: [330, 392, 440, 523, 659][i], gain: 0.15, duration: 0.18, delay: d });
    });
  },
};

// ─── MUSIC SYSTEM (full multi-oscillator ambient tracks from original app) ───
const trackBuilders = {
  epic: (ctx) => {
    const intervals = []; const nodes = [];
    const mg = ctx.createGain(); mg.gain.value = 0.07; mg.connect(ctx.destination);
    const bass = ctx.createOscillator(); bass.type = "sawtooth"; bass.frequency.value = 55;
    const bg = ctx.createGain(); bg.gain.value = 0.4;
    const bf = ctx.createBiquadFilter(); bf.type = "lowpass"; bf.frequency.value = 120;
    bass.connect(bf); bf.connect(bg); bg.connect(mg); bass.start(); nodes.push(bass);
    const mid = ctx.createOscillator(); mid.type = "sawtooth"; mid.frequency.value = 82.4;
    const midg = ctx.createGain(); midg.gain.value = 0.25;
    mid.connect(midg); midg.connect(mg); mid.start(); nodes.push(mid);
    let beat = 0;
    intervals.push(setInterval(() => {
      try {
        const n = ctx.createOscillator(); n.type = "sine"; n.frequency.value = 80;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.5, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        n.connect(g); g.connect(mg); n.start(); n.stop(ctx.currentTime + 0.2); beat++;
        if (beat % 4 === 0) [196,220,246,220].forEach((f,i) => playTone({ freq: f, type: "sawtooth", gain: 0.04, duration: 0.4, delay: i * 0.38 }));
      } catch {}
    }, 1200));
    return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { mg.disconnect(); } catch {} };
  },
  spooky: (ctx) => {
    const intervals = []; const nodes = [];
    const mg = ctx.createGain(); mg.gain.value = 0.055; mg.connect(ctx.destination);
    const e1 = ctx.createOscillator(); e1.type = "sine"; e1.frequency.value = 110;
    const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 3.5;
    const lg = ctx.createGain(); lg.gain.value = 15; lfo.connect(lg); lg.connect(e1.frequency);
    const eg = ctx.createGain(); eg.gain.value = 0.5; e1.connect(eg); eg.connect(mg);
    e1.start(); lfo.start(); nodes.push(e1, lfo);
    const e2 = ctx.createOscillator(); e2.type = "sine"; e2.frequency.value = 164.5;
    const e2g = ctx.createGain(); e2g.gain.value = 0.2; e2.connect(e2g); e2g.connect(mg);
    e2.start(); nodes.push(e2);
    intervals.push(setInterval(() => {
      try { playTone({ freq: [880,740,659,587,830][Math.floor(Math.random()*5)], gain: 0.025, duration: 1.8 }); } catch {}
    }, 4000 + Math.random() * 5000));
    intervals.push(setInterval(() => {
      [220,196,174.6,164.8].forEach((f,i) => playTone({ freq: f, type: "triangle", gain: 0.035, duration: 0.8, delay: i * 0.7 }));
    }, 10000));
    return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { mg.disconnect(); } catch {} };
  },
  playful: (ctx) => {
    const intervals = []; const nodes = [];
    const mg = ctx.createGain(); mg.gain.value = 0.055; mg.connect(ctx.destination);
    const b = ctx.createOscillator(); b.type = "triangle"; b.frequency.value = 261.6;
    const bg2 = ctx.createGain(); bg2.gain.value = 0.15; b.connect(bg2); bg2.connect(mg); b.start(); nodes.push(b);
    const scale = [261.6,329.6,392,523.3,659.3,784,659.3,523.3]; let step = 0;
    intervals.push(setInterval(() => {
      try {
        playTone({ freq: scale[step % scale.length], type: "triangle", gain: 0.06, duration: 0.22 }); step++;
        if (step % 8 === 0) playTone({ freq: 1046, freq2: 523, gain: 0.05, duration: 0.4 });
      } catch {}
    }, 480));
    return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { mg.disconnect(); } catch {} };
  },
  warm: (ctx) => {
    const intervals = []; const nodes = [];
    const mg = ctx.createGain(); mg.gain.value = 0.055; mg.connect(ctx.destination);
    [196,246.9,293.7].forEach(f => {
      const p = ctx.createOscillator(); p.type = "sine"; p.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.18; p.connect(g); g.connect(mg); p.start(); nodes.push(p);
    });
    const mel = [392,440,493.9,523.3,493.9,440,392,349.2]; let ms = 0;
    intervals.push(setInterval(() => { try { playTone({ freq: mel[ms % mel.length], gain: 0.05, duration: 1.4 }); ms++; } catch {} }, 2400));
    intervals.push(setInterval(() => { playTone({ freq: 1046.5, gain: 0.035, duration: 2.0 }); }, 7000 + Math.random() * 3000));
    return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { mg.disconnect(); } catch {} };
  },
  african: (ctx) => {
    const intervals = []; const nodes = [];
    const mg = ctx.createGain(); mg.gain.value = 0.065; mg.connect(ctx.destination);
    const bd = ctx.createOscillator(); bd.type = "sine"; bd.frequency.value = 80;
    const bdg = ctx.createGain(); bdg.gain.value = 0.3;
    const bdf = ctx.createBiquadFilter(); bdf.type = "lowpass"; bdf.frequency.value = 180;
    bd.connect(bdf); bdf.connect(bdg); bdg.connect(mg); bd.start(); nodes.push(bd);
    const kora = [293.7,370,440,493.9,587.3,493.9,440,370]; let ks = 0;
    intervals.push(setInterval(() => {
      try { playTone({ freq: kora[ks % kora.length], type: "triangle", gain: 0.055, duration: 0.35 }); ks++; } catch {}
    }, 380));
    intervals.push(setInterval(() => {
      [0,760,1140].forEach(offset => {
        setTimeout(() => {
          try {
            const pitch = offset === 0 ? 120 : offset === 760 ? 100 : 140;
            const n = ctx.createOscillator(); n.type = "sine"; n.frequency.value = pitch;
            const g = ctx.createGain(); g.gain.setValueAtTime(0.45, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            n.connect(g); g.connect(mg); n.start(); n.stop(ctx.currentTime + 0.17);
          } catch {}
        }, offset);
      });
    }, 1520));
    intervals.push(setInterval(() => {
      playTone({ freq: 880, gain: 0.04, duration: 1.0 });
      setTimeout(() => playTone({ freq: 1108, gain: 0.03, duration: 0.8 }), 300);
    }, 5000 + Math.random() * 3000));
    return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { mg.disconnect(); } catch {} };
  },
  scifi: (ctx) => {
    const intervals = []; const nodes = [];
    const mg = ctx.createGain(); mg.gain.value = 0.05; mg.connect(ctx.destination);
    const drone = ctx.createOscillator(); drone.type = "square"; drone.frequency.value = 55;
    const df = ctx.createBiquadFilter(); df.type = "lowpass"; df.frequency.value = 150;
    const dg = ctx.createGain(); dg.gain.value = 0.3;
    drone.connect(df); df.connect(dg); dg.connect(mg); drone.start(); nodes.push(drone);
    const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.1;
    const lg = ctx.createGain(); lg.gain.value = 100;
    lfo.connect(lg); lg.connect(df.frequency); lfo.start(); nodes.push(lfo);
    intervals.push(setInterval(() => {
      try {
        const f = [440,880,1320,1760][Math.floor(Math.random()*4)];
        playTone({ freq: f, gain: 0.02, duration: 0.08 });
        setTimeout(() => playTone({ freq: f * 1.5, gain: 0.015, duration: 0.08 }), 150);
      } catch {}
    }, 4000 + Math.random() * 5000));
    return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { mg.disconnect(); } catch {} };
  },
};

function useAmbientMusic(trackId, muted) {
  const cleanupRef = useRef(null);
  useEffect(() => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (muted || !trackId || trackId === "none") return;
    try {
      const ctx = getAudio();
      const builder = trackBuilders[trackId];
      if (builder) cleanupRef.current = builder(ctx);
    } catch {}
    return () => { if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; } };
  }, [trackId, muted]);
}

function getSuggestedTrack(toneText) {
  if (!toneText) return "african";
  const t = toneText.toLowerCase();
  if (t.includes("epic") || t.includes("dramatic")) return "epic";
  if (t.includes("spooky") || t.includes("mysterious")) return "spooky";
  if (t.includes("funny") || t.includes("lighthearted")) return "playful";
  if (t.includes("heartwarming") || t.includes("hopeful")) return "warm";
  if (t.includes("sci") || t.includes("space") || t.includes("cosmic") || t.includes("futur")) return "scifi";
  return "african";
}

// ─── AI CALL ───
async function callAI(provider, apiKey, model, messages, systemPrompt) {
  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model, max_tokens: 4096, system: systemPrompt, messages }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    if (!res.ok) throw new Error(`Claude error: ${res.status}`);
    return data.content[0].text;
  }
  if (provider === "gemini") {
    const contents = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents, generationConfig: { maxOutputTokens: 4096, temperature: 0.9 } }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Gemini error ${res.status}. Check your API key.`);
    }
    const data = await res.json();
    return data.candidates[0].content.parts[0].text;
  }
  // DeepSeek and Groq use OpenAI-compatible format
  const base = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.groq.com/openai";
  const path = provider === "deepseek" ? "/chat/completions" : "/v1/chat/completions";
  const res = await fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: 4096, temperature: 0.9, messages: [{ role: "system", content: systemPrompt }, ...messages] }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `${provider} error ${res.status}. Check your API key.`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

// ─── WORLD GENERATION PROMPT ───
const WORLD_GEN_PROMPT = `Generate exactly 5 imaginative world options for a children's choose-your-own-adventure story (ages 7-9). Each world must be surprising, specific, and distinct from the others. Range from grounded to wildly fantastical. Do NOT use these overused settings: volcano city, robot teacher school, drifting ocean islands, talking jungle, unnamed space station. Return ONLY a JSON array of 5 objects with "title" (2-3 words) and "desc" (one vivid sentence). No markdown, no explanation.`;

// ─── SYSTEM PROMPT BUILDER ───
function buildSystemPrompt({ playerList, characterChoices, world, tone, duration, continuityMode, priorSessions, hasFamilyContext }) {
  const isSolo = playerList.length === 1;
  const isMulti = playerList.length > 2;

  let prompt = `You are a choose-your-own-adventure storyteller for children. You generate a story beat-by-beat. Each response must be ONLY a valid JSON object with no markdown, no code fences, no explanation. The JSON schema:\n{"narration":"string","turnLabel":"[NAME]'S TURN"|null,"beatType":"action"|"wonder"|"campfire"|"signature"|"closing","choicePrompt":"string"|null,"choices":[{"label":"A","text":"string"}]|null,"achievement":null|{"name":"string","description":"string"},"isEnding":false,"closingRitual":null}\n\nWhen isEnding is true, include closingRitual: {"walkAways":[{"player":"id","text":"string"}],"secretAchievements":[{"player":"id","name":"string","description":"string"}],"thread":"string","recap":"string"}\n\n`;

  // Player profiles
  prompt += "PLAYERS THIS SESSION:\n";
  playerList.forEach(p => {
    const known = KNOWN_PLAYERS[p.id];
    if (known) {
      prompt += `${known.fullName}, age ${known.age}, ${known.grade} grade. Reading level: ${known.reading}\n`;
    } else {
      prompt += `${p.name}, age ${p.age}. Reading level: ${readingLevelForAge(p.age)}\n`;
    }
    const cc = characterChoices[p.id];
    if (cc) {
      if (cc.type === "self") prompt += `  Playing as themselves.\n`;
      else if (cc.type === "known") prompt += `  Playing as: ${cc.name} (someone they know). Build from that name.\n`;
      else prompt += `  Playing as invented character: ${cc.name}. Build the rest through the story.\n`;
    }
  });

  // Session parameters
  prompt += `\nWORLD: ${world}\nTONE: ${tone}\n`;
  prompt += `DURATION: ${duration} minutes. `;
  if (duration === "20") prompt += "4-5 decision points, lean narration, one mechanic at most, tight ending.\n";
  else if (duration === "45") prompt += "6-8 decision points, fuller narration, 2-3 mechanics, complete closing ritual.\n";
  else prompt += "Up to 12 decision points, all mechanics available, extended campfire, full closing ritual with recap.\n";

  // Family cast (conditional)
  if (hasFamilyContext) prompt += `\n${FAMILY_CAST}\n`;

  // Core storytelling rules (condensed from CYOA prompt)
  prompt += `
STORY RULES:
- Generate the main conflict privately from the world and tone. Never reveal it upfront. The players discover the problem when the story begins.
- Open in one of three styles (rotate, never repeat): Movie Trailer (cinematic teaser, best for epic), Cold Open (drop into action, best for spooky), Quiet Before (stillness then crack, best for warm/mysterious).
- Structure: Act 1 (2-3 beats, first choice within two paragraphs), Act 2 (4-6 beats, raised stakes, one campfire, one wonder moment), Act 3 (1-2 beats, signature moment, clean ending in 3-5 sentences). Scale to duration.
- Early Stop Rule: If the story should wrap sooner, move to a shorter climax. Cut beats, not quality.

NARRATION:
- ${isSolo ? "Write in second person (you)." : "Write in third person using character names."}
- Keep paragraphs 2-4 sentences per beat. Use sensory details. Side characters must have personality.
- ${!isSolo ? "In joint sessions with different ages, write narration at the oldest player's level. Drop vocabulary for younger players' choice moments specifically." : ""}

CHARACTERS:
- Start each character with only: the name they chose, a vague role that fits the world, one small detail. Nothing more.
- Track choices silently as character-building. Courage, kindness, caution, humor all emerge from patterns.
- At campfire beats, reveal one: a hidden trait, a talent, a weapon's significance, or a single weighted choice.
- The emotional stakes question ("What would your character do anything to protect?") is asked at the first campfire. The answer feeds the villain design.
- Special abilities emerge through the story, not upfront. Offer as a single choice: "Something unlocks. Do you use it?"

VILLAIN:
- Design secretly after the campfire emotional stakes answer. Must have: a name, clear motivation (not just evil), non-obvious weakness, deep connection to the world.
- Vary the reveal point across sessions: end of Act 1, middle of Act 2, or Act 3 climax. Plant clues before reveal.

CONSEQUENCES:
- Wrong choices create real setbacks. Lost items stay lost. No free rescues unless set up earlier. Good choices can still cost something.
- Reference earlier choices later: "Remember when you kept the feather? That matters now."
- Three danger tiers (internal, never announced): Low (minor setback), Medium (serious setback), High (story-altering). Warning signal required before high-danger choices.
- Five failure types to vary: The Trap (sharp, immediate), Slow Collapse (stacking consequences), Betrayal (trust broken), Sacrifice Gone Wrong (good intentions backfire), Pyrrhic Victory (win at devastating cost).
- Dead End Protocol: If the path truly closes, say so and offer to return to last choice. Max once per session.

MECHANICS (optional, earned not scheduled):
- Legendary Visitor: Once per session max, a pop culture character appears triggered by a behavioral pattern or single decisive choice. Appears in one beat, gives one of four gift types (absorbed power, physical object, spoken truth, transferred trait), then leaves. Never stays, never recurs.
- Discovery Achievements: Max one per player per session. Triggered by courage, kindness, curiosity, creativity, or persistence. Announce immediately: "Achievement Unlocked: [Name]. [One sentence.]" Include a subtle persistent reward.
- Wonder Moments: Beautiful/magical, no danger. Simple curiosity choice. Between action beats or at new locations.
- Signature Moment: One per story. Single weighted choice, not a list. Near end of Act 2 or Act 3 climax.
- Secret Door: When a player investigates something off-menu, add a new lettered choice to the array. Never punish curiosity.
- The Glimpse (Foresight): Once per session, if a player faces a High-Danger choice, the world may offer them "A Glimpse." Add a special choice labeled "GLIMPSE" alongside the normal choices. If selected, the story DOES NOT advance. Do not change the plot state, do not trigger consequences, do not move to a new location. Instead, describe a brief, hazy vision of the immediate consequence of ONE of the other options, then re-present the exact same original choices (minus the Glimpse option) so they can make their final decision. Use at most once per session. Never announce it is available. Let it appear when the moment earns it.
- Celebrating Success: Pause one beat to let good choices land.

PACING:
- Alternate action, then discovery/character beat, then action.
- Quiet moment every 3-4 choices (campfire, funny side conversation, honest moment).
${isSolo ? "- Give solo players a companion character (animal, robot, magical creature) with personality but who does not take over decisions." : ""}
${!isSolo ? "- Alternate turns consistently. Each choice point labeled with turnLabel." : "- turnLabel is null for solo sessions."}

CLOSING RITUAL (when story ends):
- Set isEnding: true and populate closingRitual.
- Walk Away: One sentence per player about what they carry out.
- Secret Achievement: One per player, tracked silently, revealed as "The story noticed something about you today."
- Thread: One quiet unresolved sentence. A door ajar, not a cliffhanger.
- Recap: Include per player: traits revealed, powers gained, weapons/tools, injuries/losses, discovery achievements, secret achievement, reputation, unresolved threads, world changes. Two to four lines per player. This gets injected into future sessions.
- Tone note: This is often a bedtime activity. Settle, do not stimulate.

REPUTATION (cross-session):
- Patterns build reputations: Protector, Seeker, Braveheart, Clever Mind, The Light. Let the world name it first through NPCs.

SECRET ACHIEVEMENTS (ten examples): The Protector's Mark, The Patient Eye, The Fearless Step, The Honest Voice, The Unlikely Friend, The One Who Stayed, The Quick Thinker, The Weight Carrier, The Spark, The Steady One. Generate new ones freely. Names should sound earned, not childish.
`;

  // Three or more players
  if (isMulti) {
    prompt += `\nTHREE OR MORE PLAYERS RULES:\n- Turn rotation: youngest to oldest. State once.\n- Each younger player's choice moment drops to their reading level.\n- Humor protection: at least one funny moment per act for the youngest.\n- Campfire: ask each player the stakes question separately.\n- Legendary visitor: vary whether 1, 2, or all receive a visit.\n- Achievements tracked per player independently.\n- Pacing: rotation is slower. Reduce beats for short sessions.\n`;
  }

  // Humor protection
  if (!isSolo && playerList.length >= 2) {
    const ages = playerList.map(p => p.age).filter(Boolean);
    if (ages.length && Math.max(...ages) - Math.min(...ages) >= 2) {
      prompt += `\nHUMOR PROTECTION: At least one funny/surprising moment per act for the youngest player. It runs alongside the story, never deflates the older player's experience.\n`;
    }
  }

  // Continuity
  if (continuityMode === "continue" && priorSessions && priorSessions.length > 0) {
    prompt += `\nCONTINUITY MODE: Continue the Saga.\n- Open with a three-sentence cinematic "previously on" recap in story voice.\n- Ask each player how their character has changed since last time.\n- Carry forward earned powers, items, abilities.\n- Honor at least one unresolved thread.\n- Use one Story Echo (something from a prior adventure reappears without announcement).\n- Let the world respond to each player's reputation.\n\nPRIOR SESSIONS:\n`;
    priorSessions.forEach(s => {
      prompt += `Session: ${s.world} (${s.tone}, ${s.date})\nRecap: ${s.recap}\n`;
      if (s.playerData) Object.entries(s.playerData).forEach(([pid, d]) => {
        prompt += `  ${pid}: walkAway: ${d.walkAway || "n/a"}, thread: ${d.thread || "n/a"}\n`;
      });
    });
  }

  prompt += `\nIMPORTANT: Respond with ONLY the JSON object. No markdown code fences. No explanation. No text before or after the JSON.`;
  return prompt;
}

// ─── REUSABLE COMPONENTS ───
function PrimaryBtn({ onClick, children, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? C.textDim : `linear-gradient(135deg, ${C.green} 0%, #2a8f48 100%)`,
      color: C.cream, border: "none", borderRadius: 12, padding: "14px 28px",
      fontSize: 16, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
      width: "100%", opacity: disabled ? 0.5 : 1, transition: "all 0.2s", fontFamily: "inherit", ...style,
    }}>{children}</button>
  );
}

function ChoiceBtn({ label, text, onClick, color }) {
  return (
    <button onClick={onClick} className="choice-btn" style={{
      background: C.card, border: `1px solid ${color || C.border}`, borderRadius: 12,
      padding: "14px 18px", textAlign: "left", cursor: "pointer", width: "100%",
      display: "flex", gap: 12, alignItems: "flex-start", transition: "all 0.2s", fontFamily: "inherit",
    }}>
      <span style={{ color: color || C.gold, fontWeight: 700, fontSize: 18, flexShrink: 0 }}>{label}.</span>
      <span style={{ color: C.cream, fontSize: 15, lineHeight: 1.5 }}>{text}</span>
    </button>
  );
}

function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div style={{ background: "rgba(212,92,26,0.15)", border: `1px solid ${C.terra}`, borderRadius: 12, padding: 16 }}>
      <p style={{ color: C.terraLight, margin: 0, fontSize: 14 }}>{error}</p>
      {onRetry && <button onClick={onRetry} style={{ marginTop: 10, background: C.terra, color: C.cream, border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Try again</button>}
    </div>
  );
}

// ─── MAIN APP ───
export default function App() {
  // ── Phase ──
  const [phase, setPhase] = useState(() => getLS("momah_api_key") ? "setup_player" : "setup_key");

  // ── Provider / Key ──
  const [provider, setProvider] = useState(() => localStorage.getItem("momah_provider") || "anthropic");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("momah_api_key") || "");
  const [keyInput, setKeyInput] = useState("");
  const [showKeySetup, setShowKeySetup] = useState(false);

  // ── Players ──
  const [players, setPlayers] = useState(null); // "justina" | "nathaniel" | "both" | "custom" | "group"
  const [playerList, setPlayerList] = useState([]);
  const [characterChoices, setCharacterChoices] = useState({});
  const [playerColors, setPlayerColors] = useState({});
  const [charSetupIdx, setCharSetupIdx] = useState(0);
  const [customPlayerName, setCustomPlayerName] = useState("");
  const [customPlayerAge, setCustomPlayerAge] = useState("");
  const [groupEntries, setGroupEntries] = useState([{ name: "", age: "", _id: 1 }, { name: "", age: "", _id: 2 }]);
  let _nextGroupId = useRef(3);
  const [charType, setCharType] = useState("self");
  const [charCustomName, setCharCustomName] = useState("");
  const [wantsDifferent, setWantsDifferent] = useState(false);

  // ── Continuity ──
  const [continuityMode, setContinuityMode] = useState(null);
  const [allSessions, setAllSessions] = useState(() => getLS("momah_sessions") || []);
  const [allAchievements, setAllAchievements] = useState(() => getLS("momah_achievements") || {});

  // ── World / Tone / Duration ──
  const [worlds, setWorlds] = useState(null);
  const [worldsLoading, setWorldsLoading] = useState(false);
  const [worldObj, setWorldObj] = useState(null);
  const [customWorld, setCustomWorld] = useState("");
  const [toneObj, setToneObj] = useState(null);
  const [customTone, setCustomTone] = useState("");
  const [duration, setDuration] = useState(null);

  // ── Story ──
  const [messages, setMessages] = useState([]);
  const [beat, setBeat] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [beatCount, setBeatCount] = useState(0);
  const [isNewBeat, setIsNewBeat] = useState(false);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [retryPayload, setRetryPayload] = useState(null);

  // ── Typewriter ──
  const [visibleParas, setVisibleParas] = useState(0);
  const [showAllText, setShowAllText] = useState(false);
  const typewriterRef = useRef(null);

  // ── Audio ──
  const [muted, setMuted] = useState(() => localStorage.getItem("momah_mute") === "true");
  const [musicTrack, setMusicTrack] = useState("african");
  const [musicActive, setMusicActive] = useState(false);

  // Ambient music hook (from original app, proper cleanup)
  useAmbientMusic(musicActive ? musicTrack : "none", muted);
  // Keep global mute ref in sync for SFX calls outside component
  useEffect(() => { MuteRef.muted = muted; }, [muted]);

  // ── UI ──
  const [toast, setToast] = useState(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [dashTaps, setDashTaps] = useState(0);
  const dashTimer = useRef(null);

  // ── Saved story resume ──
  const [savedStory, setSavedStory] = useState(() => getLS("momah_saved_story"));

  // ── Loading timer ──
  useEffect(() => {
    if (!loading) { setLoadingSeconds(0); return; }
    const iv = setInterval(() => setLoadingSeconds(s => s + 1), 1000);
    return () => clearInterval(iv);
  }, [loading]);

  // ── Mute persist ──
  useEffect(() => { localStorage.setItem("momah_mute", muted ? "true" : "false"); }, [muted]);

  // ── Typewriter effect ──
  useEffect(() => {
    if (!beat || !isNewBeat || showAllText) return;
    const paras = (beat.narration || "").split(/\n+/).filter(Boolean);
    setVisibleParas(0);
    let i = 0;
    const iv = setInterval(() => {
      i++;
      if (i >= paras.length) { clearInterval(iv); setIsNewBeat(false); }
      setVisibleParas(i + 1);
    }, 1100);
    typewriterRef.current = iv;
    return () => clearInterval(iv);
  }, [beat, isNewBeat, showAllText]);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Auto-scroll to top on new beat ──
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [beat]);

  // ── Save story state after each beat ──
  useEffect(() => {
    if (phase === "story" && beat) {
      setLS("momah_saved_story", { players, playerList, characterChoices, playerColors, worldObj, customWorld, toneObj, customTone, duration, musicTrack, messages, beat, beatCount });
    }
  }, [beat, phase, players, playerList, characterChoices, playerColors, worldObj, customWorld, toneObj, customTone, duration, musicTrack, messages, beatCount]);

  // ── Helpers ──
  const worldText = worldObj === "custom" ? customWorld : (worldObj ? `${worldObj.title}: ${worldObj.desc}` : "");
  const toneText = toneObj === "custom" ? customTone : (toneObj ? toneObj.label : "");
  const hasFamilyContext = playerList.some(p => KNOWN_PLAYERS[p.id] || FAMILY_NAMES.includes(p.id));

  function getPriorSessions() {
    const ids = playerList.map(p => p.id);
    return allSessions.filter(s => {
      if (!s.playerList) return false;
      return s.playerList.some(sp => ids.includes(sp.id));
    }).slice(0, 3);
  }

  // ── Generate worlds ──
  const generateWorlds = useCallback(async () => {
    setWorldsLoading(true);
    try {
      const provObj = PROVIDERS.find(p => p.id === provider);
      const raw = await callAI(provider, apiKey, provObj.model, [{ role: "user", content: WORLD_GEN_PROMPT }], "You generate creative story world options for children. Respond only with a valid JSON array, no markdown, no explanation.");
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const arrMatch = cleaned.match(/\[[\s\S]*\]/);
      if (!arrMatch) throw new Error("No array found");
      const parsed = JSON.parse(arrMatch[0]);
      if (Array.isArray(parsed) && parsed.length >= 5) setWorlds(parsed.slice(0, 5));
      else setWorlds(FALLBACK_WORLDS);
    } catch { setWorlds(FALLBACK_WORLDS); }
    setWorldsLoading(false);
  }, [provider, apiKey]);

  // ── Send story beat ──
  async function sendBeat(userMsg) {
    if (loading) return;
    setLoading(true); setError(null); setLoadingSeconds(0);
    const newMessages = userMsg ? [...messages, { role: "user", content: userMsg }] : messages;
    const priorSessions = continuityMode === "continue" ? getPriorSessions() : [];
    const sysPrompt = buildSystemPrompt({ playerList, characterChoices, world: worldText, tone: toneText, duration, continuityMode, priorSessions, hasFamilyContext });
    const provObj = PROVIDERS.find(p => p.id === provider);
    try {
      const raw = await callAI(provider, apiKey, provObj.model, newMessages.length === 0 ? [{ role: "user", content: "Begin the story." }] : newMessages, sysPrompt);
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      let parsed;
      try { parsed = JSON.parse(cleaned); } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
        else throw new Error("Could not parse AI response as JSON.");
      }

      const assistantMsg = { role: "assistant", content: raw };
      const updatedMessages = [...newMessages, ...(newMessages.length === 0 ? [{ role: "user", content: "Begin the story." }] : []), assistantMsg];
      setMessages(updatedMessages);
      setBeat(parsed);
      setBeatCount(c => c + 1);
      setIsNewBeat(true);
      setShowAllText(false);
      setVisibleParas(0);
      SFX.next();

      if (parsed.achievement) {
        setToast(parsed.achievement);
        SFX.achievement();
        const updated = { ...allAchievements };
        playerList.forEach(p => {
          if (!updated[p.id]) updated[p.id] = [];
          updated[p.id].push({ ...parsed.achievement, date: new Date().toLocaleDateString() });
        });
        setAllAchievements(updated);
        setLS("momah_achievements", updated);
      }

      if (parsed.isEnding) {
        // Save session
        const session = {
          id: Date.now(), date: new Date().toLocaleDateString(),
          players, playerList, world: worldText, tone: toneText, recap: parsed.closingRitual?.recap || "",
          playerData: {},
        };
        if (parsed.closingRitual) {
          (parsed.closingRitual.walkAways || []).forEach(w => {
            if (!session.playerData[w.player]) session.playerData[w.player] = {};
            session.playerData[w.player].walkAway = w.text;
          });
          (parsed.closingRitual.secretAchievements || []).forEach(a => {
            const updated = { ...allAchievements };
            if (!updated[a.player]) updated[a.player] = [];
            updated[a.player].push({ name: a.name, description: a.description, date: new Date().toLocaleDateString(), secret: true });
            setAllAchievements(updated);
            setLS("momah_achievements", updated);
          });
        }
        playerList.forEach(p => {
          if (!session.playerData[p.id]) session.playerData[p.id] = {};
          session.playerData[p.id].thread = parsed.closingRitual?.thread || "";
        });
        const updatedSessions = [session, ...allSessions].slice(0, 20);
        setAllSessions(updatedSessions);
        setLS("momah_sessions", updatedSessions);
        localStorage.removeItem("momah_saved_story");
        setPhase("closing");
      }
    } catch (e) {
      setError(e.message || "Something went wrong. Try again.");
      setRetryPayload(userMsg);
    }
    setLoading(false);
  }

  // ── Resume saved story ──
  function resumeStory(saved) {
    setPlayers(saved.players); setPlayerList(saved.playerList); setCharacterChoices(saved.characterChoices);
    setPlayerColors(saved.playerColors || {}); setWorldObj(saved.worldObj); setCustomWorld(saved.customWorld || "");
    setToneObj(saved.toneObj); setCustomTone(saved.customTone || ""); setDuration(saved.duration);
    setMusicTrack(saved.musicTrack || "african"); setMessages(saved.messages || []);
    setBeat(saved.beat); setBeatCount(saved.beatCount || 0); setIsNewBeat(false); setShowAllText(true);
    setVisibleParas(999); setMusicActive(true); setPhase("story");
  }

  // ── Reset to start ──
  function resetToStart() {
    setPhase("setup_player"); setPlayers(null); setPlayerList([]); setCharacterChoices({});
    setPlayerColors({}); setCharSetupIdx(0); setContinuityMode(null); setWorlds(null); setWorldObj(null);
    setCustomWorld(""); setToneObj(null); setCustomTone(""); setDuration(null); setMessages([]);
    setBeat(null); setBeatCount(0); setError(null); setShowConfirmReset(false); setShowExport(false);
    setShowDashboard(false); setSavedStory(null); setMusicActive(false);
  }

  // ── TTS ──
  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\n/g, " "));
    u.rate = 0.95; window.speechSynthesis.speak(u);
  }
  function stopSpeak() { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); }

  // ── Export ──
  function exportText() {
    let text = `MOMAH ADVENTURE\nPlayers: ${playerList.map(p => p.name).join(", ")}\nWorld: ${worldText}\nTone: ${toneText}\nDate: ${new Date().toLocaleDateString()}\n\n`;
    messages.forEach(m => { if (m.role === "assistant") { try { const b = JSON.parse(m.content.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim()); text += (b.narration || "") + "\n\n"; } catch { text += m.content + "\n\n"; } } else if (m.role === "user" && m.content !== "Begin the story.") { text += `> ${m.content}\n\n`; } });
    if (beat?.closingRitual) {
      text += "--- CLOSING RITUAL ---\n";
      (beat.closingRitual.walkAways || []).forEach(w => { text += `${w.player}: ${w.text}\n`; });
      (beat.closingRitual.secretAchievements || []).forEach(a => { text += `Achievement (${a.player}): ${a.name} - ${a.description}\n`; });
      if (beat.closingRitual.thread) text += `Thread: ${beat.closingRitual.thread}\n`;
      if (beat.closingRitual.recap) text += `\nRecap: ${beat.closingRitual.recap}\n`;
    }
    return text;
  }

  function copyExport() {
    navigator.clipboard.writeText(exportText()).catch(() => {
      const ta = document.createElement("textarea"); ta.value = exportText();
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    });
  }

  function printExport() {
    const w = window.open("", "_blank");
    w.document.write(`<html><head><title>Momah Adventure</title><style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:20px;line-height:1.7;color:#222}h1{font-size:24px}pre{white-space:pre-wrap}</style></head><body><pre>${exportText()}</pre></body></html>`);
    w.document.close(); setTimeout(() => w.print(), 500);
  }

  // ── Dashboard tap handler ──
  function handleDashTap() {
    setDashTaps(d => d + 1);
    clearTimeout(dashTimer.current);
    dashTimer.current = setTimeout(() => setDashTaps(0), 2000);
    if (dashTaps >= 2) { setShowDashboard(true); setDashTaps(0); }
  }

  // ── Start story ──
  function startStory() {
    SFX.begin();
    setMusicActive(true);
    setPhase("loading");
    setTimeout(() => { setPhase("story"); sendBeat(null); }, 100);
  }

  // ── RENDER ──
  const shell = (title, children, showBack, onBack) => (
    <div style={{ minHeight: "100vh", background: C.ink, color: C.cream, fontFamily: "'Playfair Display', Georgia, serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 20px", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, minHeight: 40 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {showBack && <button onClick={() => { SFX.back(); onBack?.(); }} style={{ background: "none", border: "none", color: C.creamDim, fontSize: 22, cursor: "pointer", padding: 4 }}>←</button>}
            <span onClick={phase === "story" || phase === "closing" ? handleDashTap : undefined} style={{ color: C.textDim, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", cursor: phase === "story" || phase === "closing" ? "pointer" : "default", userSelect: "none" }}>
              {title || "Momah Adventure"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {(phase === "story" || phase === "closing") && (
              <div style={{ display: "flex", gap: 4, marginRight: 8 }}>
                {Array.from({ length: Math.min(beatCount, 12) }).map((_, i) => (
                  <div key={i} style={{ width: i === beatCount - 1 ? 8 : 6, height: i === beatCount - 1 ? 8 : 6, borderRadius: "50%", background: C.gold, opacity: i === beatCount - 1 ? 1 : 0.4, transition: "all 0.3s" }} />
                ))}
              </div>
            )}
            {phase === "story" && <button onClick={() => setShowConfirmReset(true)} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 8, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>New</button>}
            <button onClick={() => { setShowKeySetup(true); }} style={{ background: "none", border: "none", color: C.creamDim, fontSize: 18, cursor: "pointer", padding: 4 }}>🔑</button>
            <button onClick={() => setMuted(m => !m)} style={{ background: "none", border: "none", color: C.creamDim, fontSize: 18, cursor: "pointer", padding: 4 }}>
              {muted ? "🔇" : "🔊"}
            </button>
          </div>
        </div>
        {children}
      </div>

      {/* Key setup overlay */}
      {showKeySetup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, maxWidth: 400, width: "100%" }}>
            <h3 style={{ color: C.gold, margin: "0 0 16px" }}>AI Provider</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {PROVIDERS.map(p => (
                <button key={p.id} onClick={() => setProvider(p.id)} style={{
                  background: provider === p.id ? C.green : "transparent", border: `1px solid ${provider === p.id ? C.green : C.textDim}`,
                  color: C.cream, borderRadius: 8, padding: "10px 14px", cursor: "pointer", textAlign: "left", fontSize: 14, fontFamily: "inherit",
                }}>{p.label}</button>
              ))}
            </div>
            <input value={keyInput || apiKey} onChange={e => setKeyInput(e.target.value)} placeholder="Paste your API key" type="password"
              style={{ width: "100%", background: C.ink, border: `1px solid ${C.textDim}`, borderRadius: 8, padding: "10px 14px", color: C.cream, fontSize: 14, marginBottom: 16, boxSizing: "border-box", fontFamily: "inherit" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <PrimaryBtn onClick={() => {
                const k = (keyInput || apiKey).trim();
                const valid = provider === "anthropic" ? k.startsWith("sk-ant") : k.length > 10;
                if (valid) { setApiKey(k); localStorage.setItem("momah_api_key", k); localStorage.setItem("momah_provider", provider); setShowKeySetup(false); if (phase === "setup_key") setPhase("setup_player"); }
              }}>Save</PrimaryBtn>
              <button onClick={() => setShowKeySetup(false)} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 12, padding: "14px 20px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm reset modal */}
      {showConfirmReset && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, maxWidth: 360, width: "100%", textAlign: "center" }}>
            <p style={{ color: C.cream, fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Abandon this adventure?</p>
            <p style={{ color: C.creamDim, fontSize: 14, marginBottom: 20 }}>Your progress will not be saved.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { localStorage.removeItem("momah_saved_story"); resetToStart(); }} style={{ flex: 1, background: C.terra, color: C.cream, border: "none", borderRadius: 10, padding: "12px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>Leave anyway</button>
              <button onClick={() => setShowConfirmReset(false)} style={{ flex: 1, background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 10, padding: "12px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>Keep playing</button>
            </div>
          </div>
        </div>
      )}

      {/* Export modal */}
      {showExport && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, maxWidth: 360, width: "100%", textAlign: "center" }}>
            <p style={{ color: C.gold, fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Save this Story</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <PrimaryBtn onClick={() => { copyExport(); setToast({ name: "Copied!", description: "Story copied to clipboard" }); }}>Copy Text</PrimaryBtn>
              <button onClick={printExport} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 12, padding: "14px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>Print / PDF</button>
              <button onClick={() => setShowExport(false)} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 13, marginTop: 8, fontFamily: "inherit" }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Dashboard */}
      {showDashboard && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 100, overflow: "auto", padding: 20 }}>
          <div style={{ maxWidth: 500, margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ color: C.gold, margin: 0 }}>Parent Dashboard</h2>
              <button onClick={() => setShowDashboard(false)} style={{ background: "none", border: "none", color: C.creamDim, fontSize: 24, cursor: "pointer" }}>✕</button>
            </div>
            <h3 style={{ color: C.cream, fontSize: 16 }}>Achievements</h3>
            {Object.entries(allAchievements).map(([pid, achs]) => (
              <div key={pid} style={{ marginBottom: 16 }}>
                <p style={{ color: C.gold, fontWeight: 600, marginBottom: 4 }}>{pid} ({achs.length})</p>
                {achs.map((a, i) => (
                  <p key={i} style={{ color: C.creamDim, fontSize: 13, margin: "2px 0", paddingLeft: 12 }}>
                    {a.secret ? "🤫" : "🏆"} {a.name} {a.date ? `(${a.date})` : ""} {a.description ? ` — ${a.description}` : ""}
                  </p>
                ))}
              </div>
            ))}
            {Object.keys(allAchievements).length === 0 && <p style={{ color: C.textDim, fontSize: 14 }}>No achievements yet.</p>}
            <h3 style={{ color: C.cream, fontSize: 16, marginTop: 24 }}>Session History</h3>
            {allSessions.map((s, i) => (
              <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 8 }}>
                <p style={{ color: C.gold, fontWeight: 600, margin: 0, fontSize: 14 }}>{s.world}</p>
                <p style={{ color: C.textDim, fontSize: 12, margin: "2px 0" }}>{s.date} · {s.tone}</p>
                {s.recap && <p style={{ color: C.creamDim, fontSize: 12, margin: "6px 0 0", lineHeight: 1.4 }}>{s.recap.slice(0, 200)}{s.recap.length > 200 ? "..." : ""}</p>}
              </div>
            ))}
            {allSessions.length === 0 && <p style={{ color: C.textDim, fontSize: 14 }}>No sessions yet.</p>}
            <button onClick={() => {
              if (window.confirm("Clear all achievements and sessions?")) {
                setAllAchievements({}); setAllSessions([]); setLS("momah_achievements", {}); setLS("momah_sessions", []);
              }
            }} style={{ marginTop: 20, background: "rgba(212,92,26,0.2)", border: `1px solid ${C.terra}`, color: C.terraLight, borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Clear all data</button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: `linear-gradient(135deg, ${C.green} 0%, #2a8f48 100%)`,
          color: C.cream, padding: "12px 24px", borderRadius: 12, zIndex: 200, textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          animation: "slideDown 0.3s ease-out",
        }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>🏆 Achievement Unlocked: {toast.name}</p>
          <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.9 }}>{toast.description}</p>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: ${C.ink}; }
        input::placeholder { color: ${C.textDim}; }
        @keyframes slideDown { from { transform: translateX(-50%) translateY(-20px); opacity: 0; } to { transform: translateX(-50%) translateY(0); opacity: 1; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer { 0%,100% { opacity:0.4; } 50% { opacity:0.8; } }
        @keyframes toastIn { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:translateX(0); } }
        .chip-btn:hover { transform: translateX(3px); filter: brightness(1.12); border-color: rgba(245,200,66,0.5) !important; }
        .choice-btn:hover { background: rgba(245,200,66,0.07) !important; transform: translateX(5px); }
        .primary-btn:hover { transform: scale(1.02); filter: brightness(1.1); }
        input:focus { border-color: rgba(245,200,66,0.5) !important; box-shadow: 0 0 0 3px rgba(245,200,66,0.08); }
        .ankara-border { position: relative; }
        .ankara-border::before {
          content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
          background: linear-gradient(135deg, #f5c842 0%, #d45c1a 25%, #1e6b35 50%, #d45c1a 75%, #f5c842 100%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude;
          pointer-events: none; animation: shimmer 4s ease-in-out infinite;
        }
        .adinkra-bg {
          background-image:
            radial-gradient(circle at 20% 20%, rgba(30,107,53,0.08) 0%, transparent 50%),
            radial-gradient(circle at 80% 80%, rgba(212,92,26,0.06) 0%, transparent 50%),
            radial-gradient(circle at 50% 50%, rgba(245,200,66,0.03) 0%, transparent 70%);
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: rgba(245,200,66,0.3); border-radius: 4px; }
      `}</style>
    </div>
  );

  // ═══════════════════════════════════════
  // PHASE: SETUP_KEY
  // ═══════════════════════════════════════
  if (phase === "setup_key") {
    const PROVIDER_INFO = [
      { id: "anthropic", emoji: "🤖", label: "Claude", sub: "Best storytelling", url: "console.anthropic.com", placeholder: "sk-ant-api03-...", validate: v => v.startsWith("sk-ant") },
      { id: "gemini", emoji: "✨", label: "Gemini", sub: "Free tier available", url: "aistudio.google.com", placeholder: "AIzaSy...", validate: v => v.length > 10 },
      { id: "deepseek", emoji: "🐋", label: "DeepSeek", sub: "Cheapest option", url: "platform.deepseek.com", placeholder: "sk-...", validate: v => v.length > 10 },
      { id: "groq", emoji: "⚡", label: "Groq", sub: "Fastest responses", url: "console.groq.com", placeholder: "gsk_...", validate: v => v.length > 10 },
    ];
    const current = PROVIDER_INFO.find(p => p.id === provider) || PROVIDER_INFO[0];
    const keyValid = keyInput.trim().length > 0 && current.validate(keyInput.trim());

    return shell("Setup", (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 20 }}>
      <div style={{ textAlign: "center", marginBottom: 10 }}>
        <p style={{ fontSize: 32, margin: 0 }}>📖</p>
        <h1 style={{ color: C.gold, fontSize: 26, margin: "8px 0 4px", fontWeight: 800 }}>Momah Adventure</h1>
        <p style={{ color: C.creamDim, fontSize: 14, margin: 0 }}>Pick a provider and paste your API key</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {PROVIDER_INFO.map(p => (
          <button key={p.id} className="chip-btn" onClick={() => { SFX.select(); setProvider(p.id); setKeyInput(""); localStorage.setItem("momah_provider", p.id); }} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "12px 8px",
            border: `2px solid ${provider === p.id ? C.gold : "rgba(245,200,66,0.15)"}`,
            borderRadius: 12, cursor: "pointer", transition: "all 0.18s",
            background: provider === p.id ? "rgba(245,200,66,0.08)" : "rgba(255,255,255,0.03)", fontFamily: "inherit",
            boxShadow: provider === p.id ? "0 0 16px rgba(245,200,66,0.15)" : "none",
          }}>
            <span style={{ fontSize: 24 }}>{p.emoji}</span>
            <span style={{ color: provider === p.id ? C.gold : C.cream, fontWeight: 700, fontSize: 14 }}>{p.label}</span>
            <span style={{ color: C.textDim, fontSize: 11, textAlign: "center" }}>{p.sub}</span>
          </button>
        ))}
      </div>
      <div>
        <label style={{ display: "block", color: C.textDim, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.3, marginBottom: 6 }}>
          {current.label} API Key
        </label>
        <input value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder={current.placeholder} type="password"
          onKeyDown={e => { if (e.key === "Enter" && keyValid) { setApiKey(keyInput.trim()); localStorage.setItem("momah_api_key", keyInput.trim()); setPhase("setup_player"); } }}
          style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", color: C.cream, fontSize: 14, boxSizing: "border-box", fontFamily: "monospace" }} />
        <p style={{ color: C.textDim, fontSize: 12, margin: "8px 0 0" }}>
          Get your key at <span style={{ color: C.gold }}>{current.url}</span>
        </p>
      </div>
      <PrimaryBtn disabled={!keyValid} onClick={() => {
        const k = keyInput.trim();
        setApiKey(k); localStorage.setItem("momah_api_key", k); localStorage.setItem("momah_provider", provider);
        setPhase("setup_player");
      }}>Save & Start Adventure</PrimaryBtn>
    </div>
  ));
  }

  // ═══════════════════════════════════════
  // PHASE: SETUP_PLAYER
  // ═══════════════════════════════════════
  if (phase === "setup_player") return shell("Who's Playing?", (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, paddingTop: 20 }}>
      <h2 style={{ color: C.gold, fontSize: 22, margin: "0 0 8px", fontWeight: 700 }}>Who is playing today?</h2>

      {savedStory && (
        <div style={{ background: C.card, border: `1px solid ${C.gold}40`, borderRadius: 12, padding: 14, marginBottom: 8 }}>
          <p style={{ color: C.gold, fontWeight: 600, margin: "0 0 6px", fontSize: 14 }}>📖 Saved adventure found</p>
          <p style={{ color: C.creamDim, fontSize: 13, margin: "0 0 10px" }}>{savedStory.worldObj?.title || savedStory.customWorld || "In progress"}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => resumeStory(savedStory)} style={{ flex: 1, background: C.green, color: C.cream, border: "none", borderRadius: 8, padding: "10px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Resume</button>
            <button onClick={() => { localStorage.removeItem("momah_saved_story"); setSavedStory(null); }} style={{ flex: 1, background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 8, padding: "10px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Start fresh</button>
          </div>
        </div>
      )}

      {[
        { key: "justina", label: "Justina", sub: "Age 9, 4th grade", color: C.justina },
        { key: "nathaniel", label: "Nathaniel", sub: "Age 7, 2nd grade", color: C.nathaniel },
        { key: "both", label: "Both together", sub: "Joint adventure", color: C.gold },
      ].map(opt => (
        <button key={opt.key} onClick={() => {
          SFX.select();
          setPlayers(opt.key);
          let list;
          if (opt.key === "justina") list = [{ ...KNOWN_PLAYERS.justina, isKnown: true }];
          else if (opt.key === "nathaniel") list = [{ ...KNOWN_PLAYERS.nathaniel, isKnown: true }];
          else list = [{ ...KNOWN_PLAYERS.justina, isKnown: true }, { ...KNOWN_PLAYERS.nathaniel, isKnown: true }];
          setPlayerList(list); setCharacterChoices({});
          const prior = allSessions.filter(s => s.playerList?.some(sp => list.map(l => l.id).includes(sp.id))).slice(0, 3);
          if (prior.length > 0) setPhase("setup_continuity");
          else { setPhase("setup_world"); generateWorlds(); }
        }} style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px",
          cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 14, transition: "all 0.2s", fontFamily: "inherit",
        }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: `${opt.color}20`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 20 }}>{opt.key === "both" ? "👫" : "🧒"}</span>
          </div>
          <div>
            <p style={{ color: C.cream, fontWeight: 600, margin: 0, fontSize: 16 }}>{opt.label}</p>
            <p style={{ color: C.textDim, margin: 0, fontSize: 13 }}>{opt.sub}</p>
          </div>
        </button>
      ))}

      <button onClick={() => {
        SFX.select();
        setPlayers("custom");
        setPhase("setup_character"); setCharSetupIdx(0);
        setPlayerList([]);
      }} style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px",
        cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 14, fontFamily: "inherit",
      }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: `${C.gold}20`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 20 }}>✨</span>
        </div>
        <div>
          <p style={{ color: C.cream, fontWeight: 600, margin: 0, fontSize: 16 }}>Someone else</p>
          <p style={{ color: C.textDim, margin: 0, fontSize: 13 }}>Enter a name and age</p>
        </div>
      </button>

      <button onClick={() => {
        SFX.select();
        setPlayers("group"); _nextGroupId.current = 3; setGroupEntries([{ name: "", age: "", _id: 1 }, { name: "", age: "", _id: 2 }]);
        setPhase("setup_character"); setCharSetupIdx(-1);
      }} style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px",
        cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 14, fontFamily: "inherit",
      }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: `${C.gold}20`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 20 }}>👥</span>
        </div>
        <div>
          <p style={{ color: C.cream, fontWeight: 600, margin: 0, fontSize: 16 }}>A group</p>
          <p style={{ color: C.textDim, margin: 0, fontSize: 13 }}>Multiple players</p>
        </div>
      </button>
    </div>
  ), false);

  // ═══════════════════════════════════════
  // PHASE: SETUP_CHARACTER
  // ═══════════════════════════════════════
  if (phase === "setup_character") {
    // Group entry mode
    if (players === "group" && charSetupIdx === -1) {
      return shell("Players", (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, paddingTop: 20 }}>
          <h2 style={{ color: C.gold, fontSize: 22, margin: 0, fontWeight: 700 }}>Who is in the group?</h2>
          {groupEntries.map((g, i) => (
            <div key={g._id} style={{ display: "flex", gap: 8 }}>
              <input value={g.name} onChange={e => { const u = [...groupEntries]; u[i].name = e.target.value; setGroupEntries(u); }} placeholder={`Player ${i + 1} name`}
                style={{ flex: 2, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", color: C.cream, fontSize: 14, fontFamily: "inherit" }} />
              <input value={g.age} onChange={e => { const u = [...groupEntries]; u[i].age = e.target.value; setGroupEntries(u); }} placeholder="Age" type="number"
                style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", color: C.cream, fontSize: 14, fontFamily: "inherit" }} />
            </div>
          ))}
          <button onClick={() => { setGroupEntries([...groupEntries, { name: "", age: "", _id: _nextGroupId.current++ }]); }} style={{ background: "none", border: `1px dashed ${C.textDim}`, color: C.creamDim, borderRadius: 10, padding: "10px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>+ Add player</button>
          <PrimaryBtn disabled={groupEntries.filter(g => g.name.trim() && g.age).length < 2} onClick={() => {
            const list = groupEntries.filter(g => g.name.trim() && g.age).map(g => {
              const id = KNOWN_PLAYERS[g.name.trim().toLowerCase()] ? g.name.trim().toLowerCase() : sanitizeId(g.name.trim());
              return { id, name: g.name.trim(), age: parseInt(g.age), isKnown: !!KNOWN_PLAYERS[id] };
            });
            setPlayerList(list); setPlayerColors(assignColors(list));
            setCharSetupIdx(0); // Move to per-player character choice
          }}>Continue</PrimaryBtn>
        </div>
      ), true, () => { setPhase("setup_player"); });
    }

    // Custom single player entry
    if (players === "custom" && playerList.length === 0) {
      return shell("Who Are You?", (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, paddingTop: 20 }}>
          <h2 style={{ color: C.gold, fontSize: 22, margin: 0, fontWeight: 700 }}>What is your name?</h2>
          <input value={customPlayerName} onChange={e => setCustomPlayerName(e.target.value)} placeholder="Your name"
            style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", color: C.cream, fontSize: 15, boxSizing: "border-box", fontFamily: "inherit" }} />
          <input value={customPlayerAge} onChange={e => setCustomPlayerAge(e.target.value)} placeholder="Your age" type="number"
            style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", color: C.cream, fontSize: 15, boxSizing: "border-box", fontFamily: "inherit" }} />
          <PrimaryBtn disabled={!customPlayerName.trim() || !customPlayerAge} onClick={() => {
            const id = sanitizeId(customPlayerName.trim());
            const list = [{ id, name: customPlayerName.trim(), age: parseInt(customPlayerAge), isKnown: !!KNOWN_PLAYERS[id] }];
            setPlayerList(list); setPlayerColors(assignColors(list));
            setCharSetupIdx(0);
          }}>Continue</PrimaryBtn>
        </div>
      ), true, () => { setPhase("setup_player"); });
    }

    // Per-player character choice
    if (charSetupIdx >= 0 && charSetupIdx < playerList.length) {
      const p = playerList[charSetupIdx];
      const isKnown = p.isKnown;
      if (isKnown && !wantsDifferent) {
        // Auto-skip for known players, but offer toggle
        const autoAdvance = () => {
          setCharacterChoices(prev => ({ ...prev, [p.id]: { type: "self", name: p.name, age: p.age } }));
          const next = charSetupIdx + 1;
          if (next < playerList.length) setCharSetupIdx(next);
          else {
            const prior = allSessions.filter(s => s.playerList?.some(sp => playerList.map(l => l.id).includes(sp.id))).slice(0, 3);
            if (prior.length > 0) setPhase("setup_continuity");
            else { setPhase("setup_world"); generateWorlds(); }
          }
        };
        // Auto-advance after a brief moment for known players
        return shell(`${p.name}'s Character`, (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, paddingTop: 20 }}>
            <h2 style={{ color: getPlayerColor(p.id, playerColors), fontSize: 22, margin: 0, fontWeight: 700 }}>{p.name}</h2>
            <p style={{ color: C.creamDim, fontSize: 15 }}>Playing as themselves.</p>
            <button onClick={() => setWantsDifferent(true)} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Play as someone different?</button>
            <PrimaryBtn onClick={autoAdvance}>Continue as {p.name}</PrimaryBtn>
          </div>
        ), true, () => { if (charSetupIdx > 0) setCharSetupIdx(charSetupIdx - 1); else setPhase("setup_player"); });
      }

      return shell(`${p.name}'s Character`, (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, paddingTop: 20 }}>
          <h2 style={{ color: getPlayerColor(p.id, playerColors), fontSize: 22, margin: 0, fontWeight: 700 }}>{p.name}, who do you want to be?</h2>
          {["self", "known", "invented"].map(t => (
            <button key={t} onClick={() => { setCharType(t); if (t === "self") setCharCustomName(p.name); else setCharCustomName(""); }} style={{
              background: charType === t ? C.green : C.card, border: `1px solid ${charType === t ? C.green : C.border}`,
              color: C.cream, borderRadius: 12, padding: "14px 18px", cursor: "pointer", textAlign: "left", fontSize: 15, fontFamily: "inherit",
            }}>
              {t === "self" ? `Yourself (${p.name})` : t === "known" ? "Someone you know" : "A made-up character"}
            </button>
          ))}
          {charType !== "self" && (
            <input value={charCustomName} onChange={e => setCharCustomName(e.target.value)} placeholder={charType === "known" ? "Who? (name)" : "Character name or description"}
              style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", color: C.cream, fontSize: 15, boxSizing: "border-box", fontFamily: "inherit" }} />
          )}
          <PrimaryBtn disabled={charType !== "self" && !charCustomName.trim()} onClick={() => {
            setCharacterChoices(prev => ({ ...prev, [p.id]: { type: charType, name: charType === "self" ? p.name : charCustomName.trim(), age: p.age } }));
            setWantsDifferent(false); setCharType("self"); setCharCustomName("");
            const next = charSetupIdx + 1;
            if (next < playerList.length) setCharSetupIdx(next);
            else {
              const prior = allSessions.filter(s => s.playerList?.some(sp => playerList.map(l => l.id).includes(sp.id))).slice(0, 3);
              if (prior.length > 0) setPhase("setup_continuity");
              else { setPhase("setup_world"); generateWorlds(); }
            }
          }}>Continue</PrimaryBtn>
        </div>
      ), true, () => { setWantsDifferent(false); if (charSetupIdx > 0) setCharSetupIdx(charSetupIdx - 1); else setPhase("setup_player"); });
    }
  }

  // ═══════════════════════════════════════
  // PHASE: SETUP_CONTINUITY
  // ═══════════════════════════════════════
  if (phase === "setup_continuity") {
    const prior = allSessions.filter(s => s.playerList?.some(sp => playerList.map(l => l.id).includes(sp.id))).slice(0, 3);
    return shell("Continue?", (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, paddingTop: 20 }}>
        <h2 style={{ color: C.gold, fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>Continue your saga?</h2>
        <p style={{ color: C.creamDim, fontSize: 14, margin: 0 }}>You have {prior.length} previous adventure{prior.length > 1 ? "s" : ""}.</p>
        {prior.map((s, i) => (
          <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
            <p style={{ color: C.cream, fontWeight: 600, margin: 0, fontSize: 14 }}>{s.world}</p>
            <p style={{ color: C.textDim, fontSize: 12, margin: "2px 0" }}>{s.date}</p>
          </div>
        ))}
        <PrimaryBtn onClick={() => { setContinuityMode("continue"); setPhase("setup_world"); generateWorlds(); }}>Continue the Saga</PrimaryBtn>
        <button onClick={() => { setContinuityMode("fresh"); setPhase("setup_world"); generateWorlds(); }} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 12, padding: "14px", cursor: "pointer", fontSize: 15, fontFamily: "inherit" }}>Brand New Adventure</button>
      </div>
    ), true, () => setPhase("setup_player"));
  }

  // ═══════════════════════════════════════
  // PHASE: SETUP_WORLD
  // ═══════════════════════════════════════
  if (phase === "setup_world") {
    const displayWorlds = worlds || FALLBACK_WORLDS;
    return shell("World", (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, paddingTop: 20 }}>
        <h2 style={{ color: C.gold, fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>Where does the story take place?</h2>
        {worldsLoading && <p style={{ color: C.creamDim, fontSize: 14, animation: "pulse 1.5s infinite" }}>Generating worlds...</p>}
        {displayWorlds.map((w, i) => (
          <button key={i} onClick={() => { SFX.select(); setWorldObj(w); setPhase("setup_tone"); }} style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px",
            cursor: "pointer", textAlign: "left", fontFamily: "inherit", transition: "all 0.2s",
          }}>
            <p style={{ color: C.cream, fontWeight: 600, margin: 0, fontSize: 15 }}>{w.title}</p>
            <p style={{ color: C.creamDim, margin: "4px 0 0", fontSize: 13 }}>{w.desc}</p>
          </button>
        ))}
        <button onClick={() => { setWorldObj("custom"); }} style={{
          background: worldObj === "custom" ? C.card : "transparent", border: `1px dashed ${C.textDim}`, borderRadius: 12, padding: "14px 18px",
          cursor: "pointer", textAlign: "left", color: C.creamDim, fontSize: 14, fontFamily: "inherit",
        }}>✨ Somewhere totally different...</button>
        {worldObj === "custom" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input value={customWorld} onChange={e => setCustomWorld(e.target.value)} placeholder="Describe your world"
              style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", color: C.cream, fontSize: 14, boxSizing: "border-box", fontFamily: "inherit" }} />
            <PrimaryBtn disabled={!customWorld.trim()} onClick={() => setPhase("setup_tone")}>Continue</PrimaryBtn>
          </div>
        )}
      </div>
    ), true, () => { const prior = allSessions.filter(s => s.playerList?.some(sp => playerList.map(l => l.id).includes(sp.id))).slice(0, 3); setPhase(prior.length > 0 ? "setup_continuity" : "setup_player"); });
  }

  // ═══════════════════════════════════════
  // PHASE: SETUP_TONE
  // ═══════════════════════════════════════
  if (phase === "setup_tone") return shell("Tone", (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, paddingTop: 20 }}>
      <h2 style={{ color: C.gold, fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>What is the tone?</h2>
      {TONES.map(t => (
        <button key={t.id} onClick={() => { SFX.select(); setToneObj(t); setMusicTrack(getSuggestedTrack(t.label)); setPhase("setup_duration"); }} style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px",
          cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 14, fontFamily: "inherit",
        }}>
          <span style={{ fontSize: 24 }}>{t.emoji}</span>
          <span style={{ color: C.cream, fontSize: 15, fontWeight: 600 }}>{t.label}</span>
        </button>
      ))}
      <button onClick={() => setToneObj("custom")} style={{
        background: "transparent", border: `1px dashed ${C.textDim}`, borderRadius: 12, padding: "14px 18px",
        cursor: "pointer", color: C.creamDim, fontSize: 14, textAlign: "left", fontFamily: "inherit",
      }}>🎨 Something else...</button>
      {toneObj === "custom" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={customTone} onChange={e => setCustomTone(e.target.value)} placeholder="Describe the tone"
            style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", color: C.cream, fontSize: 14, boxSizing: "border-box", fontFamily: "inherit" }} />
          <PrimaryBtn disabled={!customTone.trim()} onClick={() => setPhase("setup_duration")}>Continue</PrimaryBtn>
        </div>
      )}
    </div>
  ), true, () => setPhase("setup_world"));

  // ═══════════════════════════════════════
  // PHASE: SETUP_DURATION
  // ═══════════════════════════════════════
  if (phase === "setup_duration") return shell("Duration", (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, paddingTop: 20 }}>
      <h2 style={{ color: C.gold, fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>How long do we have?</h2>
      {DURATIONS.map(d => (
        <button key={d.id} onClick={() => { SFX.select(); setDuration(d.id); }} style={{
          background: duration === d.id ? C.green : C.card, border: `1px solid ${duration === d.id ? C.green : C.border}`,
          borderRadius: 12, padding: "16px 18px", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
        }}>
          <p style={{ color: C.cream, fontWeight: 600, margin: 0, fontSize: 16 }}>{d.label}</p>
          <p style={{ color: duration === d.id ? C.cream : C.textDim, margin: "4px 0 0", fontSize: 13 }}>{d.sub}</p>
        </button>
      ))}

      {/* Music picker */}
      <p style={{ color: C.creamDim, fontSize: 14, margin: "12px 0 4px" }}>Choose ambient music:</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { id: "none", label: "No Music", emoji: "🔇" },
          { id: "epic", label: "Battle Drums", emoji: "🥁" },
          { id: "spooky", label: "Dark Forest", emoji: "🌲" },
          { id: "playful", label: "Silly Bells", emoji: "🔔" },
          { id: "warm", label: "Sunrise Calm", emoji: "🌅" },
          { id: "african", label: "Igbo Village", emoji: "🪘" },
          { id: "scifi", label: "Cosmic Bridge", emoji: "🪐" },
        ].map(m => {
          const suggested = getSuggestedTrack(toneText) === m.id;
          const active = musicTrack === m.id;
          return (
          <button key={m.id} onClick={() => { SFX.select(); setMusicTrack(m.id); }} style={{
            background: active ? "rgba(245,200,66,0.1)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${active ? C.gold : suggested ? "rgba(245,200,66,0.35)" : C.border}`,
            borderRadius: 10, padding: "10px 6px", cursor: "pointer", textAlign: "center", fontFamily: "inherit",
          }}>
            <span style={{ fontSize: 20, display: "block" }}>{m.emoji}</span>
            <span style={{ color: active ? C.gold : C.cream, fontSize: 11, fontWeight: active ? 700 : 400, display: "block", marginTop: 4 }}>{m.label}</span>
            {suggested && !active && <span style={{ color: C.terra, fontSize: 9, display: "block", marginTop: 2 }}>✦ suggested</span>}
          </button>
          );
        })}
      </div>

      <PrimaryBtn disabled={!duration} onClick={startStory} style={{ marginTop: 16 }}>Begin the Adventure</PrimaryBtn>
    </div>
  ), true, () => setPhase("setup_tone"));

  // ═══════════════════════════════════════
  // PHASE: LOADING
  // ═══════════════════════════════════════
  if (phase === "loading") return shell("", (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
      <div style={{ width: 48, height: 48, border: `3px solid ${C.textDim}`, borderTopColor: C.gold, borderRadius: "50%", animation: "spin 1s linear infinite" }} />
      <p style={{ color: C.creamDim, fontSize: 15 }}>
        {loadingSeconds < 5 ? "The story is opening..." : loadingSeconds < 8 ? `${loadingSeconds}s...` : loadingSeconds < 20 ? "Still crafting your world..." : "Taking a while. Check your connection or try a different provider."}
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  ));

  // ═══════════════════════════════════════
  // PHASE: STORY
  // ═══════════════════════════════════════
  if (phase === "story") {
    const paras = (beat?.narration || "").split(/\n+/).filter(Boolean);
    const allRevealed = showAllText || visibleParas >= paras.length;
    const beatStyle = beat?.beatType && BEAT_STYLES[beat.beatType];

    return shell(worldObj?.title || customWorld?.slice(0, 20) || "Adventure", (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Ankara stripe */}
        <div style={{ height: 5, borderRadius: 3, background: `linear-gradient(90deg, ${C.green} 0%, ${C.gold} 33%, ${C.terra} 66%, ${C.green} 100%)`, opacity: 0.85 }} />

        {/* Backdrop blur loading overlay */}
        {loading && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(5,14,7,0.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 50, backdropFilter: "blur(3px)" }}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", border: `3px solid rgba(245,200,66,0.15)`, borderTopColor: C.gold, animation: "spin 0.9s linear infinite" }} />
            <div style={{ color: C.gold, marginTop: 12, fontSize: 15, fontStyle: "italic" }}>
              {loadingSeconds < 5 ? "The story continues..." : loadingSeconds < 8 ? `${loadingSeconds}s...` : loadingSeconds < 20 ? "Still thinking..." : "Taking a while. Check your connection or try a different provider."}
            </div>
          </div>
        )}

        {beat && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Beat type header */}
            {beatStyle && (
              <div style={{ background: beatStyle.bg, borderRadius: 12, padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>{beatStyle.icon}</span>
                <span style={{ color: "white", fontWeight: 700, fontSize: 14 }}>{beatStyle.label}</span>
              </div>
            )}

            {/* Turn label */}
            {beat.turnLabel && (
              <p style={{
                color: getPlayerColor(beat.turnLabel.replace("'S TURN", "").toLowerCase(), playerColors),
                fontWeight: 800, fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase", margin: 0,
              }}>{beat.turnLabel}</p>
            )}

            {/* Narration */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {paras.map((p, i) => (
                (showAllText || i < visibleParas) && (
                  <p key={i} style={{
                    color: C.cream, fontSize: 15, lineHeight: 1.7, margin: 0,
                    animation: !showAllText ? "fadeUp 0.4s ease-out" : "none",
                  }}>{p}</p>
                )
              ))}
            </div>

            {/* Skip button */}
            {!allRevealed && (
              <button onClick={() => { setShowAllText(true); setVisibleParas(paras.length); clearInterval(typewriterRef.current); }} style={{
                background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 8, padding: "6px 14px",
                cursor: "pointer", fontSize: 12, alignSelf: "flex-start", fontFamily: "inherit",
              }}>Skip</button>
            )}

            {/* TTS controls */}
            {allRevealed && beat.narration && (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => speak(beat.narration)} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>🔊 Read aloud</button>
                <button onClick={stopSpeak} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>⏹ Stop</button>
              </div>
            )}

            {/* Choices */}
            {allRevealed && beat.choices && beat.choices.length > 0 && !loading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                {beat.choicePrompt && <p style={{ color: C.creamDim, fontSize: 14, margin: "0 0 4px", fontStyle: "italic" }}>{beat.choicePrompt}</p>}
                {beat.choices.map((c, i) => (
                  <ChoiceBtn key={i} label={c.label} text={c.text}
                    color={beat.turnLabel ? getPlayerColor(beat.turnLabel.replace("'S TURN", "").toLowerCase(), playerColors) : C.gold}
                    onClick={() => {
                      SFX.click(); stopSpeak();
                      const who = beat.turnLabel ? beat.turnLabel.replace("'S TURN","").trim() : (playerList.length === 1 ? playerList[0].name : "Player");
                      sendBeat(`${who} chose option ${c.label}: "${c.text}". Continue the story.`);
                    }} />
                ))}
              </div>
            )}
          </div>
        )}

        <ErrorBox error={error} onRetry={() => { setError(null); sendBeat(retryPayload); }} />
      </div>
    ), false);
  }

  // ═══════════════════════════════════════
  // PHASE: CLOSING
  // ═══════════════════════════════════════
  if (phase === "closing") {
    const ritual = beat?.closingRitual;
    return shell("The End", (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20, paddingTop: 20 }}>
        {/* Final narration */}
        {beat?.narration && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
            {beat.narration.split(/\n+/).filter(Boolean).map((p, i) => (
              <p key={i} style={{ color: C.cream, fontSize: 15, lineHeight: 1.7, margin: i === 0 ? 0 : "12px 0 0" }}>{p}</p>
            ))}
          </div>
        )}

        {/* Walk Aways */}
        {ritual?.walkAways && ritual.walkAways.length > 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
            <p style={{ color: C.gold, fontWeight: 700, fontSize: 14, margin: "0 0 12px", letterSpacing: 1, textTransform: "uppercase" }}>The Walk Away</p>
            {ritual.walkAways.map((w, i) => (
              <p key={i} style={{ color: C.cream, fontSize: 15, lineHeight: 1.6, margin: i === 0 ? 0 : "8px 0 0" }}>
                <span style={{ color: getPlayerColor(w.player, playerColors), fontWeight: 700 }}>{w.player}: </span>{w.text}
              </p>
            ))}
          </div>
        )}

        {/* Secret Achievements */}
        {ritual?.secretAchievements && ritual.secretAchievements.length > 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.gold}30`, borderRadius: 14, padding: 20 }}>
            <p style={{ color: C.gold, fontWeight: 700, fontSize: 14, margin: "0 0 12px", letterSpacing: 1, textTransform: "uppercase" }}>🤫 Secret Achievement</p>
            {ritual.secretAchievements.map((a, i) => (
              <div key={i} style={{ margin: i === 0 ? 0 : "12px 0 0" }}>
                <p style={{ color: C.cream, fontSize: 14, margin: 0, fontStyle: "italic" }}>The story noticed something about {a.player} today.</p>
                <p style={{ color: C.gold, fontSize: 16, fontWeight: 700, margin: "6px 0 2px" }}>{a.name}</p>
                <p style={{ color: C.creamDim, fontSize: 14, margin: 0 }}>{a.description}</p>
              </div>
            ))}
          </div>
        )}

        {/* Thread */}
        {ritual?.thread && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
            <p style={{ color: C.textDim, fontSize: 14, fontStyle: "italic", margin: 0, lineHeight: 1.6 }}>{ritual.thread}</p>
          </div>
        )}

        {/* Recap */}
        {ritual?.recap && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
            <p style={{ color: C.textDim, fontWeight: 700, fontSize: 12, margin: "0 0 8px", letterSpacing: 1, textTransform: "uppercase" }}>Session Recap</p>
            <p style={{ color: C.creamDim, fontSize: 13, margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{ritual.recap}</p>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          <PrimaryBtn onClick={() => setShowExport(true)}>Save this Story</PrimaryBtn>
          <button onClick={resetToStart} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 12, padding: "14px", cursor: "pointer", fontSize: 15, fontFamily: "inherit" }}>Start a different adventure</button>
        </div>
      </div>
    ), false);
  }

  // Fallback
  return shell("", <p style={{ color: C.textDim }}>Loading...</p>);
}
