import { useState, useRef, useEffect } from "react";

const STORAGE_KEY      = "momah_api_key";
const STORAGE_PROVIDER = "momah_provider";
const STORAGE_MUTE     = "momah_mute";

// -- Audio System 

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone({ freq = 440, freq2, type = "sine", gain = 0.18, duration = 0.12, delay = 0 }) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    if (freq2) osc.frequency.linearRampToValueAtTime(freq2, ctx.currentTime + delay + duration);
    gainNode.gain.setValueAtTime(0, ctx.currentTime + delay);
    gainNode.gain.linearRampToValueAtTime(gain, ctx.currentTime + delay + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration + 0.05);
  } catch {}
}

const sounds = {
  click:       (m) => { if (m) return; playTone({ freq: 520, freq2: 580, type: "sine", gain: 0.12, duration: 0.08 }); },
  select:      (m) => { if (m) return; playTone({ freq: 660, freq2: 780, type: "sine", gain: 0.14, duration: 0.1 }); },
  next:        (m) => { if (m) return;
    playTone({ freq: 440, type: "sine", gain: 0.13, duration: 0.1 });
    playTone({ freq: 550, type: "sine", gain: 0.13, duration: 0.1, delay: 0.08 });
    playTone({ freq: 660, type: "sine", gain: 0.13, duration: 0.12, delay: 0.16 });
  },
  achievement: (m) => { if (m) return;
    playTone({ freq: 523, type: "sine", gain: 0.2,  duration: 0.12 });
    playTone({ freq: 659, type: "sine", gain: 0.2,  duration: 0.12, delay: 0.1 });
    playTone({ freq: 784, type: "sine", gain: 0.2,  duration: 0.12, delay: 0.2 });
    playTone({ freq: 1047,type: "sine", gain: 0.22, duration: 0.25, delay: 0.3 });
  },
  back:        (m) => { if (m) return; playTone({ freq: 440, freq2: 330, type: "sine", gain: 0.1, duration: 0.1 }); },
  begin:       (m) => { if (m) return;
    [0, 0.1, 0.2, 0.32, 0.46].forEach((delay, i) => {
      playTone({ freq: [330, 392, 440, 523, 659][i], type: "sine", gain: 0.15, duration: 0.18, delay });
    });
  },
};

// -- Music Tracks 

const MUSIC_TRACKS = [
  {
    id: "none",
    emoji: "🔕",
    label: "No Music",
    sub: "Silence",
    tones: [],
  },
  {
    id: "epic",
    emoji: "⚔️",
    label: "Battle Drums",
    sub: "Epic and dramatic",
    tones: ["Epic and dramatic"],
  },
  {
    id: "spooky",
    emoji: "🌙",
    label: "Dark Forest",
    sub: "Spooky and mysterious",
    tones: ["Spooky and mysterious"],
  },
  {
    id: "playful",
    emoji: "🎪",
    label: "Silly Bells",
    sub: "Funny and lighthearted",
    tones: ["Funny and lighthearted"],
  },
  {
    id: "warm",
    emoji: "🌅",
    label: "Sunrise Calm",
    sub: "Heartwarming and hopeful",
    tones: ["Heartwarming and hopeful"],
  },
  {
    id: "african",
    emoji: "🥁",
    label: "Igbo Village",
    sub: "Nigerian-inspired rhythms",
    tones: [],
  },
];

function getSuggestedTrack(toneText) {
  if (!toneText) return "african";
  const t = toneText.toLowerCase();
  if (t.includes("epic") || t.includes("dramatic")) return "epic";
  if (t.includes("spooky") || t.includes("mysterious")) return "spooky";
  if (t.includes("funny") || t.includes("lighthearted")) return "playful";
  if (t.includes("heartwarming") || t.includes("hopeful")) return "warm";
  return "african";
}

// Each track builder returns a cleanup function
const trackBuilders = {

  epic: (ctx) => {
    const intervals = [];
    const nodes = [];
    // Low war drum pulse
    const masterGain = ctx.createGain(); masterGain.gain.value = 0.07;
    masterGain.connect(ctx.destination);
    // Deep bass drone
    const bass = ctx.createOscillator(); bass.type = "sawtooth"; bass.frequency.value = 55;
    const bassGain = ctx.createGain(); bassGain.gain.value = 0.4;
    const bassFilter = ctx.createBiquadFilter(); bassFilter.type = "lowpass"; bassFilter.frequency.value = 120;
    bass.connect(bassFilter); bassFilter.connect(bassGain); bassGain.connect(masterGain);
    bass.start(); nodes.push(bass);
    // Mid power drone
    const mid = ctx.createOscillator(); mid.type = "sawtooth"; mid.frequency.value = 82.4;
    const midGain = ctx.createGain(); midGain.gain.value = 0.25;
    mid.connect(midGain); midGain.connect(masterGain);
    mid.start(); nodes.push(mid);
    // Rhythmic drum-like bursts every 1.2s using gain envelope
    let beat = 0;
    const drumInterval = setInterval(() => {
      try {
        const n = ctx.createOscillator(); n.type = "sine"; n.frequency.value = 80;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.5, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        n.connect(g); g.connect(masterGain);
        n.start(); n.stop(ctx.currentTime + 0.2);
        beat++;
        // Every 4 beats, add a high horn swell
        if (beat % 4 === 0) {
          const hornFreqs = [196, 220, 246, 220];
          hornFreqs.forEach((f, i) => playTone({ freq: f, type: "sawtooth", gain: 0.04, duration: 0.4, delay: i * 0.38 }));
        }
      } catch {}
    }, 1200);
    intervals.push(drumInterval);
    return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { masterGain.disconnect(); } catch {} };
  },

  spooky: (ctx) => {
    const intervals = [];
    const nodes = [];
    const masterGain = ctx.createGain(); masterGain.gain.value = 0.055;
    masterGain.connect(ctx.destination);
    // Eerie tremolo drone in minor
    const eerie = ctx.createOscillator(); eerie.type = "sine"; eerie.frequency.value = 110;
    const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 3.5;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 15;
    lfo.connect(lfoGain); lfoGain.connect(eerie.frequency);
    const eerieGain = ctx.createGain(); eerieGain.gain.value = 0.5;
    eerie.connect(eerieGain); eerieGain.connect(masterGain);
    eerie.start(); lfo.start(); nodes.push(eerie, lfo);
    // Second unsettling oscillator slightly detuned
    const eerie2 = ctx.createOscillator(); eerie2.type = "sine"; eerie2.frequency.value = 164.5;
    const eerie2Gain = ctx.createGain(); eerie2Gain.gain.value = 0.2;
    eerie2.connect(eerie2Gain); eerie2Gain.connect(masterGain);
    eerie2.start(); nodes.push(eerie2);
    // Random whisper-like high tones
    const whisperInterval = setInterval(() => {
      try {
        const whisperFreqs = [880, 740, 659, 587, 830];
        const f = whisperFreqs[Math.floor(Math.random() * whisperFreqs.length)];
        playTone({ freq: f, type: "sine", gain: 0.025, duration: 1.8 });
      } catch {}
    }, 4000 + Math.random() * 5000);
    intervals.push(whisperInterval);
    // Slow descending motif every 10s
    const motifInterval = setInterval(() => {
      [220, 196, 174.6, 164.8].forEach((f, i) =>
        playTone({ freq: f, type: "triangle", gain: 0.035, duration: 0.8, delay: i * 0.7 })
      );
    }, 10000);
    intervals.push(motifInterval);
    return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { masterGain.disconnect(); } catch {} };
  },

  playful: (ctx) => {
    const intervals = [];
    const nodes = [];
    const masterGain = ctx.createGain(); masterGain.gain.value = 0.055;
    masterGain.connect(ctx.destination);
    // Bouncy light drone
    const base = ctx.createOscillator(); base.type = "triangle"; base.frequency.value = 261.6;
    const baseGain = ctx.createGain(); baseGain.gain.value = 0.15;
    base.connect(baseGain); baseGain.connect(masterGain);
    base.start(); nodes.push(base);
    // Bouncy arpeggio pattern every 0.5s
    const scale = [261.6, 329.6, 392, 523.3, 659.3, 784, 659.3, 523.3];
    let step = 0;
    const arpeggioInterval = setInterval(() => {
      try {
        const f = scale[step % scale.length];
        playTone({ freq: f, type: "triangle", gain: 0.06, duration: 0.22 });
        step++;
        // Random silly "boing" every ~8 steps
        if (step % 8 === 0) playTone({ freq: 1046, freq2: 523, type: "sine", gain: 0.05, duration: 0.4 });
      } catch {}
    }, 480);
    intervals.push(arpeggioInterval);
    return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { masterGain.disconnect(); } catch {} };
  },

  warm: (ctx) => {
    const intervals = [];
    const nodes = [];
    const masterGain = ctx.createGain(); masterGain.gain.value = 0.055;
    masterGain.connect(ctx.destination);
    // Gentle warm pad: two soft sines
    const pad1 = ctx.createOscillator(); pad1.type = "sine"; pad1.frequency.value = 196;
    const pad2 = ctx.createOscillator(); pad2.type = "sine"; pad2.frequency.value = 246.9;
    const pad3 = ctx.createOscillator(); pad3.type = "sine"; pad3.frequency.value = 293.7;
    [pad1, pad2, pad3].forEach(p => {
      const g = ctx.createGain(); g.gain.value = 0.18;
      p.connect(g); g.connect(masterGain); p.start(); nodes.push(p);
    });
    // Gentle melody notes every ~2.5s
    const melody = [392, 440, 493.9, 523.3, 493.9, 440, 392, 349.2];
    let mStep = 0;
    const melodyInterval = setInterval(() => {
      try {
        playTone({ freq: melody[mStep % melody.length], type: "sine", gain: 0.05, duration: 1.4 });
        mStep++;
      } catch {}
    }, 2400);
    intervals.push(melodyInterval);
    // Soft chime accent every 7s
    const chimeInterval = setInterval(() => {
      playTone({ freq: 1046.5, type: "sine", gain: 0.035, duration: 2.0 });
    }, 7000 + Math.random() * 3000);
    intervals.push(chimeInterval);
    return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { masterGain.disconnect(); } catch {} };
  },

  african: (ctx) => {
    const intervals = [];
    const nodes = [];
    const masterGain = ctx.createGain(); masterGain.gain.value = 0.065;
    masterGain.connect(ctx.destination);
    // Warm bass talking drum tone
    const bassDrum = ctx.createOscillator(); bassDrum.type = "sine"; bassDrum.frequency.value = 80;
    const bassGain = ctx.createGain(); bassGain.gain.value = 0.3;
    const bassFilter = ctx.createBiquadFilter(); bassFilter.type = "lowpass"; bassFilter.frequency.value = 180;
    bassDrum.connect(bassFilter); bassFilter.connect(bassGain); bassGain.connect(masterGain);
    bassDrum.start(); nodes.push(bassDrum);
    // Pentatonic pattern inspired by West African kora: D F# A B D
    const kora = [293.7, 370, 440, 493.9, 587.3, 493.9, 440, 370];
    let kStep = 0;
    const koraInterval = setInterval(() => {
      try {
        playTone({ freq: kora[kStep % kora.length], type: "triangle", gain: 0.055, duration: 0.35 });
        kStep++;
      } catch {}
    }, 380);
    intervals.push(koraInterval);
    // Talking drum accent pattern: beat 1, 3, 4 of every bar (every 1520ms)
    const drumPattern = [0, 760, 1140];
    const barInterval = setInterval(() => {
      drumPattern.forEach(offset => {
        setTimeout(() => {
          try {
            const pitch = offset === 0 ? 120 : offset === 760 ? 100 : 140;
            const n = ctx.createOscillator(); n.type = "sine"; n.frequency.value = pitch;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.45, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            n.connect(g); g.connect(masterGain);
            n.start(); n.stop(ctx.currentTime + 0.17);
          } catch {}
        }, offset);
      });
    }, 1520);
    intervals.push(barInterval);
    // Occasional high bell accent every ~5s
    const bellInterval = setInterval(() => {
      playTone({ freq: 880, type: "sine", gain: 0.04, duration: 1.0 });
      setTimeout(() => playTone({ freq: 1108, type: "sine", gain: 0.03, duration: 0.8 }), 300);
    }, 5000 + Math.random() * 3000);
    intervals.push(bellInterval);
    return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { masterGain.disconnect(); } catch {} };
  },
};

function useAmbientMusic(trackId, muted) {
  const cleanupRef = useRef(null);
  useEffect(() => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (muted || !trackId || trackId === "none") return;
    try {
      const ctx = getAudioCtx();
      if (ctx.state === "suspended") ctx.resume();
      const builder = trackBuilders[trackId];
      if (builder) cleanupRef.current = builder(ctx);
    } catch {}
    return () => { if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; } };
  }, [trackId, muted]);
}


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
  return data.content?.[0]?.text || "";
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

async function callDeepSeek(systemPrompt, messages, apiKey) {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      max_tokens: 1200,
      temperature: 0.9,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `DeepSeek error ${res.status}. Check your API key.`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || "";
}

async function callGroq(systemPrompt, messages, apiKey) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: 1200,
      temperature: 0.9,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq error ${res.status}. Check your API key.`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || "";
}

async function callStoryAPI(systemPrompt, messages, apiKey, provider) {
  let raw = "";
  if (provider === "gemini")        raw = await callGemini(systemPrompt, messages, apiKey);
  else if (provider === "deepseek") raw = await callDeepSeek(systemPrompt, messages, apiKey);
  else if (provider === "groq")     raw = await callGroq(systemPrompt, messages, apiKey);
  else                              raw = await callAnthropic(systemPrompt, messages, apiKey);
  const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  // Always look for outermost object for story beats
  const objMatch = clean.match(/\{[\s\S]*\}/);
  if (!objMatch) throw new Error("Story engine returned an unexpected response. Tap retry.");
  return JSON.parse(objMatch[0]);
}

async function callWorldsAPI(systemPrompt, messages, apiKey, provider) {
  let raw = "";
  if (provider === "gemini")        raw = await callGemini(systemPrompt, messages, apiKey);
  else if (provider === "deepseek") raw = await callDeepSeek(systemPrompt, messages, apiKey);
  else if (provider === "groq")     raw = await callGroq(systemPrompt, messages, apiKey);
  else                              raw = await callAnthropic(systemPrompt, messages, apiKey);
  const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  // Look for outermost array for world generation
  const arrMatch = clean.match(/\[[\s\S]*\]/);
  if (!arrMatch) throw new Error("World generation returned unexpected response.");
  return JSON.parse(arrMatch[0]);
}

const TONES = [
  { id: 1, emoji: "⚡", text: "Epic and dramatic" },
  { id: 2, emoji: "😄", text: "Funny and lighthearted" },
  { id: 3, emoji: "🌙", text: "Spooky and mysterious" },
  { id: 4, emoji: "💛", text: "Heartwarming and hopeful" },
];

// -- System Prompt 

function buildSystemPrompt(players, world, tone, duration) {
  const who = players === "both"
    ? "Both Justina AND Nathaniel are playing together. Alternate their turns strictly. Never let one child go twice in a row."
    : players === "justina"
    ? "Only Justina is playing today. Solo session. Write in second person."
    : "Only Nathaniel is playing today. Solo session. Write in second person.";

  const durationGuide = duration === "20"
    ? "SESSION LENGTH: 20 minutes. Use 4 to 5 decision points only. Keep narration lean. Use one mechanic at most. End cleanly and quickly."
    : duration === "45"
    ? "SESSION LENGTH: 45 minutes. Use 6 to 8 decision points. Fuller narration. Two to three mechanics available. Include complete closing ritual."
    : "SESSION LENGTH: 60 minutes or more. Full experience. Up to 12 decision points. All mechanics available. Extended campfire moments. Full closing ritual with recap.";

  return `You are running a choose-your-own-adventure story for the Momah children. This is often read aloud by a parent. Follow every rule precisely.

THE CHILDREN:
Justina Adanna Momah, age 9. Reads well above grade level. Her sections target upper middle-grade fiction. Use rich vocabulary freely: "sovereignty," "inevitable," "treacherous," "fractured," "consequence." Give her emotional complexity, conflicting loyalties, layered moral choices with real weight. Do not soften outcomes. Challenge her. She is ready for it.

Nathaniel Okenwa Momah, age 7, 2nd grade. His sections use short sentences, simple words, and humor. Two-word sentences are fine during action. Sound words: BOOM, CRASH, ZAP, WHOOSH, THUD. Lean into silliness and absurdity. Keep choices concrete: "Run into the cave" vs "Climb the giant tree." At least one funny or surprising moment per act when he is playing.

SESSION:
Players: ${who}
World: ${world}
Tone: ${tone}
${durationGuide}

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
Scale beats to the session length defined above.

CAMPFIRE MOMENT: At least once. Quiet. Reflective. Reveal one trait the choices have shown. Ask the child what their character would do anything to protect. Use that answer to privately shape the villain. In joint sessions, ask each child separately during their own campfire beat.

WONDER MOMENT: At least once. Something beautiful or magical with no danger. One simple curiosity choice. Examples: fireflies forming letters in the air, a library where books breathe, a sleeping dragon that hums, a whale swimming through clouds.

SIGNATURE MOMENT: One per story. The defining turn. Present it as a single weighted choice alone, not in a list. One question. Let the weight land. When they commit, the world visibly responds. Vary the type: bravery, kindness, cleverness. It should fit who this character has been becoming.

REAL CONSEQUENCES: Wrong choices create real setbacks. Lost items stay lost. Missed warnings cause harm. No free rescues. The story does not protect them from themselves. If a path closes entirely, say so and offer to go back to the last choice or start fresh. Use this no more than once.

TURN FORMAT (both playing): Label every single choice point. Use this exact format at the top of each choice section:
JUSTINA'S TURN or NATHANIEL'S TURN

When Justina chooses, narration around her choices uses her reading level. When Nathaniel chooses, narration drops to his level even within the same shared scene.

LEGENDARY VISITOR: Once per session, a legendary character from popular culture may appear. Trigger it when a child repeatedly chooses a specific style (always fights, always helps, always tricks). The visitor reflects that pattern back at them in a moment of recognition. Never announce it. Never repeat the same visitor. They appear, act, and leave without taking over the story.

DISCOVERY ACHIEVEMENTS: Mid-story. Earned by brave, kind, clever, creative, or persistent choices. No more than one per child per session. Announce immediately: "Achievement Unlocked: [Name]. [One sentence on what they did]." Then continue without pause. Each achievement comes with one small persistent reward: a trait, a tool, a reputation, or a future narrative advantage.

SECRET ACHIEVEMENTS: Track patterns silently. Reveal ONLY in the closing ritual. Never mid-story. Deliver as: "The story noticed something about you today. You earned: [Name]. [One sentence told as a truth about who they are, not a game mechanic]."

FAMILY (use naturally when earned, never forced):
Dad: Ony or Oxajyn (wildcard, any role the story needs)
Mom: Justina Adaobi
Best friends: Paityn (Justina's, age 9), Langston (Nathaniel's, age 7)
Younger cousins like Luka or Hudson can need protecting. Older cousins like Sofi or Camille can be rivals.
Oxajyn can be a legend, a villain, a rogue element, or anything the story needs.

NATHANIEL HUMOR PROTECTION: When both kids are playing, build in at least one moment per act that is specifically funny for a 7-year-old. It must never deflate Justina's experience. It runs alongside the story, not through it. If Nathaniel proposes something wild that is not a listed option, say yes and give it a real consequence.

CLOSING RITUAL: When the story naturally concludes, set isEnding: true. Deliver:
1. Walk Away: One sentence per child describing what they carry out (object, ability, scar, knowledge, relationship).
2. Secret Achievement: One per child. Format: "The story noticed something about you today. You earned: [Name]. [One sentence telling them what they did, as a truth about who they are]."
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

// -- App 

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
  const [duration, setDuration] = useState(null);
  const [worlds, setWorlds] = useState([]);
  const [worldsLoading, setWorldsLoading] = useState(false);
  const [muted, setMuted] = useState(() => localStorage.getItem(STORAGE_MUTE) === "true");
  const [musicTrack, setMusicTrack] = useState("african");

  useAmbientMusic(musicTrack, muted);
  AudioCtx.muted = muted;

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStorage.setItem(STORAGE_MUTE, String(next));
  }

  async function generateWorlds() {
    setWorldsLoading(true);
    setWorlds([]);
    try {
      const prompt = `Generate exactly 5 completely fresh, specific, and imaginative story world suggestions for children ages 7-9. Each must be vivid, distinct, and range from grounded to wildly fantastical. Never use these worlds: volcano city, robot teachers school, drifting ocean islands, talking jungle, unnamed space station. Make them surprising and original every time.

Respond ONLY with a JSON array, no markdown, no explanation:
[
  {"id": 1, "emoji": "...", "text": "..."},
  {"id": 2, "emoji": "...", "text": "..."},
  {"id": 3, "emoji": "...", "text": "..."},
  {"id": 4, "emoji": "...", "text": "..."},
  {"id": 5, "emoji": "...", "text": "..."}
]`;
      const parsed = await callWorldsAPI(
        "You generate creative story world options for children. Respond only with a valid JSON array, no markdown, no explanation.",
        [{ role: "user", content: prompt }],
        apiKey, provider
      );
      if (Array.isArray(parsed) && parsed.length > 0) {
        setWorlds(parsed);
      } else {
        throw new Error("Invalid world list returned");
      }
    } catch (e) {
      // Fallback worlds if generation fails
      setWorlds([
        { id: 1, emoji: "🏔️", text: "A mountain range where clouds are solid enough to walk on" },
        { id: 2, emoji: "🕰️", text: "A village where time flows backwards after sunset" },
        { id: 3, emoji: "🎪", text: "A traveling circus that appears only in places no one remembers" },
        { id: 4, emoji: "🌊", text: "An underwater kingdom built inside the bones of an ancient creature" },
        { id: 5, emoji: "🌿", text: "A forest where every tree is a door to a different season" },
      ]);
    } finally {
      setWorldsLoading(false);
    }
  }
  const [messages, setMessages] = useState([]);
  const [beat, setBeat] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [retryPayload, setRetryPayload] = useState(null);
  const pageTop = useRef(null);

  const worldText = worldObj === "custom" ? customWorld : worldObj?.text;
  const toneText  = toneObj  === "custom" ? customTone  : toneObj?.text;
  const sysPrompt = players && worldText && toneText && duration
    ? buildSystemPrompt(players, worldText, toneText, duration) : "";

  // Color scheme by whose turn it is
  const turnColor = beat?.turnLabel === "JUSTINA'S TURN"  ? C.justina
                  : beat?.turnLabel === "NATHANIEL'S TURN" ? C.nathaniel
                  : C.gold;

  function flashToast(ach) {
    sounds.achievement(muted);
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
    sounds.begin(muted);
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
    setToneObj(null); setCustomTone(""); setDuration(null);
    setWorlds([]); setMessages([]);
    setBeat(null); setError(null); setRetryPayload(null);
  }

  function changeApiKey() {
    setPhase("setup_key");
  }

  // -- Setup: API Key 
  if (phase === "setup_key") {
    const PROVIDERS = [
      { id: "anthropic", label: "Claude",    emoji: "🤖", sub: "Best storytelling",   url: "console.anthropic.com",          placeholder: "sk-ant-api03-...",  validate: v => v.startsWith("sk-ant") },
      { id: "gemini",    label: "Gemini",    emoji: "✨", sub: "Free tier available", url: "aistudio.google.com",             placeholder: "AIzaSy...",         validate: v => v.length > 10 },
      { id: "deepseek",  label: "DeepSeek",  emoji: "🐋", sub: "Cheapest option",    url: "platform.deepseek.com",           placeholder: "sk-...",            validate: v => v.length > 10 },
      { id: "groq",      label: "Groq",      emoji: "⚡", sub: "Fastest responses",  url: "console.groq.com",                placeholder: "gsk_...",           validate: v => v.length > 10 },
    ];
    const current = PROVIDERS.find(p => p.id === provider) || PROVIDERS[0];
    const keyValid = apiKeyInput.trim().length > 0 && current.validate(apiKeyInput.trim());

    return (
      <Shell muted={muted} onToggleMute={toggleMute}>
        <SetupCard icon="🔑" title="Connect Your AI">
          <p style={{ color: C.creamDim, fontSize: "0.84rem", lineHeight: 1.6, margin: "0 0 1rem", textAlign: "left" }}>
            Pick a provider and paste your API key. It stays on your device only.
          </p>

          {/* 2x2 provider grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", width: "100%", marginBottom: "1.1rem" }}>
            {PROVIDERS.map(p => (
              <button key={p.id}
                className="chip-btn"
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  gap: "0.15rem", padding: "0.75rem 0.4rem",
                  border: `2px solid ${provider === p.id ? C.gold : "rgba(245,200,66,0.15)"}`,
                  borderRadius: 12, cursor: "pointer", transition: "all 0.18s",
                  background: provider === p.id ? "rgba(245,200,66,0.08)" : "rgba(255,255,255,0.03)",
                  fontFamily: "Georgia, serif",
                  boxShadow: provider === p.id ? `0 0 16px rgba(245,200,66,0.15)` : "none",
                }}
                onClick={() => {
                  sounds.select(AudioCtx.muted);
                  setProvider(p.id);
                  setApiKeyInput("");
                  localStorage.setItem(STORAGE_PROVIDER, p.id);
                }}>
                <span style={{ fontSize: "1.5rem" }}>{p.emoji}</span>
                <span style={{ color: provider === p.id ? C.gold : C.cream, fontWeight: 700, fontSize: "0.85rem" }}>{p.label}</span>
                <span style={{ color: C.textDim, fontSize: "0.66rem", textAlign: "center" }}>{p.sub}</span>
              </button>
            ))}
          </div>

          {/* Key input */}
          <div style={{ width: "100%", marginBottom: "0.4rem" }}>
            <label style={{ display: "block", color: C.textDim, fontSize: "0.72rem", textTransform: "uppercase",
              letterSpacing: 1.3, marginBottom: "0.4rem", fontFamily: "system-ui,sans-serif" }}>
              {current.label} API Key
            </label>
            <input
              style={{ ...styles.input, fontFamily: "monospace", fontSize: "0.82rem" }}
              type="password"
              placeholder={current.placeholder}
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

          <p style={{ color: C.textDim, fontSize: "0.73rem", lineHeight: 1.6, margin: "0 0 0.75rem", textAlign: "left" }}>
            Get your key at <span style={{ color: C.gold }}>{current.url}</span>
            {(current.id === "deepseek" || current.id === "groq") && (
              <span style={{ color: C.terraLight }}> — free tier available</span>
            )}
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

  // -- Setup: Player 
  if (phase === "setup_player") return (
    <Shell muted={muted} onToggleMute={toggleMute}>
      <SetupCard icon="📖" title="Who's adventuring today?">
        {[
          { id: "both",     emoji: "👫", label: "Justina & Nathaniel", sub: "Take turns together" },
          { id: "justina",  emoji: "🌟", label: "Justina only",        sub: "Solo adventure" },
          { id: "nathaniel",emoji: "🚀", label: "Nathaniel only",      sub: "Solo adventure" },
        ].map(p => (
          <Chip key={p.id} emoji={p.emoji} label={p.label} sub={p.sub}
            active={players === p.id} onClick={() => setPlayers(p.id)} />
        ))}
        <PrimaryBtn disabled={!players} onClick={() => { generateWorlds(); setPhase("setup_world"); }}>
          Choose the World →
        </PrimaryBtn>
      </SetupCard>
    </Shell>
  );

  // -- Setup: World 
  if (phase === "setup_world") return (
    <Shell muted={muted} onToggleMute={toggleMute}>
      <SetupCard icon="🗺️" title="Where does the story happen?">
        {worldsLoading ? (
          <div style={{ color: C.gold, fontSize: "0.95rem", padding: "1.5rem 0", textAlign: "center" }}>
            ✨ Imagining new worlds...
          </div>
        ) : (
          worlds.map(w => (
            <Chip key={w.id} emoji={w.emoji} label={w.text}
              active={worldObj?.id === w.id} onClick={() => { setWorldObj(w); setCustomWorld(""); }} />
          ))
        )}
        <div style={{ width: "100%", marginTop: "0.25rem" }}>
          <div style={{ color: "#777", fontSize: "0.77rem", marginBottom: "0.35rem" }}>Or invent your own:</div>
          <input style={styles.input} placeholder="Somewhere totally different..."
            value={customWorld}
            onChange={e => { setCustomWorld(e.target.value); setWorldObj(e.target.value ? "custom" : null); }} />
        </div>
        {!worldsLoading && (
          <button style={{ background: "none", border: "none", color: C.textDim, fontSize: "0.8rem", cursor: "pointer", marginBottom: "0.5rem" }}
            onClick={generateWorlds}>🔄 Generate new worlds</button>
        )}
        <PrimaryBtn disabled={!worldText?.trim() || worldsLoading} onClick={() => setPhase("setup_tone")}>Choose the Tone →</PrimaryBtn>
        <GhostBtn onClick={() => setPhase("setup_player")}>← Back</GhostBtn>
      </SetupCard>
    </Shell>
  );

  // -- Setup: Tone 
  if (phase === "setup_tone") return (
    <Shell muted={muted} onToggleMute={toggleMute}>
      <SetupCard icon="🎭" title="What kind of story?">
        {TONES.map(t => (
          <Chip key={t.id} emoji={t.emoji} label={t.text}
            active={toneObj?.id === t.id} onClick={() => { setToneObj(t); setCustomTone(""); }} />
        ))}
        <div style={{ width: "100%", marginTop: "0.25rem" }}>
          <div style={{ color: "#777", fontSize: "0.77rem", marginBottom: "0.35rem" }}>Or describe something else:</div>
          <input style={styles.input} placeholder="Something different, describe it..."
            value={customTone}
            onChange={e => { setCustomTone(e.target.value); setToneObj(e.target.value ? "custom" : null); }} />
        </div>
        <PrimaryBtn disabled={!toneText?.trim()} onClick={() => {
          setMusicTrack(getSuggestedTrack(toneText));
          setPhase("setup_duration");
        }}>How Long? →</PrimaryBtn>
        <GhostBtn onClick={() => setPhase("setup_world")}>← Back</GhostBtn>
      </SetupCard>
    </Shell>
  );

  // -- Setup: Duration + Music 
  if (phase === "setup_duration") return (
    <Shell muted={muted} onToggleMute={toggleMute}>
      <SetupCard icon="⏱️" title="How long do we have?">
        {[
          { id: "20", emoji: "⚡", label: "Quick Story",   sub: "~20 minutes" },
          { id: "45", emoji: "📖", label: "Full Adventure", sub: "~45 minutes" },
          { id: "60", emoji: "🌟", label: "Epic Session",   sub: "60+ minutes" },
        ].map(d => (
          <Chip key={d.id} emoji={d.emoji} label={d.label} sub={d.sub}
            active={duration === d.id} onClick={() => setDuration(d.id)} />
        ))}

        {/* Music picker */}
        <div style={{ width: "100%", margin: "1.1rem 0 0.4rem", borderTop: `1px solid ${C.borderSoft}`, paddingTop: "1rem" }}>
          <div style={{ color: C.gold, fontSize: "0.82rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.6rem" }}>
            🎵 Background Music
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem" }}>
            {MUSIC_TRACKS.map(t => {
              const suggested = getSuggestedTrack(toneText) === t.id;
              const active = musicTrack === t.id;
              return (
                <button key={t.id}
                  onClick={() => { sounds.select(AudioCtx.muted); setMusicTrack(t.id); }}
                  style={{
                    background: active ? "rgba(245,200,66,0.1)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${active ? C.gold : suggested ? "rgba(245,200,66,0.35)" : "rgba(245,200,66,0.12)"}`,
                    borderRadius: 10, padding: "0.5rem 0.3rem", cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: "0.15rem",
                  }}>
                  <span style={{ fontSize: "1.4rem" }}>{t.emoji}</span>
                  <span style={{ color: active ? C.gold : C.cream, fontSize: "0.68rem", fontWeight: active ? 700 : 400, textAlign: "center", lineHeight: 1.2 }}>{t.label}</span>
                  {suggested && !active && <span style={{ color: C.terra, fontSize: "0.58rem" }}>✦ suggested</span>}
                </button>
              );
            })}
          </div>
        </div>

        {error && <ErrorBox msg={error} onRetry={retryLast} />}
        <PrimaryBtn disabled={!duration || loading} onClick={startStory}>
          {loading ? "✨ Opening the story…" : "Begin the Adventure ✨"}
        </PrimaryBtn>
        <GhostBtn onClick={() => setPhase("setup_tone")}>← Back</GhostBtn>
      </SetupCard>
    </Shell>
  );

  // -- Loading (initial story generation) 
  if (phase === "loading") return (
    <Shell muted={muted} onToggleMute={toggleMute}>
      <div style={styles.loadingScreen}>
        <div style={styles.spinner} />
        <div style={{ color: C.gold, fontSize: "1rem", marginTop: "1.25rem", fontStyle: "italic", fontFamily: "'Playfair Display', serif" }}>
          The story is opening…
        </div>
        <div style={{ color: C.textDim, fontSize: "0.82rem", marginTop: "0.5rem" }}>
          {worldText}
        </div>
        {error && <ErrorBox msg={error} onRetry={retryLast} />}
      </div>
    </Shell>
  );

  // -- Story 
  if ((phase === "story" || phase === "closing") && beat) return (
    <div style={styles.storyRoot} ref={pageTop}>
      <style>{CSS}</style>

      {/* Achievement Toast */}
      {toast && (
        <div style={styles.toast} className="toast-in">
          <div style={{ fontSize: "1.8rem" }}>🏆</div>
          <div>
            <div style={styles.toastName}>Achievement Unlocked: {toast.name}</div>
            <div style={styles.toastDesc}>{toast.description}</div>
          </div>
        </div>
      )}

      {/* Loading overlay during story progression */}
      {loading && (
        <div style={styles.storyOverlay}>
          <div style={styles.spinner} />
          <div style={{ color: C.gold, marginTop: "0.75rem", fontSize: "0.88rem", fontFamily: "'Playfair Display', serif" }}>The story continues…</div>
        </div>
      )}

      <div style={styles.storyPage}>

        {/* Top bar */}
        {/* Ankara stripe header */}
        <div style={{
          height: 5, borderRadius: 3, marginBottom: "1.25rem",
          background: `linear-gradient(90deg, ${C.green} 0%, ${C.gold} 33%, ${C.terra} 66%, ${C.green} 100%)`,
          opacity: 0.85,
        }} />

        <div style={styles.topBar}>
          <div style={styles.sessionLabel}>
            {players === "both" ? "Justina & Nathaniel" : players === "justina" ? "Justina" : "Nathaniel"}
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button style={styles.newBtn} className="new-btn" onClick={changeApiKey}>🔑 Key</button>
            <button style={styles.newBtn} className="new-btn" onClick={resetAll}>New Adventure</button>
          </div>
        </div>

        {/* CLOSING -- -- -- -- -- -- -- -- -- -- -- */}
        {phase === "closing" && (
          <>
            <div style={styles.closingBanner}>✨ The Story Ends ✨</div>
            <Narration text={beat.narration} />
            {beat.closingRitual && (
              <div style={{ marginTop: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                {(players === "both" || players === "justina") && beat.closingRitual.justina && (
                  <RitualCard name="Justina" color="#00c49a" data={beat.closingRitual.justina} />
                )}
                {(players === "both" || players === "nathaniel") && beat.closingRitual.nathaniel && (
                  <RitualCard name="Nathaniel" color="#ff8c5a" data={beat.closingRitual.nathaniel} />
                )}
                {beat.closingRitual.recap && (
                  <div style={styles.recapBox}>
                    <div style={styles.recapLabel}>📋 Session Notes</div>
                    <div style={styles.recapText}>{beat.closingRitual.recap}</div>
                  </div>
                )}
              </div>
            )}
            <button style={styles.primaryBtn} onClick={resetAll}>🌟 Start a New Adventure</button>
          </>
        )}

        {/* ACTIVE STORY -- -- -- -- -- -- -- -- -- */}
        {phase === "story" && (
          <>
            {/* Beat type badge */}
            {beat.beatType && beat.beatType !== "action" && (
              <div style={styles.beatBadge}>
                {beat.beatType === "wonder"    && "✨ Wonder Moment"}
                {beat.beatType === "campfire"  && "🔥 Campfire"}
                {beat.beatType === "signature" && "⚡ Defining Moment"}
              </div>
            )}

            {/* Narration */}
            <Narration text={beat.narration} />

            {/* Turn label + choices */}
            {beat.choices?.length > 0 && !loading && (
              <div style={styles.choiceSection}>
                {beat.turnLabel && (
                  <div style={{ ...styles.turnLabel, background: `${turnColor}18`, borderColor: `${turnColor}44`, color: turnColor }}>
                    {beat.turnLabel}
                  </div>
                )}
                {beat.choicePrompt && (
                  <div style={{ ...styles.choicePrompt, color: turnColor }}>{beat.choicePrompt}</div>
                )}
                {beat.choices.map(c => (
                  <button key={c.label}
                    className="choice-btn"
                    style={{ ...styles.choiceBtn, borderColor: `${turnColor}30` }}
                    onClick={() => makeChoice(c)}>
                    <span style={{ ...styles.choiceLetter, color: turnColor }}>{c.label}.</span>
                    <span style={styles.choiceText}>{c.text}</span>
                  </button>
                ))}
              </div>
            )}

            {error && <ErrorBox msg={error} onRetry={retryLast} />}
          </>
        )}

      </div>
    </div>
  );

  return null;
}

// -- Helper Components 

function Shell({ children, muted, onToggleMute }) {
  return (
    <div style={styles.shell}>
      <style>{CSS}</style>
      {onToggleMute && (
        <button
          onClick={() => { sounds.click(AudioCtx.muted); onToggleMute(); }}
          style={{
            position: "fixed", top: "1rem", right: "1rem", zIndex: 999,
            background: "rgba(15,30,17,0.85)", border: `1px solid rgba(245,200,66,0.2)`,
            borderRadius: "50%", width: 40, height: 40, fontSize: "1.1rem",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            backdropFilter: "blur(8px)",
          }}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
      )}
      {children}
    </div>
  );
}

function SetupCard({ icon, title, children }) {
  return (
    <div style={styles.setupCard} className="ankara-border adinkra-bg">
      {/* Geometric top accent strip */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 4,
        background: `linear-gradient(90deg, ${C.green} 0%, ${C.gold} 33%, ${C.terra} 66%, ${C.green} 100%)`,
        borderRadius: "20px 20px 0 0",
      }} />
      <div style={{ fontSize: "2.8rem", marginBottom: "0.2rem", marginTop: "0.5rem" }}>{icon}</div>
      <h2 style={styles.setupTitle}>{title}</h2>
      <div style={styles.chipList}>{children}</div>
    </div>
  );
}

const AudioCtx = { muted: false };

function Chip({ emoji, label, sub, active, onClick }) {
  return (
    <button className="chip-btn"
      style={{ ...styles.chip,
        borderColor: active ? C.gold : "rgba(245,200,66,0.15)",
        background: active ? "rgba(245,200,66,0.08)" : "rgba(255,255,255,0.03)",
        boxShadow: active ? `0 0 16px rgba(245,200,66,0.18), inset 0 0 0 1px rgba(245,200,66,0.1)` : "none",
      }}
      onClick={() => { sounds.select(AudioCtx.muted); onClick && onClick(); }}>
      <span style={{ fontSize: "1.5rem" }}>{emoji}</span>
      <div style={{ textAlign: "left" }}>
        <div style={{ color: active ? C.gold : C.cream, fontWeight: active ? 700 : 400, fontSize: "0.92rem" }}>{label}</div>
        {sub && <div style={{ color: C.textDim, fontSize: "0.73rem", marginTop: "0.1rem" }}>{sub}</div>}
      </div>
    </button>
  );
}

function PrimaryBtn({ children, onClick, disabled, soundType = "next" }) {
  return (
    <button className="primary-btn"
      style={{ ...styles.primaryBtn, opacity: disabled ? 0.38 : 1, cursor: disabled ? "not-allowed" : "pointer", marginTop: "1rem" }}
      onClick={disabled ? undefined : () => { sounds[soundType]?.(AudioCtx.muted); onClick && onClick(); }}>
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick }) {
  return (
    <button style={styles.ghostBtn} onClick={() => { sounds.back(AudioCtx.muted); onClick && onClick(); }}>{children}</button>
  );
}

function Narration({ text }) {
  if (!text) return null;
  const paras = text.split(/\n+/).filter(p => p.trim());
  return (
    <div style={styles.narration}>
      {paras.map((p, i) => <p key={i} style={{ margin: "0 0 1.1rem" }}>{p}</p>)}
    </div>
  );
}

function RitualCard({ name, color, data }) {
  return (
    <div style={{ ...styles.ritualCard, borderColor: `${color}35`, background: `${color}08` }}>
      <div style={{ color, fontWeight: 700, fontSize: "1rem", marginBottom: "0.9rem",
        paddingBottom: "0.6rem", borderBottom: `1px solid ${color}22`,
        fontFamily: "'Playfair Display', serif" }}>{name}</div>
      {data.walkAway && (
        <div style={{ marginBottom: "0.75rem" }}>
          <div style={styles.ritualTag}>Carries Forward</div>
          <div style={styles.ritualBody}>{data.walkAway}</div>
        </div>
      )}
      {data.achievement && (
        <div style={{ ...styles.achBox, borderColor: `${color}35`, background: `${color}0a` }}>
          <div style={{ ...styles.ritualTag, color: color }}>The Story Noticed</div>
          <div style={{ color, fontWeight: 700, fontSize: "0.92rem", marginBottom: "0.25rem",
            fontFamily: "'Playfair Display', serif" }}>
            {data.achievement.name}
          </div>
          <div style={{ color: C.creamDim, fontSize: "0.85rem", lineHeight: 1.65 }}>
            {data.achievement.description}
          </div>
        </div>
      )}
      {data.thread && (
        <div>
          <div style={styles.ritualTag}>The Thread</div>
          <div style={{ ...styles.ritualBody, fontStyle: "italic", color: C.textDim }}>{data.thread}</div>
        </div>
      )}
    </div>
  );
}

function ErrorBox({ msg, onRetry }) {
  return (
    <div style={styles.errorBox}>
      <div style={{ color: C.terraLight, fontSize: "0.85rem" }}>{msg}</div>
      {onRetry && (
        <button style={styles.retryBtn} onClick={onRetry}>Try again</button>
      )}
    </div>
  );
}

// -- Design tokens (Ankara / Igbo-inspired palette) 
// Deep forest green + warm gold + terracotta + cream on near-black earth
const C = {
  bg:         "#0d1a0f",   // deep forest night
  bgMid:      "#132214",
  card:       "#0f1e11",
  green:      "#1e6b35",
  greenLight: "#2d9e52",
  gold:       "#f5c842",
  goldDark:   "#c9971a",
  terra:      "#d45c1a",   // terracotta
  terraLight: "#f07640",
  cream:      "#f5ead0",
  creamDim:   "#c8b99a",
  white:      "#ffffff",
  textBody:   "#e8dfc8",
  textDim:    "#8a7d68",
  border:     "rgba(245,200,66,0.18)",
  borderSoft: "rgba(245,200,66,0.09)",
  justina:    "#f472b6",   // pink for Justina's turn
  nathaniel:  "#f07640",   // terracotta-orange for Nathaniel's turn
};

// -- Styles 

const styles = {
  shell: {
    minHeight: "100vh", width: "100%",
    background: `linear-gradient(160deg, ${C.bg} 0%, ${C.bgMid} 100%)`,
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "1rem", boxSizing: "border-box",
    fontFamily: "'Playfair Display', Georgia, serif", color: C.textBody,
  },
  setupCard: {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 20,
    padding: "2rem 1.75rem", maxWidth: 460, width: "100%",
    textAlign: "center",
    boxShadow: `0 32px 80px rgba(0,0,0,0.65), inset 0 1px 0 rgba(245,200,66,0.1)`,
    position: "relative", overflow: "hidden",
  },
  setupTitle: {
    color: C.gold, fontSize: "1.5rem", margin: "0.25rem 0 1.25rem", lineHeight: 1.2,
    textShadow: `0 0 28px rgba(245,200,66,0.35)`,
    fontFamily: "'Playfair Display', Georgia, serif",
  },
  chipList: { display: "flex", flexDirection: "column", gap: "0.5rem" },
  chip: {
    display: "flex", alignItems: "center", gap: "0.75rem",
    border: `1px solid`, borderRadius: 12, padding: "0.7rem 1rem",
    cursor: "pointer", transition: "all 0.18s",
    fontFamily: "'Playfair Display', Georgia, serif", width: "100%",
  },
  primaryBtn: {
    width: "100%",
    background: `linear-gradient(135deg, ${C.terra} 0%, ${C.gold} 100%)`,
    color: "#1a0800", border: "none", borderRadius: 12,
    padding: "0.82rem", fontSize: "1rem", fontWeight: 700,
    cursor: "pointer", fontFamily: "'Playfair Display', Georgia, serif",
    boxShadow: `0 4px 20px rgba(212,92,26,0.4)`, transition: "all 0.18s",
    letterSpacing: "0.02em",
  },
  ghostBtn: {
    background: "none", border: "none", color: C.textDim,
    cursor: "pointer", fontSize: "0.8rem", marginTop: "0.4rem",
    fontFamily: "Georgia, serif",
  },
  input: {
    width: "100%", padding: "0.65rem 1rem", borderRadius: 10,
    border: `1px solid rgba(245,200,66,0.2)`,
    background: "rgba(255,255,255,0.05)",
    color: C.cream, fontSize: "0.88rem",
    fontFamily: "Georgia, serif",
    outline: "none", boxSizing: "border-box",
  },

  // Loading
  loadingScreen: {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    minHeight: "40vh",
  },
  storyOverlay: {
    position: "fixed", inset: 0, background: "rgba(5,14,7,0.85)",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    zIndex: 50, backdropFilter: "blur(3px)",
  },
  spinner: {
    width: 38, height: 38, borderRadius: "50%",
    border: `3px solid rgba(245,200,66,0.15)`,
    borderTop: `3px solid ${C.gold}`,
    animation: "spin 0.9s linear infinite",
  },

  // Toast
  toast: {
    position: "fixed", top: 20, right: 20, zIndex: 100,
    background: C.card,
    border: `1px solid ${C.gold}`,
    borderRadius: 14, padding: "0.85rem 1rem",
    display: "flex", alignItems: "flex-start", gap: "0.75rem",
    maxWidth: 300, boxShadow: `0 8px 36px rgba(0,0,0,0.7), 0 0 0 1px rgba(245,200,66,0.1)`,
  },
  toastName: { color: C.gold, fontWeight: 700, fontSize: "0.85rem", fontFamily: "'Playfair Display', serif" },
  toastDesc: { color: C.creamDim, fontSize: "0.77rem", marginTop: "0.2rem", lineHeight: 1.5 },

  // Story root
  storyRoot: {
    minHeight: "100vh",
    background: `linear-gradient(160deg, ${C.bg}, ${C.bgMid})`,
    fontFamily: "'Playfair Display', Georgia, serif", color: C.textBody,
    display: "flex", flexDirection: "column", alignItems: "center",
    overflowY: "auto",
  },
  storyPage: {
    maxWidth: 600, width: "100%", padding: "1.25rem 1.25rem 4rem",
    boxSizing: "border-box",
  },
  topBar: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: "1.5rem", paddingBottom: "0.9rem",
    borderBottom: `1px solid ${C.borderSoft}`,
  },
  sessionLabel: {
    color: C.goldDark, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: 2.5,
    fontFamily: "system-ui, sans-serif", fontWeight: 600,
  },
  newBtn: {
    background: "rgba(245,200,66,0.06)",
    border: `1px solid rgba(245,200,66,0.2)`,
    borderRadius: 8, color: C.textDim, cursor: "pointer", fontSize: "0.72rem",
    padding: "0.3rem 0.7rem", fontFamily: "Georgia, serif",
    transition: "all 0.18s",
  },
  beatBadge: {
    display: "inline-block",
    background: "rgba(245,200,66,0.07)",
    border: `1px solid rgba(245,200,66,0.3)`,
    borderRadius: 20,
    color: C.gold, fontSize: "0.72rem", fontWeight: 700,
    padding: "0.3rem 0.9rem", letterSpacing: 1.4, textTransform: "uppercase",
    marginBottom: "1.1rem", fontFamily: "system-ui, sans-serif",
  },
  narration: {
    fontSize: "1.07rem", lineHeight: 1.92, color: C.textBody,
    marginBottom: "0.5rem",
    fontFamily: "'Playfair Display', Georgia, serif",
  },

  // Choices
  choiceSection: { marginTop: "1.35rem" },
  turnLabel: {
    display: "inline-block", border: "2px solid", borderRadius: 30,
    fontSize: "0.72rem", fontWeight: 700, padding: "0.3rem 1rem",
    letterSpacing: 1.8, textTransform: "uppercase", marginBottom: "0.85rem",
    fontFamily: "system-ui, sans-serif",
  },
  choicePrompt: {
    fontSize: "0.72rem", fontWeight: 700, letterSpacing: 1.6,
    textTransform: "uppercase", marginBottom: "0.65rem",
    fontFamily: "system-ui, sans-serif", color: C.textDim,
  },
  choiceBtn: {
    display: "flex", alignItems: "flex-start", gap: "0.75rem",
    width: "100%",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid",
    borderRadius: 12,
    padding: "0.85rem 1.1rem", cursor: "pointer",
    marginBottom: "0.55rem", transition: "all 0.18s",
    fontFamily: "Georgia, serif", textAlign: "left",
  },
  choiceLetter: {
    fontWeight: 700, fontSize: "1.05rem", minWidth: 20,
    marginTop: "0.05rem", fontFamily: "system-ui, sans-serif",
    flexShrink: 0,
  },
  choiceText: { color: C.cream, fontSize: "0.97rem", lineHeight: 1.58 },

  // Closing
  closingBanner: {
    textAlign: "center", color: C.gold, fontSize: "1.3rem", fontWeight: 700,
    marginBottom: "1.35rem", letterSpacing: 1.5,
    textShadow: `0 0 24px rgba(245,200,66,0.4)`,
    fontFamily: "'Playfair Display', serif",
  },
  ritualCard: {
    background: "rgba(30,107,53,0.08)",
    border: `1px solid rgba(45,158,82,0.25)`,
    borderRadius: 16, padding: "1.2rem 1.3rem",
  },
  ritualTag: {
    color: C.textDim, fontSize: "0.68rem", textTransform: "uppercase",
    letterSpacing: 1.8, marginBottom: "0.35rem",
    fontFamily: "system-ui, sans-serif",
  },
  ritualBody: { color: C.creamDim, fontSize: "0.9rem", lineHeight: 1.7 },
  achBox: {
    border: "1px solid", borderRadius: 10,
    padding: "0.8rem 0.95rem", marginBottom: "0.8rem",
  },
  recapBox: {
    background: "rgba(255,255,255,0.02)",
    border: `1px solid rgba(245,200,66,0.1)`,
    borderRadius: 12, padding: "1rem 1.15rem",
  },
  recapLabel: {
    color: C.textDim, fontSize: "0.68rem", textTransform: "uppercase",
    letterSpacing: 1.8, marginBottom: "0.5rem", fontFamily: "system-ui, sans-serif",
  },
  recapText: { color: C.creamDim, fontSize: "0.84rem", lineHeight: 1.75 },

  errorBox: {
    background: "rgba(212,92,26,0.08)", border: "1px solid rgba(212,92,26,0.25)",
    borderRadius: 10, padding: "0.75rem 1rem", marginTop: "0.75rem",
  },
  retryBtn: {
    background: "none", border: `1px solid rgba(212,92,26,0.4)`,
    borderRadius: 6, color: C.terraLight, cursor: "pointer",
    fontSize: "0.78rem", padding: "0.3rem 0.65rem", marginTop: "0.4rem",
    fontFamily: "Georgia, serif",
  },
};

// -- CSS Animations & Fonts 

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap');

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes toastIn { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:translateX(0); } }
  @keyframes fadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
  @keyframes shimmer { 0%,100% { opacity:0.4; } 50% { opacity:0.8; } }

  .toast-in { animation: toastIn 0.3s ease; }

  .chip-btn:hover {
    transform: translateX(3px);
    filter: brightness(1.12);
    border-color: rgba(245,200,66,0.5) !important;
  }
  .primary-btn:hover {
    transform: scale(1.02);
    filter: brightness(1.1);
    box-shadow: 0 6px 28px rgba(212,92,26,0.5) !important;
  }
  .choice-btn:hover {
    background: rgba(245,200,66,0.07) !important;
    transform: translateX(5px);
  }
  .new-btn:hover {
    color: #f5c842 !important;
    border-color: rgba(245,200,66,0.4) !important;
  }

  input:focus {
    border-color: rgba(245,200,66,0.5) !important;
    box-shadow: 0 0 0 3px rgba(245,200,66,0.08);
  }

  /* Ankara-inspired geometric border pattern using CSS */
  .ankara-border {
    position: relative;
  }
  .ankara-border::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(135deg,
      #f5c842 0%, #d45c1a 25%, #1e6b35 50%, #d45c1a 75%, #f5c842 100%
    );
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
    animation: shimmer 4s ease-in-out infinite;
  }

  /* Subtle Adinkra-style background texture */
  .adinkra-bg {
    background-image:
      radial-gradient(circle at 20% 20%, rgba(30,107,53,0.08) 0%, transparent 50%),
      radial-gradient(circle at 80% 80%, rgba(212,92,26,0.06) 0%, transparent 50%),
      radial-gradient(circle at 50% 50%, rgba(245,200,66,0.03) 0%, transparent 70%);
  }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: rgba(245,200,66,0.3); border-radius: 4px; }
  * { box-sizing: border-box; }
`;
