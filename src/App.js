import { useState, useEffect, useRef, useCallback } from "react";

// ─── ARTIFACT SHIM: in-memory localStorage (sandbox blocks real localStorage) ───
const _mem = {};
const localStorage = {
  getItem: (k) => _mem[k] !== undefined ? _mem[k] : null,
  setItem: (k, v) => { _mem[k] = String(v); },
  removeItem: (k) => { delete _mem[k]; },
};

// ═══════════════════════════════════════════════════════════════
// SHARED: COLOR SYSTEM
// ═══════════════════════════════════════════════════════════════
const C = {
  ink: "#050e07", bg: "#0d1a0f", bgMid: "#132214", card: "#0f1e11",
  green: "#1e6b35", greenLight: "#2d9e52", gold: "#f5c842", goldDark: "#c9971a",
  terra: "#d45c1a", terraLight: "#f07640", cream: "#f5ead0",
  creamDim: "#c8b99a", textBody: "#e8dfc8", textDim: "#8a7d68",
  border: "rgba(245,200,66,0.18)", borderSoft: "rgba(245,200,66,0.09)",
  justina: "#00c49a", nathaniel: "#ff8c5a",
};
const UNKNOWN_COLORS = ["#a78bfa", "#f472b6", "#60a5fa", "#34d399"];

// ═══════════════════════════════════════════════════════════════
// SHARED: PROVIDERS
// ═══════════════════════════════════════════════════════════════
const PROVIDERS = [
  { id: "anthropic", label: "Claude (recommended)", model: "claude-sonnet-4-20250514", prefix: "sk-ant-" },
  { id: "gemini", label: "Gemini", model: "gemini-2.5-flash", prefix: "" },
  { id: "deepseek", label: "DeepSeek", model: "deepseek-chat", prefix: "" },
  { id: "groq", label: "Groq", model: "llama-3.3-70b-versatile", prefix: "" },
];

// ═══════════════════════════════════════════════════════════════
// SHARED: AI CALL (works for all providers)
// ═══════════════════════════════════════════════════════════════
function parseAIJson(raw) {
  let clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  try { return JSON.parse(clean); } catch {}
  // Fix unescaped newlines/tabs inside strings
  let inString = false, escaped = false, fixed = '';
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '"' && !escaped) inString = !inString;
    if (ch === '\\' && !escaped) escaped = true; else escaped = false;
    if (inString && ch === '\n') fixed += '\\n';
    else if (inString && ch === '\r') fixed += '';
    else if (inString && ch === '\t') fixed += '\\t';
    else fixed += ch;
  }
  try { return JSON.parse(fixed); } catch {}
  const match = fixed.match(/\{[\s\S]*\}/) || fixed.match(/\{[\s\S]*/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
    try { return JSON.parse(match[0].replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')); } catch {}
    // Repair truncated JSON
    let repair = match[0];
    const qc = (repair.match(/(?<!\\)"/g) || []).length;
    if (qc % 2 !== 0) repair += '"';
    const opens = (repair.match(/[\[{]/g) || []).length;
    const closes = (repair.match(/[\]}]/g) || []).length;
    for (let i = 0; i < opens - closes; i++) repair += repair.lastIndexOf('{') > repair.lastIndexOf('[') ? '}' : ']';
    try { return JSON.parse(repair); } catch {}
  }
  throw new Error(`Parse failed. Response start: "${raw.substring(0, 150)}..."`);
}

async function callAI(provider, apiKey, model, messages, systemPrompt) {
  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model, max_tokens: 4096, system: systemPrompt, messages }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    if (!res.ok) throw new Error(`Claude error: ${res.status}`);
    const text = data.content?.[0]?.text;
    if (!text) throw new Error("Claude returned empty response. Try again.");
    return text;
  }
  if (provider === "gemini") {
    const contents = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents, generationConfig: { maxOutputTokens: 4096, temperature: 0.9, responseMimeType: "application/json" } }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err?.error?.message || `Gemini error ${res.status}`); }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned empty response. Try again.");
    return text;
  }
  const base = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.groq.com/openai";
  const path = provider === "deepseek" ? "/chat/completions" : "/v1/chat/completions";
  const res = await fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: 4096, temperature: 0.9, response_format: { type: "json_object" }, messages: [{ role: "system", content: systemPrompt }, ...messages] }),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err?.error?.message || `${provider} error ${res.status}`); }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${provider} returned empty response. Try again.`);
  return text;
}

// Battle Arena uses a slightly different call signature (returns parsed JSON)
async function battleApiCall(provider, apiKey, system, messages) {
  const provObj = PROVIDERS.find(p => p.id === provider);
  let raw = '';
  const maxTok = 3000;
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: provObj.model, max_tokens: maxTok, system, messages }) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `Claude error ${res.status}`); }
    const d = await res.json(); raw = d.content?.[0]?.text || '';
  } else if (provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${provObj.model}:generateContent?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), generationConfig: { maxOutputTokens: maxTok, responseMimeType: "application/json" } }) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `Gemini error ${res.status}`); }
    const d = await res.json(); raw = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } else {
    const ep = { deepseek: 'https://api.deepseek.com/chat/completions', groq: 'https://api.groq.com/openai/v1/chat/completions' };
    const res = await fetch(ep[provider], { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ model: provObj.model, max_tokens: maxTok, response_format: { type: "json_object" }, messages: [{ role: 'system', content: system }, ...messages] }) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `${provider} error ${res.status}`); }
    const d = await res.json(); raw = d.choices?.[0]?.message?.content || '';
  }
  return parseAIJson(raw);
}

// ═══════════════════════════════════════════════════════════════
// SHARED: SOUND SYSTEM
// ═══════════════════════════════════════════════════════════════
let audioCtx = null;
const MuteRef = { muted: false };
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
function playTone({ freq = 440, freq2, type = "sine", gain = 0.18, duration = 0.12, delay = 0 }) {
  try {
    const ctx = getAudio(); const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination); osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    if (freq2) osc.frequency.linearRampToValueAtTime(freq2, ctx.currentTime + delay + duration);
    g.gain.setValueAtTime(0, ctx.currentTime + delay);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + delay + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
    osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + duration + 0.05);
  } catch {}
}
const SFX = {
  click: () => { if (MuteRef.muted) return; playTone({ freq: 520, freq2: 580, gain: 0.12, duration: 0.08 }); },
  select: () => { if (MuteRef.muted) return; playTone({ freq: 660, freq2: 780, gain: 0.14, duration: 0.1 }); },
  back: () => { if (MuteRef.muted) return; playTone({ freq: 440, freq2: 330, gain: 0.1, duration: 0.1 }); },
  next: () => { if (MuteRef.muted) return; playTone({ freq: 440, gain: 0.13, duration: 0.1 }); playTone({ freq: 550, gain: 0.13, duration: 0.1, delay: 0.08 }); playTone({ freq: 660, gain: 0.13, duration: 0.12, delay: 0.16 }); },
  achievement: () => { if (MuteRef.muted) return; playTone({ freq: 523, gain: 0.2, duration: 0.12 }); playTone({ freq: 659, gain: 0.2, duration: 0.12, delay: 0.1 }); playTone({ freq: 784, gain: 0.2, duration: 0.12, delay: 0.2 }); playTone({ freq: 1047, gain: 0.22, duration: 0.25, delay: 0.3 }); },
  begin: () => { if (MuteRef.muted) return; [0, 0.1, 0.2, 0.32, 0.46].forEach((d, i) => { playTone({ freq: [330, 392, 440, 523, 659][i], gain: 0.15, duration: 0.18, delay: d }); }); },
  trait: () => { if (MuteRef.muted) return; playTone({ freq: 392, gain: 0.15, duration: 0.15 }); playTone({ freq: 523, gain: 0.18, duration: 0.2, delay: 0.12 }); },
  item: () => { if (MuteRef.muted) return; playTone({ freq: 880, freq2: 1100, gain: 0.12, duration: 0.15 }); playTone({ freq: 660, gain: 0.1, duration: 0.1, delay: 0.12 }); },
};

// ═══════════════════════════════════════════════════════════════
// TRAIT BADGE + INVENTORY + STAR RATING
// ═══════════════════════════════════════════════════════════════
const TRAIT_ICONS = { courage:{icon:"🦁",color:"#f59e0b",label:"Courage"},cleverness:{icon:"🦊",color:"#60a5fa",label:"Cleverness"},heart:{icon:"💚",color:"#34d399",label:"Heart"},persistence:{icon:"🪨",color:"#a78bfa",label:"Persistence"},curiosity:{icon:"🔭",color:"#f472b6",label:"Curiosity"},leadership:{icon:"👑",color:"#fbbf24",label:"Leadership"},creativity:{icon:"🎨",color:"#fb923c",label:"Creativity"},honesty:{icon:"💎",color:"#38bdf8",label:"Honesty"},kindness:{icon:"🌿",color:"#4ade80",label:"Kindness"},humor:{icon:"✨",color:"#e879f9",label:"Humor"} };
function TraitBadge({traitId,level,size="md"}){const t=TRAIT_ICONS[traitId]||{icon:"⭐",color:C.gold,label:traitId};const sz=size==="sm"?28:36;const lvl=Math.min(level||1,5);return(<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}><div style={{width:sz,height:sz,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",background:`${t.color}20`,border:`2px solid ${t.color}${lvl>=3?"aa":"55"}`,boxShadow:lvl>=4?`0 0 12px ${t.color}40`:"none",fontSize:size==="sm"?14:18}}>{t.icon}</div><span style={{fontSize:size==="sm"?8:10,color:t.color,fontWeight:600}}>{t.label}</span><div style={{display:"flex",gap:2}}>{Array.from({length:5}).map((_,i)=><div key={i} style={{width:size==="sm"?3:4,height:size==="sm"?3:4,borderRadius:"50%",background:i<lvl?t.color:`${t.color}30`}}/>)}</div></div>);}
function StarRating({value,onChange,size=28}){return<div style={{display:"flex",gap:4}}>{[1,2,3,4,5].map(i=><span key={i} onClick={()=>onChange?.(i)} style={{fontSize:size,cursor:onChange?"pointer":"default",color:i<=value?C.gold:C.textDim}}>{i<=value?"★":"☆"}</span>)}</div>;}

// ═══════════════════════════════════════════════════════════════
// BATTLE ARENA: AUDIO CONFIG
// ═══════════════════════════════════════════════════════════════
const AUDIO_CFG = {
  'Ancient Colosseum': [{ t: 'lowpass', f: 320, q: 1.0, v: 0.20 }, { t: 'bandpass', f: 170, q: 0.4, v: 0.10 }],
  'Skyscraper Rooftop': [{ t: 'highpass', f: 950, q: 0.7, v: 0.13 }, { t: 'bandpass', f: 2600, q: 2.2, v: 0.06 }],
  'Rainforest Midnight': [{ t: 'lowpass', f: 2800, q: 0.5, v: 0.22 }, { t: 'bandpass', f: 580, q: 0.3, v: 0.09 }],
  'Arctic Blizzard': [{ t: 'highpass', f: 1400, q: 0.5, v: 0.17 }, { t: 'bandpass', f: 3200, q: 1.5, v: 0.07 }],
  'Volcanic Crater': [{ t: 'lowpass', f: 100, q: 0.3, v: 0.30 }, { t: 'bandpass', f: 55, q: 0.6, v: 0.16 }],
  'Lightning Rooftop': [{ t: 'bandpass', f: 1300, q: 0.8, v: 0.15 }, { t: 'highpass', f: 2100, q: 1.0, v: 0.08 }],
  'Underwater Ruins': [{ t: 'lowpass', f: 180, q: 2.5, v: 0.24 }, { t: 'bandpass', f: 75, q: 1.2, v: 0.12 }],
  'Desert Canyon': [{ t: 'bandpass', f: 850, q: 2.0, v: 0.11 }, { t: 'highpass', f: 1700, q: 0.6, v: 0.07 }],
  'Collapsed Cathedral': [{ t: 'lowpass', f: 220, q: 3.5, v: 0.22 }, { t: 'bandpass', f: 130, q: 0.9, v: 0.13 }],
  'Floating Glaciers': [{ t: 'highpass', f: 1900, q: 0.4, v: 0.13 }, { t: 'bandpass', f: 4200, q: 3.5, v: 0.04 }],
  'Neon Cybercity': [{ t: 'bandpass', f: 1100, q: 1.5, v: 0.14 }, { t: 'highpass', f: 3000, q: 0.8, v: 0.07 }],
  'Sunken Warship': [{ t: 'lowpass', f: 200, q: 2.0, v: 0.20 }, { t: 'bandpass', f: 90, q: 1.0, v: 0.10 }],
  'Ancient Library': [{ t: 'lowpass', f: 280, q: 4.0, v: 0.18 }, { t: 'bandpass', f: 150, q: 1.2, v: 0.09 }],
  'Space Station': [{ t: 'highpass', f: 2200, q: 0.3, v: 0.12 }, { t: 'bandpass', f: 5000, q: 2.5, v: 0.04 }],
  'Jungle Temple': [{ t: 'lowpass', f: 2400, q: 0.6, v: 0.21 }, { t: 'bandpass', f: 500, q: 0.4, v: 0.10 }],
  'Mountain Summit': [{ t: 'highpass', f: 1600, q: 0.4, v: 0.15 }, { t: 'bandpass', f: 3500, q: 1.8, v: 0.06 }],
};
const ALL_ARENAS = Object.keys(AUDIO_CFG);
const WEATHER = ['Clear', 'Heavy rain', 'Thick fog', 'Lightning storm', 'Blinding snow', 'Scorching heat', 'Total darkness', 'Ash storm'];
const OBJECTIVES = ['Last one standing', 'Knockout', 'Capture the flag', 'Escape the arena', 'Hold the high ground', 'Survive 10 minutes'];

function brownNoise(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const d = buf.getChannelData(0); let last = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 4; }
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; return s;
}
function startBattleAudio(name) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain(); master.gain.setValueAtTime(0, ctx.currentTime); master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 3); master.connect(ctx.destination);
    const layers = AUDIO_CFG[name] || [{ t: 'lowpass', f: 400, q: 0.8, v: 0.14 }];
    const srcs = layers.map(l => { const src = brownNoise(ctx), fil = ctx.createBiquadFilter(), g = ctx.createGain(); fil.type = l.t; fil.frequency.value = l.f; fil.Q.value = l.q; g.gain.value = l.v; src.connect(fil); fil.connect(g); g.connect(master); src.start(); return src; });
    return { stop: () => { try { master.gain.linearRampToValueAtTime(0, ctx.currentTime + 2); setTimeout(() => { srcs.forEach(s => { try { s.stop(); } catch (e) {} }); ctx.close(); }, 2600); } catch (e) {} }, setVol: v => { try { master.gain.value = Math.max(0, Math.min(1, v)) * 0.9; } catch (e) {} } };
  } catch (e) { return null; }
}

// ═══════════════════════════════════════════════════════════════
// BATTLE ARENA: SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════
const KIDS_YOUNG = `You are a fun battle story narrator for kids ages 6-8. Energetic. Funny. Simple.\nShort sentences. Sound words on their own line: BOOM! CRASH! ZAP! Max 3 sentences per paragraph.\nNo scary violence. Bumps and bruises only. Win through cleverness or heart.\nTTS: sentences under 10 words during action. Ellipses for suspense. Repeat for excitement: "Faster. Faster. FASTER!"\nFREE FOR ALL / TOURNAMENT: track all named fighters, eliminate them one by one with fun moments, never skip a fighter.\nCHOICE DESIGN: 4 options. Options 1-3 fun tactical. Option 4 WILDCARD silly surprising choice with a real tradeoff. Prefix detail "WILDCARD:". Every wildcard must have a cost, risk, or unexpected side effect. Sometimes wildcards backfire hilariously.\nBEAT FLOW: Aim for 5 beats but the battle can end sooner or go longer if the story demands it. Let the narrative find its natural ending.\nRESPOND ONLY IN VALID JSON no markdown:\n{"narrative":"story text \\n for line breaks","choices":[{"id":1,"text":"3-5 word label","detail":"fun and clear"},{"id":2,"text":"label","detail":"what happens"},{"id":3,"text":"label","detail":"what happens"},{"id":4,"text":"label","detail":"WILDCARD: the unexpected silly move"}],"phase":"opening|exchange|climax|resolution","isComplete":false}\nWhen isComplete true omit choices add: "winner":"name","winReason":"2 fun sentences","victoryLine":"cool victory moment","lesson":"1-2 simple sentences"\nTEAM battles add: "mvp":{"name":"name","keyMoment":"their best moment"}`;
const KIDS_OLDER = `You are a cinematic battle narrator for kids ages 9-12. Vivid. Fast. Fair. Smart.\nMix short punchy sentences with longer setup. Rich vocabulary ok: relentless, outmaneuvered, momentum. Real damage: bruises, fatigue, torn gear. No gore.\nVictories earned through skill strategy or environment.\nFREE FOR ALL / TOURNAMENT: track all named fighters precisely. Eliminate them dramatically in order of defeat. Give every fighter a defining moment. Never skip a fighter.\nTTS: ellipses for suspense. Em dashes for sudden shifts. Short sentence stacks during action. ONE ALL CAPS word per paragraph.\nCHOICE DESIGN: 4 options. Options 1-3 tactical. Option 4 WILDCARD risky high reward with a real downside. Prefix detail "WILDCARD:". Wildcards should have consequences: collateral damage, stamina cost, position loss, or an unpredictable reaction.\nBEAT FLOW: Aim for 6 beats but adapt to the story. End when the battle reaches its natural conclusion, whether that takes 4 beats or 8.\nRESPOND ONLY IN VALID JSON no markdown:\n{"narrative":"story text \\n for dramatic line breaks","choices":[{"id":1,"text":"3-6 word label","detail":"tactical consequence"},{"id":2,"text":"label","detail":"consequence"},{"id":3,"text":"label","detail":"consequence"},{"id":4,"text":"label","detail":"WILDCARD: high-risk consequence"}],"phase":"opening|exchange|climax|resolution","isComplete":false}\nWhen isComplete true omit choices add: "winner":"name","winReason":"2 sentences","victoryLine":"one line or action","lesson":"2-3 sentences"\nTEAM battles add: "mvp":{"name":"name","keyMoment":"decisive contribution"}`;
const INTENSE = `You are an interactive battle narrator. Cinematic. Visceral. Strategy decides. Environment fights back. Ages 13+.\nReal damage visible. No gore. Earned victories only.\nTTS: ellipses for pauses. Em dashes for sudden shifts. Colons before impact. Short sentence stacks under 8 words. ONE ALL CAPS per paragraph. Sound effects isolated lines. Sentences under 15 words during action.\nFREE FOR ALL / TOURNAMENT: Track every named fighter. Eliminate one per beat dramatically, building toward a final confrontation. Every elimination gets its own moment. Never skip a fighter.\nSTRUCTURAL: min 4 exchanges, 2 tactical shifts, 2 environmental interactions, 1 stamina cost per side.\nWILD CARD: if present intervene every 2 beats with chaos or no-win moments.\nCHOICE DESIGN: 4 options. Options 1-3 tactical. Option 4 WILDCARD prefix detail "WILDCARD:". Every wildcard carries real consequence: stamina drain, positional sacrifice, environmental backlash, or opening a vulnerability. Some wildcards should backfire completely.\nBEAT FLOW: Aim for 6 beats but let the battle breathe. End when the story demands it. Some fights end in 4 beats, some in 9.\nRESPOND ONLY IN VALID JSON no markdown:\n{"narrative":"story text \\n for line breaks","choices":[{"id":1,"text":"3-6 word label","detail":"tactical consequence"},{"id":2,"text":"label","detail":"consequence"},{"id":3,"text":"label","detail":"consequence"},{"id":4,"text":"label","detail":"WILDCARD: unpredictable high-risk"}],"phase":"opening|exchange|climax|resolution","isComplete":false}\nWhen isComplete true omit choices add: "winner":"name","winReason":"2 sentences","victoryLine":"one line or action","lesson":"2-3 sentences"\nTEAM battles add: "mvp":{"name":"name","keyMoment":"decisive contribution"}`;
const BRUTAL = `You are a TERMINAL REPORT narrator. Forensic. Clinical. Every sentence is data. Observable external only.\nFORBIDDEN: Em dashes. Parentheses. Semicolons. Exclamation points. More than ONE cap per paragraph. Action paragraphs over 3 sentences. Internal emotions.\nFORENSIC TOOLKIT: Three-dot pause (...). Hard stop (.). Colon causality (:). Short sentence stacks. ONE CAP WORD per paragraph. Isolated line breaks. Contrastive juxtaposition. Three-beat degradation. Diagnostic questions. Catechism Q&A. Sound as data [Material]+[Process]=[Consequence]. Passive voice when fighter loses agency.\nFREE FOR ALL / TOURNAMENT: Each elimination is a data point. Document each fighter's Central Dogma then its failure. Build to last combatant through systematic collapse. Every fighter must be accounted for.\nBEAT STRUCTURE: Beats 1-2 establish Central Dogma. Beats 3-4 expose crack. Beat 5 Will's Threshold. Beat 6 Defining Moment.\nWILD CARD: applies aberrant pressure as Complicating Variable.\nCHOICE DESIGN: 4 options. Options 1-3 test central belief with existential cost. Option 4 WILDCARD violates doctrine prefix "WILDCARD:"\nRESPOND ONLY IN VALID JSON no markdown:\n{"narrative":"forensic text \\n for isolated line breaks","choices":[{"id":1,"text":"3-6 word label","detail":"existential cost"},{"id":2,"text":"label","detail":"cost"},{"id":3,"text":"label","detail":"cost"},{"id":4,"text":"label","detail":"WILDCARD: unknowable consequence"}],"phase":"premortem|exchange|threshold|execution|residual","isComplete":false}\nWhen isComplete true omit choices add: "winner":"name","definingMoment":"exact inversion one sentence","indifferentLaw":"universal principle 2 sentences","scaredInstrument":{"name":"one victor-side character","sacrifice":"existential cost one sentence"},"hollowLine":"epitaph not boast"`;

function getBattleToneSystem(tone) { if (tone === 'kids_young') return KIDS_YOUNG; if (tone === 'kids_older') return KIDS_OLDER; if (tone === 'brutal') return BRUTAL; return INTENSE; }
function getMaxBeats(tone) { return tone === 'kids_young' ? 5 : 6; }
const BATTLE_LENGTHS = [
  { id: 'scout', label: 'Scout', sub: '3-4 beats, quick and decisive', icon: '⚡', min: 3, max: 4 },
  { id: 'hero', label: 'Hero', sub: '5-6 beats, full experience', icon: '⚔️', min: 5, max: 6 },
  { id: 'champion', label: 'Champion', sub: '7-8 beats, extended battle', icon: '🛡️', min: 7, max: 8 },
  { id: 'legend', label: 'Legend', sub: '9+ beats, epic saga', icon: '👑', min: 9, max: 12 },
];
const NARRATIVE_DENSITY = [
  { id: 'short', label: 'Short', sub: '80-120 words per beat', icon: '⚡', words: '80-120', desc: 'Be concise. No filler. Every sentence advances the action.' },
  { id: 'quest', label: 'Quest', sub: '150-250 words per beat', icon: '📖', words: '150-250', desc: 'Balanced prose with enough detail to feel like a real adventure.' },
  { id: 'cinematic', label: 'Cinematic', sub: '300-450 words per beat', icon: '🪶', words: '300-450', desc: 'Paint full scenes with sensory detail, emotional beats, and immersive storytelling.' },
];
const ADVENTURE_DENSITY = [
  { id: 'short', label: 'Short', sub: '100-150 words per beat', icon: '⚡', words: '100-150', desc: 'Quick decisions, fast pacing. Every sentence moves the story forward.' },
  { id: 'quest', label: 'Quest', sub: '200-350 words per beat', icon: '📖', words: '200-350', desc: 'Balanced prose with enough detail to set scenes and build tension.' },
  { id: 'cinematic', label: 'Cinematic', sub: '400-600 words per beat', icon: '🪶', words: '400-600', desc: 'Full scenes with NPC dialogue, environmental detail, and emotional beats.' },
];

const ARCHETYPES = [
  { group: 'Power', options: ['The Paragon', 'The Berserker', 'The Speedster', 'The Psychic', 'The Sorcerer', 'The Nullifier'] },
  { group: 'Combat Elite', options: ['The Operator', 'The Tactician', 'The Assassin', 'The Survivor', 'The Weapon Saint'] },
  { group: 'Exotic', options: ['The Cosmic Entity', 'The Reality Warper', 'The Time Manipulator', 'The Regenerator', 'The Adaptive'] },
  { group: 'Team Types', options: ['The Commander', 'The Shield', 'The Tank', 'The Infiltrator'] },
];
const FORGE_SYS = `You are the Original Character Forge. Generate a battle-ready original character. Legally distinct from all existing IP.\nRespond ONLY valid JSON no markdown:\n{"name":"Original name","title":"4-6 word descriptor","appearance":"One sentence physical presence","combatStyle":"How they fight one sentence.","centralDogma":"Core belief one sentence.","abilities":"2-3 capabilities including one limitation one sentence.","flaw":"Exploitable weakness one sentence.","voiceSample":"One short dialogue line"}`;

function getBriefingPrompt(tone, type, fighters, arena, weather, objective, wc) {
  const fStr = fighters.join(' vs ');
  const wcLine = wc ? `\nWILD CARD: ${wc.name} , objective: ${wc.objective}` : '';
  const isKids = tone === 'kids_young' || tone === 'kids_older';
  if (isKids) return `Generate a fun pre-battle card.\nFighters: ${fStr}${wcLine}\nArena: ${arena}, ${weather}\nObjective: ${objective}\nVoice: Exciting and fun.\nRespond ONLY valid JSON no markdown:\n{"powerContrast":"One fun sentence comparing fighters.","arenaFactor":"One sentence on coolest arena feature.","fightForecast":"One sentence on what kind of battle."}`;
  if (tone === 'brutal') return `Terminal Report pre-battle.\nFighters: ${fStr}${wcLine}\nArena: ${arena}, ${weather}\nObjective: ${objective}\nVoice: Forensic. Detached. No em dashes, parentheses, semicolons, exclamation points.\nRespond ONLY valid JSON no markdown:\n{"alphaDogma":"Central Dogma of first fighter one sentence.","betaDogma":"Central Dogma of second fighter one sentence."${wc ? `,"wildcardVector":"How wild card destabilizes both one sentence."` : ''},"mismatch":"Terminal state prediction one sentence.","arenaLaw":"Immutable rule this arena enforces one sentence."}`;
  return `Pre-battle analysis.\nFighters: ${fStr}${wcLine}\nArena: ${arena}, ${weather}\nObjective: ${objective}\nVoice: Cinematic vivid.\nRespond ONLY valid JSON no markdown:\n{"powerContrast":"Sensory or tactical contrast one sentence."${wc ? `,"wildcardFactor":"How wild card disrupts both one sentence."` : ''},"arenaFactor":"How arena shapes fight one sentence.","fightForecast":"What kind of battle one sentence."}`;
}

// ═══════════════════════════════════════════════════════════════
// ADVENTURE: KNOWN PLAYERS, FAMILY, MUSIC, ETC.
// ═══════════════════════════════════════════════════════════════
const KNOWN_PLAYERS = {
  justina: { id: "justina", name: "Justina", fullName: "Justina Adanna Momah", age: 9, grade: "4th", color: C.justina, reading: "Upper middle-grade. Rich vocabulary, emotional complexity, layered moral choices with real weight. Words like sovereignty, inevitable, treacherous, fractured, consequence are appropriate. Target feel: a strong upper middle-grade novel that respects the reader." },
  nathaniel: { id: "nathaniel", name: "Nathaniel", fullName: "Nathaniel Okenwa Momah", age: 7, grade: "2nd", color: C.nathaniel, reading: "2nd grade. Short sentences, simple words, sound words (BOOM, CRASH, ZAP, WHOOSH, THUD), humor, silliness, concrete choices. Two-word sentences are fine during action. Target feel: an early chapter book, lively and fast-moving." },
};
const FAMILY_CAST = `Known Family Cast (use for cameos and supporting roles):\nParents: Ony/Oxajyn (Dad, wildcard: legend, villain, rogue element, no role restrictions), Mom (Justina Adaobi).\nGrandparents: the Momahs (Engr. Nathan and Gloria), the Anusionwus (Professor Donatus and Justina Iwuoha).\nGreat-grandparents: Nathaniel Momah, Kelechi Momah.\nMomah uncles/aunts: Uncle Chi, Auntie ChiChi, Aunty Fey (Ifechi), Uncle Arinze, Uncle E (Ifeanyi).\nAnusionwu uncles/aunts: Captain A, Auntie Arpita, Uncle R (Reagan), Auntie Ofon, Uncle K (Kissinger), Auntie Megan, Uncle Churchill.\nCousins (Momah): Sofi (13), Kobi (11), Jidenna (8), Kamsi (6), Luka (4).\nCousins (Anusionwu): Maxwell (7), RJ (10), Ella/Urenna (8), Olanna (4), Camille (12), Emerson (8), Hudson (4).\nExtended: Toboy, Kiko, Kai (11), Aya (9), Umi (7).\nBest friends: Justina's best friend Paityn (age 9), Nathaniel's best friend Langston (age 7). They can appear as allies, sidekicks, rivals, or complications. Loyal but opinionated.\nOxajyn (Dad) is the wildcard. He can be a mentor, legend, villain, mysterious force, rogue element, or anything the story needs.\nIdeas: The Momahs as ancient keepers of lost technology. The Anusionwus running a secret academy. Aunty Fey as a healer with a secret. Uncle E gone missing years ago. Younger cousins needing protecting. Older cousins as rivals or reluctant allies.`;
const FAMILY_NAMES = ["justina", "nathaniel", "ony", "oxajyn", "paityn", "langston", "sofi", "kobi", "jidenna", "kamsi", "luka", "maxwell", "rj", "ella", "urenna", "olanna", "camille", "emerson", "hudson", "toboy", "kiko", "kai", "aya", "umi"];
const TONES = [{ id: "epic", label: "Epic and dramatic", emoji: "⚔️" }, { id: "funny", label: "Funny and lighthearted", emoji: "😂" }, { id: "spooky", label: "Spooky and mysterious", emoji: "👻" }, { id: "warm", label: "Heartwarming and hopeful", emoji: "💛" }];
const DURATIONS = [{ id: "20", label: "20 minutes", sub: "4-5 decisions, lean narration" }, { id: "45", label: "45 minutes", sub: "6-8 decisions, full experience" }, { id: "60", label: "60+ minutes", sub: "Up to 12 decisions, everything" }];
const FALLBACK_WORLDS = [{ title: "Cloud Summit", desc: "A mountain range where clouds are solid enough to walk on" }, { title: "Backwards Village", desc: "A village where time flows backwards after sunset" }, { title: "The Vanishing Circus", desc: "A traveling circus that appears only in places no one remembers" }, { title: "Bone Kingdom", desc: "An underwater kingdom built inside the bones of an ancient creature" }, { title: "The Season Doors", desc: "A forest where every tree is a door to a different season" }];
const BEAT_STYLES = { campfire: { bg: "linear-gradient(135deg, #d45c1a 0%, #f07640 100%)", icon: "🔥", label: "Campfire" }, wonder: { bg: "linear-gradient(135deg, #0d7377 0%, #14b8a6 100%)", icon: "✨", label: "Wonder" }, signature: { bg: "linear-gradient(135deg, #6d28d9 0%, #a78bfa 100%)", icon: "⭐", label: "The Defining Turn" } };
const sanitizeId = (name) => name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, "_");
const getLS = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const setLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));
function readingLevelForAge(age) { if (age <= 7) return "Ages 5-7: Short sentences, simple words, sound words, concrete choices, humor. Early chapter book feel."; if (age <= 10) return "Ages 8-10: Mixed sentence length, richer vocabulary, emotional complexity. Confident middle-grade feel."; return "Ages 11+: Long layered sentences, full vocabulary, moral complexity, real sacrifice. Upper middle-grade or YA feel."; }
function getPlayerColor(playerId, playerColors) { if (playerId === "justina") return C.justina; if (playerId === "nathaniel") return C.nathaniel; return playerColors[playerId] || C.gold; }
function assignColors(playerList) { const colors = {}; let idx = 0; playerList.forEach(p => { if (p.id === "justina" || p.id === "nathaniel") return; colors[p.id] = UNKNOWN_COLORS[idx % UNKNOWN_COLORS.length]; idx++; }); return colors; }

const WORLD_GEN_PROMPT = `Generate exactly 5 imaginative world options for a children's choose-your-own-adventure story (ages 7-9). Each world must be surprising, specific, and distinct. Range from grounded to wildly fantastical. Do NOT use overused settings: volcano city, robot teacher school, drifting ocean islands, talking jungle, unnamed space station. Return ONLY a JSON array of 5 objects with "title" (2-3 words) and "desc" (one vivid sentence). No markdown, no explanation.`;

// ═══════════════════════════════════════════════════════════════
// ADVENTURE: MUSIC SYSTEM
// ═══════════════════════════════════════════════════════════════
const trackBuilders = {
  epic: (ctx) => { const intervals = []; const nodes = []; const mg = ctx.createGain(); mg.gain.value = 0.07; mg.connect(ctx.destination); const bass = ctx.createOscillator(); bass.type = "sawtooth"; bass.frequency.value = 55; const bg = ctx.createGain(); bg.gain.value = 0.4; const bf = ctx.createBiquadFilter(); bf.type = "lowpass"; bf.frequency.value = 120; bass.connect(bf); bf.connect(bg); bg.connect(mg); bass.start(); nodes.push(bass); const mid = ctx.createOscillator(); mid.type = "sawtooth"; mid.frequency.value = 82.4; const midg = ctx.createGain(); midg.gain.value = 0.25; mid.connect(midg); midg.connect(mg); mid.start(); nodes.push(mid); let beat = 0; intervals.push(setInterval(() => { try { const n = ctx.createOscillator(); n.type = "sine"; n.frequency.value = 80; const g = ctx.createGain(); g.gain.setValueAtTime(0.5, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18); n.connect(g); g.connect(mg); n.start(); n.stop(ctx.currentTime + 0.2); beat++; if (beat % 4 === 0) [196, 220, 246, 220].forEach((f, i) => playTone({ freq: f, type: "sawtooth", gain: 0.04, duration: 0.4, delay: i * 0.38 })); } catch {} }, 1200)); return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { mg.disconnect(); } catch {} }; },
  spooky: (ctx) => { const intervals = []; const nodes = []; const mg = ctx.createGain(); mg.gain.value = 0.055; mg.connect(ctx.destination); const e1 = ctx.createOscillator(); e1.type = "sine"; e1.frequency.value = 110; const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 3.5; const lg = ctx.createGain(); lg.gain.value = 15; lfo.connect(lg); lg.connect(e1.frequency); const eg = ctx.createGain(); eg.gain.value = 0.5; e1.connect(eg); eg.connect(mg); e1.start(); lfo.start(); nodes.push(e1, lfo); intervals.push(setInterval(() => { try { playTone({ freq: [880, 740, 659, 587, 830][Math.floor(Math.random() * 5)], gain: 0.025, duration: 1.8 }); } catch {} }, 4000 + Math.random() * 5000)); return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { mg.disconnect(); } catch {} }; },
  playful: (ctx) => { const intervals = []; const nodes = []; const mg = ctx.createGain(); mg.gain.value = 0.055; mg.connect(ctx.destination); const b = ctx.createOscillator(); b.type = "triangle"; b.frequency.value = 261.6; const bg2 = ctx.createGain(); bg2.gain.value = 0.15; b.connect(bg2); bg2.connect(mg); b.start(); nodes.push(b); const scale = [261.6, 329.6, 392, 523.3, 659.3, 784, 659.3, 523.3]; let step = 0; intervals.push(setInterval(() => { try { playTone({ freq: scale[step % scale.length], type: "triangle", gain: 0.06, duration: 0.22 }); step++; if (step % 8 === 0) playTone({ freq: 1046, freq2: 523, gain: 0.05, duration: 0.4 }); } catch {} }, 480)); return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { mg.disconnect(); } catch {} }; },
  warm: (ctx) => { const intervals = []; const nodes = []; const mg = ctx.createGain(); mg.gain.value = 0.055; mg.connect(ctx.destination); [196, 246.9, 293.7].forEach(f => { const p = ctx.createOscillator(); p.type = "sine"; p.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.18; p.connect(g); g.connect(mg); p.start(); nodes.push(p); }); const mel = [392, 440, 493.9, 523.3, 493.9, 440, 392, 349.2]; let ms = 0; intervals.push(setInterval(() => { try { playTone({ freq: mel[ms % mel.length], gain: 0.05, duration: 1.4 }); ms++; } catch {} }, 2400)); return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { mg.disconnect(); } catch {} }; },
  african: (ctx) => { const intervals = []; const nodes = []; const mg = ctx.createGain(); mg.gain.value = 0.065; mg.connect(ctx.destination); const bd = ctx.createOscillator(); bd.type = "sine"; bd.frequency.value = 80; const bdg = ctx.createGain(); bdg.gain.value = 0.3; const bdf = ctx.createBiquadFilter(); bdf.type = "lowpass"; bdf.frequency.value = 180; bd.connect(bdf); bdf.connect(bdg); bdg.connect(mg); bd.start(); nodes.push(bd); const kora = [293.7, 370, 440, 493.9, 587.3, 493.9, 440, 370]; let ks = 0; intervals.push(setInterval(() => { try { playTone({ freq: kora[ks % kora.length], type: "triangle", gain: 0.055, duration: 0.35 }); ks++; } catch {} }, 380)); intervals.push(setInterval(() => { [0, 760, 1140].forEach(offset => { setTimeout(() => { try { const pitch = offset === 0 ? 120 : offset === 760 ? 100 : 140; const n = ctx.createOscillator(); n.type = "sine"; n.frequency.value = pitch; const g = ctx.createGain(); g.gain.setValueAtTime(0.45, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15); n.connect(g); g.connect(mg); n.start(); n.stop(ctx.currentTime + 0.17); } catch {} }, offset); }); }, 1520)); return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { mg.disconnect(); } catch {} }; },
  scifi: (ctx) => { const intervals = []; const nodes = []; const mg = ctx.createGain(); mg.gain.value = 0.05; mg.connect(ctx.destination); const drone = ctx.createOscillator(); drone.type = "square"; drone.frequency.value = 55; const df = ctx.createBiquadFilter(); df.type = "lowpass"; df.frequency.value = 150; const dg = ctx.createGain(); dg.gain.value = 0.3; drone.connect(df); df.connect(dg); dg.connect(mg); drone.start(); nodes.push(drone); const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.1; const lg = ctx.createGain(); lg.gain.value = 100; lfo.connect(lg); lg.connect(df.frequency); lfo.start(); nodes.push(lfo); intervals.push(setInterval(() => { try { const f = [440, 880, 1320, 1760][Math.floor(Math.random() * 4)]; playTone({ freq: f, gain: 0.02, duration: 0.08 }); setTimeout(() => playTone({ freq: f * 1.5, gain: 0.015, duration: 0.08 }), 150); } catch {} }, 4000 + Math.random() * 5000)); return () => { intervals.forEach(clearInterval); nodes.forEach(n => { try { n.stop(); } catch {} }); try { mg.disconnect(); } catch {} }; },
};
function useAmbientMusic(trackId, muted) { const cleanupRef = useRef(null); useEffect(() => { if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; } if (muted || !trackId || trackId === "none") return; try { const ctx = getAudio(); const builder = trackBuilders[trackId]; if (builder) cleanupRef.current = builder(ctx); } catch {} return () => { if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; } }; }, [trackId, muted]); }

// Soundscape builders (ambient layers independent of music)
const soundscapeBuilders = {
  rain: (ctx) => { const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.3; const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 800; f.Q.value = 0.5; const g = ctx.createGain(); g.gain.value = 0.08; src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(); return () => { try { src.stop(); } catch {} }; },
  fire: (ctx) => { const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.4; const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 350; f.Q.value = 1.5; const g = ctx.createGain(); g.gain.value = 0.06; const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.3; const lg = ctx.createGain(); lg.gain.value = 0.03; lfo.connect(lg); lg.connect(g.gain); src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(); lfo.start(); return () => { try { src.stop(); lfo.stop(); } catch {} }; },
  forest: (ctx) => { const iv = []; const mg = ctx.createGain(); mg.gain.value = 0.04; mg.connect(ctx.destination); iv.push(setInterval(() => { try { const f = [2200, 2800, 3400, 1800][Math.floor(Math.random() * 4)]; playTone({ freq: f, gain: 0.015, duration: 0.3 + Math.random() * 0.4 }); } catch {} }, 2000 + Math.random() * 4000)); const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.15; const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 400; f.Q.value = 0.3; src.connect(f); f.connect(mg); src.start(); return () => { iv.forEach(clearInterval); try { src.stop(); mg.disconnect(); } catch {} }; },
  ocean: (ctx) => { const mg = ctx.createGain(); mg.gain.value = 0.07; mg.connect(ctx.destination); const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5; const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 250; f.Q.value = 0.8; const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.08; const lg = ctx.createGain(); lg.gain.value = 150; lfo.connect(lg); lg.connect(f.frequency); src.connect(f); f.connect(mg); src.start(); lfo.start(); return () => { try { src.stop(); lfo.stop(); mg.disconnect(); } catch {} }; },
};
function useSoundscape(scapeId, muted) { const cleanupRef = useRef(null); useEffect(() => { if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; } if (muted || !scapeId || scapeId === "none") return; try { const ctx = getAudio(); const builder = soundscapeBuilders[scapeId]; if (builder) cleanupRef.current = builder(ctx); } catch {} return () => { if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; } }; }, [scapeId, muted]); }
function getSuggestedTrack(toneText) { if (!toneText) return "african"; const t = toneText.toLowerCase(); if (t.includes("epic") || t.includes("dramatic")) return "epic"; if (t.includes("spooky") || t.includes("mysterious")) return "spooky"; if (t.includes("funny") || t.includes("lighthearted")) return "playful"; if (t.includes("heartwarming") || t.includes("hopeful")) return "warm"; if (t.includes("sci") || t.includes("space")) return "scifi"; return "african"; }

// ═══════════════════════════════════════════════════════════════
// ADVENTURE: SYSTEM PROMPT BUILDER (condensed)
// ═══════════════════════════════════════════════════════════════
function buildSystemPrompt({ playerList, characterChoices, world, tone, duration, continuityMode, priorSessions, hasFamilyContext, playerInventory, playerTraits, narrativeDensity }) {
  const isSolo = playerList.length === 1;
  const isMulti = playerList.length > 2;
  let prompt = `You are a choose-your-own-adventure storyteller for children. Each response must be ONLY valid JSON, no markdown.\nJSON schema:\n{"narration":"string","turnLabel":"[NAME]'S TURN"|null,"beatType":"action"|"wonder"|"campfire"|"signature"|"closing","choicePrompt":"string"|null,"choices":[{"label":"A","text":"string"}]|null,"achievement":null|{"name":"string","description":"string"},"itemFound":null|{"name":"string","icon":"single emoji","description":"string"},"traitEarned":null|{"player":"playerId","trait":"courage|cleverness|heart|persistence|curiosity|leadership|creativity|honesty|kindness|humor"},"isEnding":false,"closingRitual":null}\n\nWhen isEnding is true, include closingRitual:\n{"walkAways":[{"player":"id","text":"string"}],"secretAchievements":[{"player":"id","name":"string","description":"string"}],"thread":"string","recap":"string","traitsSummary":[{"player":"id","trait":"string"}],"itemsSummary":[{"player":"id","name":"string","icon":"emoji"}],"villainPOV":"3-4 sentences from the villain first person reflecting on the battle they lost"}\n\n`;
  prompt += "PLAYERS:\n";
  playerList.forEach(p => {
    const known = KNOWN_PLAYERS[p.id];
    if (known) prompt += `${known.fullName}, age ${known.age}, ${known.grade} grade. Reading: ${known.reading}\n`;
    else prompt += `${p.name}, age ${p.age}. Reading: ${readingLevelForAge(p.age)}\n`;
    const cc = characterChoices[p.id];
    if (cc) { if (cc.type === "self") prompt += `  Playing as themselves.\n`; else if (cc.type === "known") prompt += `  Playing as: ${cc.name}.\n`; else prompt += `  Playing as: ${cc.name} (invented).\n`; }
    const inv = playerInventory?.[p.id];
    if (inv?.length > 0) prompt += `  Inventory: ${inv.map(i => `${i.icon} ${i.name}`).join(", ")}. Reference naturally if relevant.\n`;
    const traits = playerTraits?.[p.id];
    if (traits && Object.keys(traits).length > 0) prompt += `  Traits: ${Object.entries(traits).map(([t,l]) => `${t} (lv${l})`).join(", ")}. NPCs notice these.\n`;
  });
  prompt += `\nWORLD: ${world}\nTONE: ${tone}\nDURATION: ${duration} minutes. `;
  if (duration === "20") prompt += "4-5 decision points, lean narration.\n";
  else if (duration === "45") prompt += "6-8 decision points, fuller narration.\n";
  else prompt += "Up to 12 decision points, all mechanics.\n";
  if (hasFamilyContext) prompt += `\n${FAMILY_CAST}\n`;
  prompt += `\nSTORY RULES:\n- Generate conflict privately. Players discover it.\n- Structure: Act 1 (2-3 beats), Act 2 (4-6 beats, campfire, wonder), Act 3 (1-2 beats, signature, clean ending). Scale to duration.\n- ${isSolo ? "Second person (you)." : "Third person, character names."}\n- 2-4 sentences per paragraph. Sensory details. Side characters must have personality.\n- Start characters with only: name, vague role, one small detail. Build through choices.\n- Villain: design secretly after campfire stakes question. Must have name, motivation, non-obvious weakness, deep world connection. Vary reveal point across sessions.\n- At campfire, ask emotional stakes question as selectable choices (A, B, C), not open-ended. Answer shapes villain.\n`;
  // Consequence system
  prompt += `\nCONSEQUENCES:\n- Wrong choices create real setbacks. Lost items stay lost. No free rescues unless set up earlier. Good choices can still cost something.\n- Reference earlier choices later: "Remember when you kept the feather? That matters now."\n- Three danger tiers (internal, never announced): Low (minor setback), Medium (serious setback), High (story-altering). Warning signal required before high-danger choices.\n- Five failure types to vary: The Trap (sharp immediate), Slow Collapse (stacking), Betrayal (trust broken), Sacrifice Gone Wrong (good intentions backfire), Pyrrhic Victory (win at devastating cost).\n- Dead End Protocol: If path truly closes, say so and offer to return to last choice. Max once per session.\n`;
  // Mechanics
  prompt += `\nMECHANICS:\n- Legendary Visitor: Once per session max. Pop culture character appears, gives one of four gift types (absorbed power, physical object, spoken truth, transferred trait), then leaves. Never stays or recurs.\n- Wonder Moments: Beautiful/magical, no danger. Simple curiosity choice. Between action beats.\n- Signature Moment: One per story. Single weighted choice, not a list. Near end of Act 2 or Act 3 climax.\n- Secret Door: When a player investigates something off-menu, add a new lettered choice to the array. Never punish curiosity.\n- The Glimpse: Once per session on high-danger choice, may add GLIMPSE choice. If selected, story does NOT advance. Describe hazy vision of one consequence, then re-present same choices minus GLIMPSE.\n- Celebrating Success: Pause one beat to let good choices land.\n`;
  // Pacing
  prompt += `\n- Early Stop Rule: If story should wrap sooner, move to shorter climax. Cut beats, not quality.\n- Quiet moment every 3-4 choices.\n${isSolo ? "- Solo: companion with personality who does not take over decisions." : "- Alternate turns consistently."}\n`;
  // Reputation
  prompt += `\nREPUTATION: Patterns build reputations (Protector, Seeker, Braveheart, Clever Mind, The Light). Let the world name it through NPCs.\n`;
  prompt += `\nAchievements: max one per player per session. Triggered by courage, kindness, curiosity, creativity, persistence.\n`;
  // Inventory rules
  prompt += `\nINVENTORY: Once per session, the story may offer a collectible item. Set itemFound with name, icon (one emoji), description. Items are meaningful. If a player has prior items, create moments where they matter.\n`;
  // Trait rules
  prompt += `\nTRAITS (accumulate only, NEVER subtract): Track behavior silently. When demonstrated through choices, set traitEarned. Valid: courage, cleverness, heart, persistence, curiosity, leadership, creativity, honesty, kindness, humor. Max one per player per session. NPCs notice earned traits.\n`;
  // Closing rules
  prompt += `\n- CLOSING: isEnding true. Populate closingRitual with walkAways, secretAchievements, thread, recap, traitsSummary, itemsSummary, villainPOV.\n- villainPOV: 3-4 sentences from villain first person. What surprised them? What will they do next?\n`;
  // Frozen Player Protocol
  prompt += `\nFROZEN PLAYER: If a player freezes or hesitates, restate the choice in simpler terms. For younger players add a third funnier or more physical option. Never move forward without a real choice.\n`;
  if (isMulti) prompt += `\nMULTIPLE PLAYERS: Turn rotation youngest to oldest. Each younger player's choices drop to their reading level.\nHUMOR PROTECTION: At least one funny/surprising moment per act for the youngest player. Runs alongside the story, never deflates older player's experience.\n`;
  if (!isSolo && playerList.length >= 2) {
    const ages = playerList.map(p => p.age).filter(Boolean);
    if (ages.length && Math.max(...ages) - Math.min(...ages) >= 2) prompt += `\nAGE GAP DETECTED: Write narration at oldest level. Drop vocabulary specifically for younger player's choice moments.\n`;
  }
  if (continuityMode === "continue" && priorSessions?.length > 0) {
    prompt += `\nCONTINUITY: Open with 3-sentence cinematic "previously on" recap. Carry forward items, traits, powers. Honor at least one unresolved thread. Use one Story Echo (something from a prior adventure reappears without announcement). Let the world respond to each player's reputation.\nLIVING WORLD RULE: Three echo types: a character remembers, an object returns, or a place has changed. One per session.\nPRIOR SESSIONS:\n`;
    priorSessions.forEach(s => { prompt += `Session: ${s.world} (${s.tone}, ${s.date}). Recap: ${s.recap}\n`; });
  }
  if (narrativeDensity) {
    const ndObj = ADVENTURE_DENSITY.find(n => n.id === narrativeDensity) || ADVENTURE_DENSITY[1];
    prompt += `\nNARRATIVE DENSITY: ${ndObj.label}. Each beat's narration must be ${ndObj.words} words. ${ndObj.desc}`;
  }
  prompt += `\nCRITICAL: Every beat except closing MUST include a "choices" array with at least 2 options.\nIMPORTANT: Respond with ONLY the JSON object. No markdown. No explanation.`;
  return prompt;
}

// ═══════════════════════════════════════════════════════════════
// SHARED UI COMPONENTS
// ═══════════════════════════════════════════════════════════════
function PrimaryBtn({ onClick, children, disabled, style }) {
  return <button onClick={onClick} disabled={disabled} style={{ background: disabled ? C.textDim : `linear-gradient(135deg, ${C.green} 0%, #2a8f48 100%)`, color: C.cream, border: "none", borderRadius: 12, padding: "14px 28px", fontSize: 16, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", width: "100%", opacity: disabled ? 0.5 : 1, transition: "all 0.2s", fontFamily: "inherit", ...style }}>{children}</button>;
}
function ChoiceBtn({ label, text, onClick, color }) {
  return <button onClick={onClick} className="choice-btn" style={{ background: C.card, border: `1px solid ${color || C.border}`, borderRadius: 12, padding: "14px 18px", textAlign: "left", cursor: "pointer", width: "100%", display: "flex", gap: 12, alignItems: "flex-start", transition: "all 0.2s", fontFamily: "inherit" }}><span style={{ color: color || C.gold, fontWeight: 700, fontSize: 18, flexShrink: 0 }}>{label}.</span><span style={{ color: C.cream, fontSize: 15, lineHeight: 1.5 }}>{text}</span></button>;
}
function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return <div style={{ background: "rgba(212,92,26,0.15)", border: `1px solid ${C.terra}`, borderRadius: 12, padding: 16 }}><p style={{ color: C.terraLight, margin: 0, fontSize: 14 }}>{error}</p>{onRetry && <button onClick={onRetry} style={{ marginTop: 10, background: C.terra, color: C.cream, border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Try again</button>}</div>;
}

// ═══════════════════════════════════════════════════════════════
// DAILY CHALLENGE SYSTEM
// ═══════════════════════════════════════════════════════════════
const CHALLENGE_POOL = {
  battle: [
    { id: "b1", text: "Win a battle with Wild Card enabled", check: (ctx) => ctx.wcEnabled },
    { id: "b2", text: "Complete a Scout-length battle (3-4 beats)", check: (ctx) => ctx.battleLength === "scout" },
    { id: "b3", text: "Complete a Legend-length battle (9+ beats)", check: (ctx) => ctx.battleLength === "legend" },
    { id: "b4", text: "Win a battle in the Volcanic Crater arena", check: (ctx) => ctx.arena === "Volcanic Crater" },
    { id: "b5", text: "Use Cinematic narrative density in a battle", check: (ctx) => ctx.narrativeDensity === "cinematic" },
    { id: "b6", text: "Win a team battle", check: (ctx) => ctx.battleType === "team" },
    { id: "b7", text: "Complete a Free For All with 4+ fighters", check: (ctx) => ctx.battleType === "ffa" },
    { id: "b8", text: "Win a battle using Kids Junior tone", check: (ctx) => ctx.tone === "kids_young" },
    { id: "b9", text: "Choose a Wildcard option during battle", check: (ctx) => ctx.usedWildcard },
    { id: "b10", text: "Win a battle in under 4 beats", check: (ctx) => ctx.beatCount <= 4 },
    { id: "b11", text: "Complete a battle in the Space Station", check: (ctx) => ctx.arena === "Space Station" },
    { id: "b12", text: "Win with Short narrative density", check: (ctx) => ctx.narrativeDensity === "short" },
    { id: "b13", text: "Complete a Champion-length battle", check: (ctx) => ctx.battleLength === "champion" },
    { id: "b14", text: "Win a battle during a Lightning storm", check: (ctx) => ctx.weather === "Lightning storm" },
    { id: "b15", text: "Complete a tournament battle", check: (ctx) => ctx.battleType === "tournament" },
  ],
  adventure: [
    { id: "a1", text: "Complete a 20-minute adventure", check: (ctx) => ctx.duration === "20" },
    { id: "a2", text: "Complete a 60-minute adventure", check: (ctx) => ctx.duration === "60" },
    { id: "a3", text: "Earn a trait during an adventure", check: (ctx) => ctx.earnedTrait },
    { id: "a4", text: "Find an item during an adventure", check: (ctx) => ctx.foundItem },
    { id: "a5", text: "Play an adventure with Cinematic density", check: (ctx) => ctx.advDensity === "cinematic" },
    { id: "a6", text: "Play as both Justina and Nathaniel together", check: (ctx) => ctx.players === "both" },
    { id: "a7", text: "Continue a story (Chapter 2)", check: (ctx) => ctx.continued },
    { id: "a8", text: "Complete an adventure with epic tone", check: (ctx) => ctx.tone === "epic" },
    { id: "a9", text: "Complete an adventure with spooky tone", check: (ctx) => ctx.tone === "spooky" },
    { id: "a10", text: "Play a group adventure (3+ players)", check: (ctx) => ctx.playerCount >= 3 },
    { id: "a11", text: "Use Short narrative density", check: (ctx) => ctx.advDensity === "short" },
    { id: "a12", text: "Complete an adventure with funny tone", check: (ctx) => ctx.tone === "funny" },
    { id: "a13", text: "Earn a secret achievement", check: (ctx) => ctx.earnedSecret },
    { id: "a14", text: "Play an adventure in a custom world", check: (ctx) => ctx.customWorld },
    { id: "a15", text: "Continue your saga in a new world", check: (ctx) => ctx.continuedSaga },
  ],
  storytime: [
    { id: "s1", text: "Listen to a story with ocean soundscape", check: (ctx) => ctx.soundscape === "ocean" },
    { id: "s2", text: "Listen to a story with rain soundscape", check: (ctx) => ctx.soundscape === "rain" },
    { id: "s3", text: "Complete an Extended-length story", check: (ctx) => ctx.storyLength === "long" },
    { id: "s4", text: "Listen to a Bedtime Story", check: (ctx) => ctx.genre === "bedtime" },
    { id: "s5", text: "Listen to a Mystery story", check: (ctx) => ctx.genre === "mystery" },
    { id: "s6", text: "Listen to a Superhero story", check: (ctx) => ctx.genre === "superhero" },
    { id: "s7", text: "Use the fire soundscape", check: (ctx) => ctx.soundscape === "fire" },
    { id: "s8", text: "Listen to a Quick story", check: (ctx) => ctx.storyLength === "short" },
    { id: "s9", text: "Generate a story in a saved world", check: (ctx) => ctx.usedWorldSeed },
    { id: "s10", text: "Continue a story (sequel)", check: (ctx) => ctx.continued },
    { id: "s11", text: "Listen to a Myth or Legend", check: (ctx) => ctx.genre === "myth" },
    { id: "s12", text: "Listen to a Sports story", check: (ctx) => ctx.genre === "sports" },
    { id: "s13", text: "Use forest soundscape", check: (ctx) => ctx.soundscape === "forest" },
    { id: "s14", text: "Listen to an Animal Kingdom story", check: (ctx) => ctx.genre === "animals" },
    { id: "s15", text: "Listen to a Historical story", check: (ctx) => ctx.genre === "historical" },
  ],
};

function getDailyChallenge(date) {
  // Seed based on date so everyone sees the same tasks each day
  const seed = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  const pick = (arr, s) => arr[s % arr.length];
  return {
    battle: pick(CHALLENGE_POOL.battle, seed),
    adventure: pick(CHALLENGE_POOL.adventure, seed + 7),
    storytime: pick(CHALLENGE_POOL.storytime, seed + 13),
  };
}

function completeChallenge(type, ctx) {
  try {
    const today = new Date().toLocaleDateString();
    let c = JSON.parse(localStorage.getItem("momah_daily_challenges"));
    if (!c || c.date !== today) return; // No challenges loaded for today
    if (c[type]) return; // Already completed

    const daily = getDailyChallenge(new Date());
    const task = daily[type];
    if (!task) return;

    // Validate the actual task
    if (task.check(ctx || {})) {
      c[type] = true;
      localStorage.setItem("momah_daily_challenges", JSON.stringify(c));
      // Update streak only when at least one task is completed today
      if (!c._streakCounted) {
        c._streakCounted = true;
        localStorage.setItem("momah_daily_challenges", JSON.stringify(c));
        let s = parseInt(localStorage.getItem("momah_streaks") || "0");
        localStorage.setItem("momah_streaks", (s + 1).toString());
      }
    }
  } catch {}
}

function DailyChallenge() {
  const [challenges, setChallenges] = useState(null);
  const [streak, setStreak] = useState(0);
  useEffect(() => {
    try {
      const today = new Date();
      const todayStr = today.toLocaleDateString();
      let c = JSON.parse(localStorage.getItem("momah_daily_challenges"));
      let s = parseInt(localStorage.getItem("momah_streaks") || "0");
      if (!c || c.date !== todayStr) {
        // Check if streak should reset (missed yesterday)
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        if (c && c.date === yesterday.toLocaleDateString() && (c.battle || c.adventure || c.storytime)) {
          // Streak continues
        } else if (c && c.date !== todayStr) {
          s = 0; // Missed a day, reset streak
        }
        const daily = getDailyChallenge(today);
        c = { date: todayStr, battle: false, adventure: false, storytime: false, _streakCounted: false,
              tasks: { battle: daily.battle.text, adventure: daily.adventure.text, storytime: daily.storytime.text } };
        localStorage.setItem("momah_daily_challenges", JSON.stringify(c));
        localStorage.setItem("momah_streaks", s.toString());
      }
      setChallenges(c); setStreak(s);
    } catch {}
  }, []);
  if (!challenges) return null;
  const completedCount = [challenges.battle, challenges.adventure, challenges.storytime].filter(Boolean).length;
  return (
    <div style={{ background: C.card, border: `1px solid ${completedCount === 3 ? C.gold : C.border}`, borderRadius: 16, padding: "16px 20px", marginBottom: 16, transition: "border-color 0.3s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h3 style={{ color: C.gold, margin: 0, fontSize: 16, fontWeight: 700 }}>Daily Missions</h3>
          <p style={{ color: C.textDim, margin: "2px 0 0", fontSize: 11 }}>{completedCount}/3 completed</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: streak > 0 ? "rgba(245,200,66,0.1)" : "rgba(255,255,255,0.05)", padding: "4px 10px", borderRadius: 12 }}>
          <span style={{ fontSize: 14 }}>{streak > 0 ? "🔥" : "💤"}</span>
          <span style={{ color: streak > 0 ? C.gold : C.textDim, fontWeight: 700, fontSize: 13 }}>{streak} Day{streak !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[{ id: "battle", icon: "⚔️", label: "Battle Arena", task: challenges.tasks.battle, done: challenges.battle },
          { id: "adventure", icon: "📖", label: "Adventure", task: challenges.tasks.adventure, done: challenges.adventure },
          { id: "storytime", icon: "🌙", label: "Storytime", task: challenges.tasks.storytime, done: challenges.storytime }
        ].map(m => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, opacity: m.done ? 0.5 : 1, transition: "opacity 0.3s" }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: m.done ? C.green : "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, transition: "background 0.3s" }}>{m.done ? "✅" : m.icon}</div>
            <div style={{ flex: 1 }}><p style={{ color: C.cream, margin: 0, fontSize: 13, fontWeight: 600, textDecoration: m.done ? "line-through" : "none" }}>{m.label}</p><p style={{ color: C.textDim, margin: 0, fontSize: 11 }}>{m.task}</p></div>
          </div>
        ))}
      </div>
      {completedCount === 3 && <div style={{ marginTop: 10, textAlign: "center", padding: "6px", background: "rgba(245,200,66,0.08)", borderRadius: 8 }}><span style={{ color: C.gold, fontSize: 12, fontWeight: 700 }}>All missions complete! See you tomorrow.</span></div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP (unified wrapper)
// ═══════════════════════════════════════════════════════════════
export default function App() {
  // ── Global state ──
  const [provider, setProvider] = useState(() => localStorage.getItem("momah_provider") || "anthropic");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("momah_api_key") || "");
  const [keyInput, setKeyInput] = useState("");
  const [showKeySetup, setShowKeySetup] = useState(false);
  const [muted, setMuted] = useState(() => localStorage.getItem("momah_mute") === "true");
  const [appMode, setAppMode] = useState(null); // null | "battle" | "adventure"
  const [phase, setPhase] = useState("setup_key"); // starts at key setup
  // Parental Controls
  const [childMode, setChildMode] = useState(() => localStorage.getItem("momah_child_mode") === "true");
  const [parentPin, setParentPin] = useState(() => localStorage.getItem("momah_parent_pin") || "");
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinAction, setPinAction] = useState(null);
  function toggleChildMode(){if(childMode){if(parentPin){setPinAction("unlock");setShowPinSetup(true);}else{setChildMode(false);localStorage.setItem("momah_child_mode","false");}}else{if(!parentPin){setPinAction("set");setShowPinSetup(true);}else{setChildMode(true);localStorage.setItem("momah_child_mode","true");}}}
  function handlePinSubmit(){if(pinAction==="set"&&pinInput.length>=4){setParentPin(pinInput);localStorage.setItem("momah_parent_pin",pinInput);setChildMode(true);localStorage.setItem("momah_child_mode","true");setShowPinSetup(false);setPinInput("");}else if(pinAction==="unlock"&&pinInput===parentPin){setChildMode(false);localStorage.setItem("momah_child_mode","false");setShowPinSetup(false);setPinInput("");}}

  useEffect(() => { MuteRef.muted = muted; }, [muted]);
  useEffect(() => { localStorage.setItem("momah_mute", muted ? "true" : "false"); }, [muted]);

  // Check if key already exists
  useEffect(() => { if (apiKey && apiKey.length > 8) setPhase("setup_mode"); }, []);

  // MODE SELECTION SCREEN
  if ((phase === "setup_mode" || (phase === "setup_key" && apiKey && apiKey.length > 8 && !appMode)) && !appMode) {
    if (phase === "setup_key") setPhase("setup_mode");
    const hModes = [
      { id: "battle", icon: "⚔️", label: "Battle Arena", sub: "Pit characters against each other with AI-narrated combat.", accent: C.terra, glow: "rgba(212,92,26,0.22)", aborder: "rgba(212,92,26,0.3)" },
      { id: "adventure", icon: "📖", label: "Choose Your Adventure", sub: "A beat-by-beat story where your choices shape the plot.", accent: "#2d9e52", glow: "rgba(45,158,82,0.18)", aborder: "rgba(45,158,82,0.3)" },
      { id: "storytime", icon: "🌙", label: "Storytime", sub: "A linear, calming story designed to be read aloud at bedtime.", accent: "#8b5cf6", glow: "rgba(139,92,246,0.18)", aborder: "rgba(139,92,246,0.3)" },
    ];
    return (
      <div style={{ minHeight: "100vh", background: C.ink, color: C.cream, fontFamily: "'Playfair Display', Georgia, serif", overflowX: "hidden", position: "relative" }}>
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
          <div style={{ position: "absolute", top: "-10%", left: "50%", transform: "translateX(-50%)", width: 900, height: 700, background: "radial-gradient(ellipse 60% 55% at 50% 30%, rgba(212,92,26,0.22) 0%, rgba(180,60,10,0.10) 40%, transparent 70%)", filter: "blur(2px)" }} />
          <div style={{ position: "absolute", top: "22%", left: "50%", transform: "translateX(-50%)", width: 600, height: 300, background: "radial-gradient(ellipse 50% 40% at 50% 50%, rgba(245,200,66,0.09) 0%, transparent 70%)" }} />
          <div style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", height: 300, background: "linear-gradient(to top, rgba(5,14,7,0.95) 0%, transparent 100%)" }} />
        </div>
        <nav style={{ position: "relative", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 32px", borderBottom: "1px solid rgba(245,200,66,0.08)", background: "rgba(5,14,7,0.7)", backdropFilter: "blur(12px)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>✦</span>
            <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: 0.3, background: `linear-gradient(90deg, ${C.cream} 0%, ${C.gold} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Storyverse AI</span>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {childMode && <span style={{ background: "rgba(30,107,53,0.3)", color: "#2d9e52", fontSize: 10, padding: "3px 8px", borderRadius: 6, fontWeight: 600 }}>🔒 CHILD</span>}
            <button onClick={toggleChildMode} style={{ background: "none", border: "none", color: C.creamDim, fontSize: 18, cursor: "pointer", padding: 4 }}>{childMode ? "🔒" : "🔓"}</button>
            <button onClick={() => setMuted(m => !m)} style={{ background: "none", border: "none", color: C.creamDim, fontSize: 18, cursor: "pointer", padding: 4 }}>{muted ? "🔇" : "🔊"}</button>
            <button onClick={() => setShowKeySetup(true)} style={{ background: "none", border: "none", color: C.creamDim, fontSize: 18, cursor: "pointer", padding: 4 }}>🔑</button>
          </div>
        </nav>
        <main style={{ position: "relative", zIndex: 5, maxWidth: 1060, margin: "0 auto", padding: "0 24px 80px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <section style={{ textAlign: "center", padding: "90px 24px 60px", maxWidth: 780 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(245,200,66,0.09)", border: "1px solid rgba(245,200,66,0.22)", borderRadius: 100, padding: "5px 14px", marginBottom: 32 }}>
              <span style={{ fontSize: 12 }}>✦</span>
              <span style={{ color: C.gold, fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase", fontWeight: 700 }}>AI-Powered Family Storytelling</span>
            </div>
            <h1 style={{ fontSize: "clamp(38px, 8vw, 68px)", fontWeight: 800, lineHeight: 1.15, letterSpacing: -1.5, margin: "0 0 22px", color: C.cream }}>Stories that{" "}<span style={{ background: `linear-gradient(135deg, ${C.gold} 0%, #ffdc7a 40%, ${C.terra} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", display: "inline-block", paddingBottom: 4 }}>grow with you.</span></h1>
            <p style={{ fontStyle: "italic", color: C.creamDim, fontSize: "clamp(15px, 2.5vw, 19px)", lineHeight: 1.65, margin: "0 auto 40px", maxWidth: 540 }}>An AI-powered storytelling app where your family becomes the heroes.</p>
          </section>
          <div style={{ maxWidth: 500, width: "100%", marginBottom: 40 }}><DailyChallenge /></div>
          <div style={{ width: "100%", maxWidth: 640, height: 1, background: "linear-gradient(90deg, transparent 0%, rgba(245,200,66,0.18) 50%, transparent 100%)", marginBottom: 50 }} />
          <section style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
            {hModes.map(m => (
              <div key={m.id} onClick={() => { SFX.select(); setAppMode(m.id); }} style={{ background: `linear-gradient(160deg, ${C.card} 0%, rgba(10,18,12,1) 100%)`, border: `1px solid ${C.border}`, borderRadius: 20, padding: "30px 26px 28px", cursor: "pointer", transition: "all 0.28s ease", position: "relative", overflow: "hidden", boxShadow: "0 6px 24px rgba(0,0,0,0.4)" }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-6px)"; e.currentTarget.style.borderColor = m.aborder; e.currentTarget.style.boxShadow = `0 20px 60px rgba(0,0,0,0.5), 0 0 40px ${m.glow}`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "0 6px 24px rgba(0,0,0,0.4)"; }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 120, background: `radial-gradient(ellipse 80% 80% at 30% 0%, ${m.glow} 0%, transparent 70%)`, pointerEvents: "none", opacity: 0.5 }} />
                <div style={{ width: 52, height: 52, borderRadius: 14, background: `${m.accent}28`, border: `1px solid ${m.accent}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 20 }}>{m.icon}</div>
                <h3 style={{ fontSize: 21, fontWeight: 700, margin: "0 0 10px", color: C.cream, lineHeight: 1.25, letterSpacing: -0.3 }}>{m.label}</h3>
                <p style={{ fontStyle: "italic", color: C.creamDim, fontSize: 14, lineHeight: 1.7, margin: "0 0 22px" }}>{m.sub}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.textDim, fontSize: 13, fontWeight: 700, letterSpacing: 0.3 }}><span>Begin</span><span style={{ fontSize: 15 }}>→</span></div>
              </div>
            ))}
          </section>
          <p style={{ marginTop: 56, color: C.textDim, fontSize: 12, letterSpacing: 2, textTransform: "uppercase" }}>Powered by AI · Built for families</p>
          {parentPin && <button onClick={() => { setPinAction("unlock"); setShowPinSetup(true); }} style={{ marginTop: 12, background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 8, padding: "6px 14px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>📊 Parent Dashboard</button>}
        </main>
        {showKeySetup && <KeySetupOverlay provider={provider} setProvider={setProvider} apiKey={apiKey} setApiKey={setApiKey} keyInput={keyInput} setKeyInput={setKeyInput} onClose={() => setShowKeySetup(false)} onSave={(k, p) => { setApiKey(k); setProvider(p); localStorage.setItem("momah_api_key", k); localStorage.setItem("momah_provider", p); setShowKeySetup(false); }} />}
        {showPinSetup && <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:20}}><div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:24,maxWidth:340,width:"100%",textAlign:"center"}}><p style={{color:C.gold,fontSize:18,fontWeight:700,margin:"0 0 12px"}}>{pinAction==="set"?"Set Parent PIN":"Enter PIN"}</p><p style={{color:C.creamDim,fontSize:13,margin:"0 0 16px"}}>{pinAction==="set"?"This PIN locks adult content.":"Enter your PIN to disable child mode."}</p><input value={pinInput} onChange={e=>setPinInput(e.target.value.replace(/\D/g,""))} placeholder="4+ digits" type="password" maxLength={8} style={{width:"100%",background:C.ink,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 16px",color:C.cream,fontSize:20,textAlign:"center",letterSpacing:8,boxSizing:"border-box",fontFamily:"monospace",marginBottom:16}}/><div style={{display:"flex",gap:10}}><PrimaryBtn disabled={pinInput.length<4} onClick={handlePinSubmit}>{pinAction==="set"?"Set PIN":"Unlock"}</PrimaryBtn><button onClick={()=>{setShowPinSetup(false);setPinInput("");}} style={{background:"none",border:`1px solid ${C.textDim}`,color:C.creamDim,borderRadius:12,padding:"14px 20px",cursor:"pointer",fontSize:14,fontFamily:"inherit"}}>Cancel</button></div></div></div>}
        <GlobalStyles />
      </div>
    );
  }

  if (phase === "setup_key") {
    return <KeySetupScreen provider={provider} setProvider={setProvider} keyInput={keyInput} setKeyInput={setKeyInput} onComplete={(k, p) => { setApiKey(k); setProvider(p); localStorage.setItem("momah_api_key", k); localStorage.setItem("momah_provider", p); setPhase("setup_mode"); }} />;
  }

  if (appMode === "battle") {
    return <BattleArenaMode provider={provider} apiKey={apiKey} muted={muted} setMuted={setMuted} childMode={childMode} onBack={() => { setAppMode(null); setPhase("setup_mode"); }} />;
  }

  if (appMode === "adventure") {
    return <AdventureMode provider={provider} apiKey={apiKey} muted={muted} setMuted={setMuted} childMode={childMode} onBack={() => { setAppMode(null); setPhase("setup_mode"); }} />;
  }

  if (appMode === "storytime") {
    return <StorytimeMode provider={provider} apiKey={apiKey} muted={muted} setMuted={setMuted} childMode={childMode} onBack={() => { setAppMode(null); setPhase("setup_mode"); }} />;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// KEY SETUP SCREEN (standalone, first visit)
// ═══════════════════════════════════════════════════════════════
function KeySetupScreen({ provider, setProvider, keyInput, setKeyInput, onComplete }) {
  const PROVIDER_INFO = [
    { id: "anthropic", emoji: "🤖", label: "Claude", sub: "Best storytelling", placeholder: "sk-ant-api03-...", validate: v => v.startsWith("sk-ant") },
    { id: "gemini", emoji: "✨", label: "Gemini", sub: "Free tier available", placeholder: "AIzaSy...", validate: v => v.length > 10 },
    { id: "deepseek", emoji: "🐋", label: "DeepSeek", sub: "Cheapest option", placeholder: "sk-...", validate: v => v.length > 10 },
    { id: "groq", emoji: "⚡", label: "Groq", sub: "Fastest responses", placeholder: "gsk_...", validate: v => v.length > 10 },
  ];
  const current = PROVIDER_INFO.find(p => p.id === provider) || PROVIDER_INFO[0];
  const keyValid = keyInput.trim().length > 0 && current.validate(keyInput.trim());

  return (
    <div style={{ minHeight: "100vh", background: C.ink, color: C.cream, fontFamily: "'Playfair Display', Georgia, serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 20px", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 20 }}>
          <div style={{ textAlign: "center", marginBottom: 10 }}>
            <p style={{ fontSize: 32, margin: 0 }}>⚡</p>
            <h1 style={{ color: C.gold, fontSize: 26, margin: "8px 0 4px", fontWeight: 800 }}>Storyverse AI</h1>
            <p style={{ color: C.creamDim, fontSize: 14, margin: 0 }}>Pick a provider and paste your API key</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {PROVIDER_INFO.map(p => (
              <button key={p.id} onClick={() => { SFX.select(); setProvider(p.id); setKeyInput(""); }} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "12px 8px",
                border: `2px solid ${provider === p.id ? C.gold : "rgba(245,200,66,0.15)"}`, borderRadius: 12, cursor: "pointer", transition: "all 0.18s",
                background: provider === p.id ? "rgba(245,200,66,0.08)" : "rgba(255,255,255,0.03)", fontFamily: "inherit",
              }}>
                <span style={{ fontSize: 24 }}>{p.emoji}</span>
                <span style={{ color: provider === p.id ? C.gold : C.cream, fontWeight: 700, fontSize: 14 }}>{p.label}</span>
                <span style={{ color: C.textDim, fontSize: 11 }}>{p.sub}</span>
              </button>
            ))}
          </div>
          <div>
            <label style={{ display: "block", color: C.textDim, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.3, marginBottom: 6 }}>{current.label} API Key</label>
            <input value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder={current.placeholder} type="password"
              onKeyDown={e => { if (e.key === "Enter" && keyValid) onComplete(keyInput.trim(), provider); }}
              style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", color: C.cream, fontSize: 14, boxSizing: "border-box", fontFamily: "monospace" }} />
            <p style={{ color: C.textDim, fontSize: 12, margin: "8px 0 0" }}>Get your key from <span style={{ color: C.gold }}>{current.id === "anthropic" ? "console.anthropic.com" : current.id === "gemini" ? "aistudio.google.com" : current.id === "deepseek" ? "platform.deepseek.com" : "console.groq.com"}</span></p>
          </div>
          <PrimaryBtn disabled={!keyValid} onClick={() => onComplete(keyInput.trim(), provider)}>Save & Continue</PrimaryBtn>
        </div>
      </div>
      <GlobalStyles />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// KEY SETUP OVERLAY (from within a mode)
// ═══════════════════════════════════════════════════════════════
function KeySetupOverlay({ provider, setProvider, apiKey, setApiKey, keyInput, setKeyInput, onClose, onSave }) {
  return (
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
          <PrimaryBtn onClick={() => { const k = (keyInput || apiKey).trim(); if (k.length > 8) onSave(k, provider); }}>Save</PrimaryBtn>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 12, padding: "14px 20px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// GLOBAL STYLES
// ═══════════════════════════════════════════════════════════════
function GlobalStyles() {
  return <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&display=swap');
    * { box-sizing: border-box; }
    body { margin: 0; background: ${C.ink}; }
    input::placeholder { color: ${C.textDim}; }
    @keyframes slideDown { from { transform: translateX(-50%) translateY(-20px); opacity: 0; } to { transform: translateX(-50%) translateY(0); opacity: 1; } }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes shimmer { 0%,100% { opacity:0.4; } 50% { opacity:0.8; } }
    .choice-btn:hover { background: rgba(245,200,66,0.07) !important; transform: translateX(5px); }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-thumb { background: rgba(245,200,66,0.3); border-radius: 4px; }
  `}</style>;
}

// ═══════════════════════════════════════════════════════════════
// BATTLE ARENA MODE (full self-contained component)
// ═══════════════════════════════════════════════════════════════
function BattleArenaMode({ provider, apiKey, muted, setMuted, childMode, onBack }) {
  const [screen, setScreen] = useState('tone');
  const [tone, setTone] = useState('');
  const [battleLength, setBattleLength] = useState('hero'); // scout|hero|champion|legend
  const [battleType, setBattleType] = useState('');
  const [fighterA, setFighterA] = useState('');
  const [fighterB, setFighterB] = useState('');
  const [teamSize, setTeamSize] = useState(2);
  const [ffaFighters, setFfaFighters] = useState(['', '', '', '']);
  const [tourneyFighters, setTourneyFighters] = useState(['', '', '', '', '', '', '', '']);
  const [wcEnabled, setWcEnabled] = useState(false);
  const [wc, setWc] = useState({ name: '', objective: '' });
  const [arena, setArena] = useState('');
  const [customArena, setCustomArena] = useState('');
  const [weather, setWeather] = useState('Clear');
  const [objective, setObjective] = useState('');
  const [briefing, setBriefing] = useState(null);
  const [messages, setMessages] = useState([]);
  const [beats, setBeats] = useState([]);
  const [currentBeat, setCurrentBeat] = useState(null);
  const [resolution, setResolution] = useState(null);
  const [beatCount, setBeatCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dots, setDots] = useState(1);
  const [audioOn, setAudioOn] = useState(!muted);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [forgeOpen, setForgeOpen] = useState(false);
  const [forgeTarget, setForgeTarget] = useState(0);
  const [forgeArch, setForgeArch] = useState('');
  const [forgeDetails, setForgeDetails] = useState('');
  const [forgeResult, setForgeResult] = useState(null);
  const [forgeLoading, setForgeLoading] = useState(false);
  const [forgeError, setForgeError] = useState('');
  const [playerA, setPlayerA] = useState('');
  const [playerB, setPlayerB] = useState('');
  const [currentTurn, setCurrentTurn] = useState('A');
  const [cinematicStory, setCinematicStory] = useState(null);
  const [cinematicParas, setCinematicParas] = useState(0);
  const [showAllCinematic, setShowAllCinematic] = useState(false);
  const [cinematicFormat, setCinematicFormat] = useState('1v1');
  const [sessionRating, setSessionRating] = useState(0);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [battleMusic, setBattleMusic] = useState('arena');
  const [battleReadingLevel, setBattleReadingLevel] = useState(null);
  const [narrativeDensity, setNarrativeDensity] = useState('quest'); // short|quest|cinematic
  const audioRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [beats, currentBeat, loading, resolution]);
  useEffect(() => { if (!loading && !forgeLoading) return; const t = setInterval(() => setDots(d => (d % 3) + 1), 500); return () => clearInterval(t); }, [loading, forgeLoading]);
  useEffect(() => () => { audioRef.current?.stop(); window.speechSynthesis?.cancel(); }, []);
  useEffect(() => { const load = () => { const v = window.speechSynthesis?.getVoices() || []; if (v.length) setAvailableVoices(v.filter(x => x.lang.startsWith('en'))); }; load(); window.speechSynthesis?.addEventListener?.('voiceschanged', load); return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', load); }, []);

  const finalArena = arena === 'custom' ? customArena : arena;
  const isKids = tone === 'kids_young' || tone === 'kids_older';
  const blObj = BATTLE_LENGTHS.find(b => b.id === battleLength) || BATTLE_LENGTHS[1];
  const maxBeats = blObj.max;
  const call = (sys, msgs) => battleApiCall(provider, apiKey, sys, msgs);

  const TC = { kids_young: { AC: '#22c55e', ADim: '#22c55e12', ABorder: '#22c55e30' }, kids_older: { AC: '#f59e0b', ADim: '#f59e0b12', ABorder: '#f59e0b30' }, intense: { AC: '#4f8ef7', ADim: '#4f8ef712', ABorder: '#4f8ef730' }, brutal: { AC: '#e03c3c', ADim: '#e03c3c12', ABorder: '#e03c3c30' } };
  const { AC, ADim, ABorder } = TC[tone] || TC.intense;
  const WCC = '#c4922a', WCDim = '#c4922a10', WCBorder = '#c4922a35';
  const M = "'Playfair Display',Georgia,serif", S = "'Playfair Display',Georgia,serif";

  const getFighters = () => {
    if (battleType === '1v1') return [fighterA, fighterB];
    if (battleType === 'team') return [fighterA, fighterB];
    if (battleType === 'ffa') return ffaFighters.filter(f => f.trim());
    if (battleType === 'tournament') return tourneyFighters.filter(f => f.trim());
    return [];
  };
  const randomArena = () => { setArena(ALL_ARENAS[Math.floor(Math.random() * ALL_ARENAS.length)]); };
  useEffect(() => { if (arena === '' && screen === 'arena') randomArena(); }, [screen]);

  const toggleAudio = () => { const n = !audioOn; setAudioOn(n); audioRef.current?.setVol(n ? 1 : 0); };
  const readAloud = (text) => { if (!window.speechSynthesis) return; window.speechSynthesis.cancel(); const utt = new SpeechSynthesisUtterance(text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()); utt.rate = isKids ? 1.0 : 0.88; utt.pitch = isKids ? 1.1 : 0.95; if (selectedVoice) utt.voice = selectedVoice; utt.onstart = () => setIsSpeaking(true); utt.onend = () => setIsSpeaking(false); utt.onerror = () => setIsSpeaking(false); window.speechSynthesis.speak(utt); };
  const stopSpeaking = () => { window.speechSynthesis?.cancel(); setIsSpeaking(false); };

  const openForge = (idx) => { setForgeTarget(idx); setForgeArch(''); setForgeDetails(''); setForgeResult(null); setForgeError(''); setForgeOpen(true); };
  const runForge = async () => { if (!forgeArch) return; setForgeLoading(true); setForgeError(''); try { setForgeResult(await call(FORGE_SYS, [{ role: 'user', content: `Archetype: ${forgeArch}\nDetails: ${forgeDetails || 'none'}` }])); } catch (e) { setForgeError(e.message === 'Failed to fetch' ? 'Could not reach AI provider. Check your API key and connection.' : e.message); } finally { setForgeLoading(false); } };
  const useForge = () => {
    if (!forgeResult) return;
    const s = `${forgeResult.name} , ${forgeResult.title}. ${forgeResult.combatStyle}`;
    if (battleType === '1v1' || battleType === 'team') { forgeTarget === 0 ? setFighterA(s) : setFighterB(s); }
    else if (battleType === 'ffa') { const nf = [...ffaFighters]; nf[forgeTarget] = s; setFfaFighters(nf); }
    else if (battleType === 'tournament') { const nf = [...tourneyFighters]; nf[forgeTarget] = s; setTourneyFighters(nf); }
    setForgeOpen(false);
  };

  const getBriefingData = async () => {
    setLoading(true); setError(''); setBriefing(null);
    try {
      const wcArg = wcEnabled && wc.name ? wc : null;
      const fighters = getFighters();
      const r = await call(getBriefingPrompt(tone, battleType, fighters, finalArena, weather, objective, wcArg), [{ role: 'user', content: 'Generate the pre-battle analysis card now.' }]);
      setBriefing(r); setScreen('briefing');
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const startBattle = async () => {
    audioRef.current?.stop();
    if (battleMusic === 'arena') {
      const aud = startBattleAudio(finalArena); audioRef.current = aud;
      if (!audioOn && aud) aud.setVol(0);
    } else if (battleMusic !== 'none') {
      try { const ctx = getAudio(); const builder = trackBuilders[battleMusic]; if (builder) { const cleanup = builder(ctx); audioRef.current = { stop: cleanup, setVol: () => {} }; } } catch {}
    }
    setScreen('story'); setLoading(true); setError('');
    setBeats([]); setCurrentBeat(null); setResolution(null); setBeatCount(0); setMessages([]);
    const fighters = getFighters();
    const wcArg = wcEnabled && wc.name ? wc : null;
    const wcLine = wcArg ? `\nWILD CARD FACTION: ${wcArg.name} , secret objective: ${wcArg.objective || 'undisclosed'}` : '';
    const typeDesc = { '1v1': '1v1 DUEL', 'team': `TEAM BATTLE (${teamSize} per side)`, 'ffa': `FREE FOR ALL (${fighters.length} fighters)`, 'tournament': `TOURNAMENT (${fighters.length} fighters, bracket elimination)` }[battleType] || battleType.toUpperCase();
    const fighterBlock = battleType === '1v1' || battleType === 'team' ? `SIDE A: ${fighters[0]}\nSIDE B: ${fighters[1]}` : `FIGHTERS:\n${fighters.map((f, i) => `${i + 1}. ${f}`).join('\n')}`;
    const hasTurns = playerA.trim() && playerB.trim();
    const turnLine = hasTurns ? `\nTURN SYSTEM: Two players control the sides. Player "${playerA}" controls Side A. Player "${playerB}" controls Side B. Alternate turns each beat. On each beat, include a "turnLabel" field showing whose turn it is: "${playerA.toUpperCase()}'S TURN" or "${playerB.toUpperCase()}'S TURN". The 4 choices should be actions for THAT player's fighter(s) specifically. Start with Side A.` : '';
    const readLvl = battleReadingLevel === 'ages5-7' ? '\nREADING LEVEL: Ages 5-7. Short simple sentences. Sound words. Concrete language.' : battleReadingLevel === 'ages8-10' ? '\nREADING LEVEL: Ages 8-10. Mixed sentences, richer vocabulary, emotional complexity.' : battleReadingLevel === 'ages11+' ? '\nREADING LEVEL: Ages 11+. Full vocabulary, layered prose, moral weight.' : battleReadingLevel === 'adult' ? '\nREADING LEVEL: Adult. Unrestricted vocabulary and complexity.' : '';
    const lengthLine = `\nBATTLE LENGTH: ${blObj.label} (${blObj.min}-${blObj.max} beats). Pace the battle accordingly. ${battleLength === 'scout' ? 'Get to the action fast. Minimal setup.' : battleLength === 'legend' ? 'Take your time. Build tension across many exchanges. Develop the fighters through combat.' : 'Balance setup with action.'}`;
    const ndObj = NARRATIVE_DENSITY.find(n => n.id === narrativeDensity) || NARRATIVE_DENSITY[1];
    const densityLine = `\nNARRATIVE DENSITY: ${ndObj.label}. Each beat's narrative section must be ${ndObj.words} words. ${ndObj.desc}`;
    const msg = `START THE BATTLE.\nBATTLE TYPE: ${typeDesc}\n${fighterBlock}${wcLine}\nARENA: ${finalArena}\nCONDITIONS: ${weather}\nWIN CONDITION: ${objective}\n${isKids ? `AUDIENCE: kids ${tone === 'kids_young' ? 'ages 6-8' : 'ages 9-12'} , fun and age-appropriate\n` : ''}${turnLine}${readLvl}${lengthLine}${densityLine}\nGenerate beat 1. Establish the arena through sensory detail. Introduce all combatants through positioning and first movement.${wcArg ? ' Hint at Wild Card presence ominously.' : ''} Begin the first exchange. Present 4 choices.`;
    if (hasTurns) setCurrentTurn('A');
    const init = [{ role: 'user', content: msg }];
    try {
      const beat = await call(getBattleToneSystem(tone), init);
      setMessages([...init, { role: 'assistant', content: JSON.stringify(beat) }]);
      setCurrentBeat(beat); setBeatCount(1);
    } catch (e) { setError(e.message); setScreen('briefing'); } finally { setLoading(false); }
  };

  const startCinematic = async () => {
    audioRef.current?.stop();
    const aud = startBattleAudio(finalArena); audioRef.current = aud;
    if (!audioOn && aud) aud.setVol(0);
    setScreen('cinematic'); setLoading(true); setError(''); setCinematicStory(null); setCinematicParas(0); setShowAllCinematic(false);
    const fighters = getFighters();
    const toneNames = { kids_young: 'fun and silly, BOOM CRASH sound words, age 6-8', kids_older: 'cinematic and exciting, real strategy, age 9-12', intense: 'gritty and tactical, high stakes, no gore', brutal: 'forensic, clinical, detached. Terminal report style.' };
    const toneStyle = toneNames[tone] || 'exciting';
    const isMultiFighter = cinematicFormat === 'ffa' || cinematicFormat === 'tournament';
    const isTeamCinematic = cinematicFormat === 'team';
    const allFighters = isMultiFighter ? (cinematicFormat === 'ffa' ? ffaFighters : tourneyFighters).filter(f => f.trim()) : [fighterA, fighterB].filter(f => f.trim());
    const fighterBlock = isMultiFighter
      ? `FIGHTERS (${allFighters.length}-${cinematicFormat === 'tournament' ? 'fighter tournament bracket' : 'way free-for-all'}):\n${allFighters.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
      : isTeamCinematic
        ? `TEAM A (${teamSize} fighters): ${fighterA}\nTEAM B (${teamSize} fighters): ${fighterB}`
        : `SIDE A: ${fighterA}\nSIDE B: ${fighterB}`;
    const multiRules = isMultiFighter
      ? `\n- This is a ${allFighters.length}-fighter ${cinematicFormat === 'tournament' ? 'tournament. Write each round of the bracket. Show each matchup as a mini-battle. Build toward the final.' : 'free-for-all. Every fighter acts independently. Alliances can form and break. Eliminate fighters one by one until one remains.'}\n- Give every fighter at least one moment of brilliance before they fall.`
      : isTeamCinematic
        ? `\n- This is a team battle. Each side has ${teamSize} fighters working together. Show coordination, teamwork, and individual moments. Eliminate fighters from each side until one team prevails.`
        : '';
    const wcArg = wcEnabled && wc.name ? wc : null;
    const wcLine = wcArg ? `\nWILD CARD: ${wcArg.name} with secret objective: ${wcArg.objective || 'undisclosed'}. They intervene at a pivotal moment.` : '';
    const sysPrompt = `You are a master battle storyteller. Write a COMPLETE battle story from start to finish. No choices, no interactivity. Just a cinematic battle narrative meant to be read aloud.\n\nTone: ${toneStyle}\n\nRespond with ONLY valid JSON, no markdown:\n{"title":"string","content":"the full battle story with \\n paragraph breaks","winner":"name of victor","summary":"one sentence outcome"}\n\nRules:\n- Write the FULL battle. Opening, exchanges, turning point, climax, decisive ending.\n- ${tone === 'kids_young' ? '600-800 words. Fun sound effects. Heart wins over power.' : tone === 'kids_older' ? '800-1200 words. Tactical detail. Consequences feel real.' : tone === 'intense' ? '1000-1500 words. Gritty detail. Injuries affect performance. Fear and strategy.' : '1000-1500 words. Forensic observation. No glory. Document the dissolution.'}\n- Use sensory language: sounds, smells, textures, the weight of weapons, the feel of impact.\n- Injuries matter. Fatigue matters. The environment is a weapon.\n- The outcome must feel earned, not random. The winner wins because of something specific they did.\n- End with a clear victor and aftermath.${multiRules}`;
    const msg = `Write the complete battle.\n${fighterBlock}${wcLine}\nARENA: ${finalArena}\nCONDITIONS: ${weather}\nWIN CONDITION: ${objective}`;
    try {
      const raw = await callAI(provider, apiKey, PROVIDERS.find(p => p.id === provider).model, [{ role: 'user', content: msg }], sysPrompt);
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      let parsed;
      try { parsed = JSON.parse(cleaned); } catch {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = { title: 'The Battle', content: cleaned.length > 100 ? cleaned : 'Story generation failed.', winner: '?', summary: '' }; } }
        else { parsed = { title: 'The Battle', content: cleaned.length > 100 ? cleaned : 'Story generation failed.', winner: '?', summary: '' }; }
      }
      setCinematicStory(parsed);
      // Save world seed from cinematic battle
      saveWorldSeed({ world: finalArena, tone: toneStyle, thread: parsed.summary || '', villain: parsed.winner || '', title: parsed.title || 'Battle', date: new Date().toLocaleDateString(), sourceMode: 'battle' });
    } catch (e) { setError(e.message); setScreen('briefing'); } finally { setLoading(false); }
  };

  // Cinematic typewriter
  useEffect(() => { if (!cinematicStory || showAllCinematic) return; const paras = cinematicStory.content.split(/\n+/).filter(Boolean); setCinematicParas(0); let i = 0; const iv = setInterval(() => { i++; if (i >= paras.length) clearInterval(iv); setCinematicParas(i + 1); }, 1200); return () => clearInterval(iv); }, [cinematicStory, showAllCinematic]);

  const handleChoice = async (choice) => {
    if (!currentBeat || loading) return;
    const pb = beats, pc = currentBeat, pm = messages, pn = beatCount;
    const nb = [...pb, { narrative: pc.narrative, phase: pc.phase, choiceMade: choice.text, wasWildcard: choice.id === 4 }];
    setBeats(nb); setCurrentBeat(null); setLoading(true); setError('');
    const hasTurns = playerA.trim() && playerB.trim();
    const nextTurn = currentTurn === 'A' ? 'B' : 'A';
    const nextPlayer = nextTurn === 'A' ? playerA : playerB;
    const nn = pn + 1; setBeatCount(nn); const inRange = nn >= blObj.min; const pastMax = nn >= blObj.max;
    let instr = `Player chose: "${choice.text}" , ${choice.detail}${choice.id === 4 ? ' [WILDCARD CHOSEN]' : ''}\n\nGenerate beat ${nn}.`;
    if (hasTurns && !inRange) instr += ` This is ${nextPlayer}'s turn (Side ${nextTurn}). Set turnLabel to "${nextPlayer.toUpperCase()}'S TURN". Choices should be actions for Side ${nextTurn}'s fighter(s).`;
    if (hasTurns && inRange) instr += ` This is ${nextPlayer}'s turn (Side ${nextTurn}). Set turnLabel to "${nextPlayer.toUpperCase()}'S TURN".`;
    if (pastMax) instr += ' The battle has gone on long enough. Set isComplete to true. Deliver the decisive resolution now.';
    else if (inRange) instr += ' The battle is reaching its natural climax. You may end it here with isComplete true, or continue if the story needs 1-2 more beats.';
    else if (nn === blObj.min - 1) instr += ' CLIMAX BEAT: Build toward the decisive moment.';
    if (hasTurns) setCurrentTurn(nextTurn);
    const nm = [...pm, { role: 'user', content: instr }];
    try {
      const beat = await call(getBattleToneSystem(tone), nm);
      setMessages([...nm, { role: 'assistant', content: JSON.stringify(beat) }]);
      if (beat.isComplete) {
        setBeats([...nb, { narrative: beat.narrative, phase: beat.phase, choiceMade: null }]);
        setResolution(beat); setScreen('resolution');
        completeChallenge("battle", { wcEnabled, tone, battleLength, narrativeDensity, battleType, arena: finalArena, weather, beatCount: nn, usedWildcard: [...nb].some(b => b.wasWildcard) });
        setTimeout(() => audioRef.current?.stop(), 800);
        window.speechSynthesis?.cancel(); setIsSpeaking(false);
      } else { setCurrentBeat(beat); }
    } catch (e) { setError(e.message); setBeats(pb); setCurrentBeat(pc); setMessages(pm); setBeatCount(pn); }
    finally { setLoading(false); }
  };

  const resetBattle = () => {
    audioRef.current?.stop(); audioRef.current = null;
    window.speechSynthesis?.cancel(); setIsSpeaking(false);
    setScreen('tone'); setTone(''); setBattleLength('hero'); setNarrativeDensity('quest'); setBattleType(''); setFighterA(''); setFighterB('');
    setFfaFighters(['', '', '', '']); setTourneyFighters(['', '', '', '', '', '', '', '']);
    setWcEnabled(false); setWc({ name: '', objective: '' }); setArena(''); setCustomArena('');
    setWeather('Clear'); setObjective(''); setBriefing(null); setMessages([]); setBeats([]);
    setCurrentBeat(null); setResolution(null); setBeatCount(0); setError('');
  };

  // ── Battle style helpers ──
  const page = { background: 'linear-gradient(180deg, #0a0a1a 0%, #0f0818 50%, #0a0a1a 100%)', minHeight: '100vh', fontFamily: S, color: '#e8e0f0', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px', paddingTop: 0 };
  const BattleNav = ({ title, backFn }) => (
    <div style={{ width: '100%', maxWidth: 580, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0 12px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={backFn} style={{ background: 'none', border: 'none', color: '#9990a8', fontSize: 22, cursor: 'pointer', padding: 4, fontFamily: S }}>←</button>
        <span style={{ color: '#6a6280', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', fontFamily: M }}>{title || 'Battle Arena'}</span>
      </div>
      <button onClick={() => setMuted(m => !m)} style={{ background: 'none', border: 'none', color: '#9990a8', fontSize: 18, cursor: 'pointer', padding: 4 }}>{muted ? '🔇' : '🔊'}</button>
    </div>
  );
  const crd = (on) => ({ background: on ? `${AC}18` : 'rgba(255,255,255,0.04)', border: `2px solid ${on ? AC : 'rgba(255,255,255,0.1)'}`, borderRadius: '14px', padding: '20px', cursor: 'pointer', transition: 'all 0.2s' });
  const chip = (on, cc) => ({ background: on ? (cc || AC) : 'rgba(255,255,255,0.06)', border: `1px solid ${on ? (cc || AC) : 'rgba(255,255,255,0.15)'}`, borderRadius: '20px', padding: '7px 14px', cursor: 'pointer', fontFamily: M, fontSize: '12px', letterSpacing: '0.5px', color: on ? '#0a0a1a' : '#9990a8', transition: 'all 0.15s' });
  const inp = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', padding: '13px 16px', color: '#e8e0f0', fontSize: '15px', width: '100%', outline: 'none', fontFamily: S, boxSizing: 'border-box' };
  const Ey = ({ c }) => <div style={{ fontFamily: M, fontSize: '12px', letterSpacing: '3px', color: AC, marginBottom: '8px', textTransform: 'uppercase', fontWeight: 700, opacity: 0.7 }}>{c}</div>;
  const H1 = ({ c }) => <h1 style={{ fontSize: '32px', fontWeight: '700', margin: '0 0 8px', letterSpacing: '-0.5px', fontFamily: S, lineHeight: 1.1, color: '#fff' }}>{c}</h1>;
  const Sub = ({ c }) => <p style={{ color: '#8a82a0', fontFamily: M, fontSize: '13px', letterSpacing: '1px', margin: '0 0 28px' }}>{c}</p>;
  const Lbl = ({ c }) => <div style={{ fontFamily: M, fontSize: '12px', letterSpacing: '2px', color: AC, marginBottom: '8px', textTransform: 'uppercase', fontWeight: 700, opacity: 0.8 }}>{c}</div>;
  const PB = ({ on, onClick, sx = {}, children }) => <button onClick={onClick} style={{ background: on ? `linear-gradient(135deg, ${AC} 0%, ${AC}cc 100%)` : 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '12px', padding: '14px 28px', color: on ? '#fff' : '#4a4560', cursor: on ? 'pointer' : 'not-allowed', fontFamily: M, fontSize: '14px', letterSpacing: '2px', fontWeight: '700', transition: 'all 0.2s', boxShadow: on ? `0 4px 20px ${AC}40` : 'none', ...sx }}>{children}</button>;
  const BK = ({ onClick }) => <button onClick={onClick} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px', padding: '13px 20px', color: '#9990a8', cursor: 'pointer', fontFamily: M, fontSize: '13px', letterSpacing: '1px' }}>BACK</button>;
  const Narr = ({ text, dim, onRead }) => { if (!text) return null; return <div style={{ lineHeight: 1.95, fontSize: '16px', color: dim ? '#5a5270' : '#d0c8e0', fontFamily: S, position: 'relative' }}>{!dim && onRead && <button onClick={() => onRead(text)} style={{ float: 'right', background: 'transparent', border: `1px solid rgba(255,255,255,0.12)`, borderRadius: '5px', padding: '3px 8px', color: '#7a7290', cursor: 'pointer', fontFamily: M, fontSize: '11px', marginLeft: '8px' }}>▶</button>}{text.split('\n').map((ln, i) => ln.trim() === '' ? <div key={i} style={{ height: '8px' }} /> : <p key={i} style={{ margin: '0 0 4px' }}>{ln}</p>)}</div>; };
  const PH = { opening: 'OPENING', exchange: 'EXCHANGE', climax: 'CLIMAX', resolution: 'RESOLUTION', premortem: 'PREMORTEM', threshold: 'THRESHOLD', execution: 'EXECUTION', residual: 'RESIDUAL' };

  // ── Forge Modal ──
  const ForgeModal = () => (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,26,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px' }}>
      <div style={{ background: '#12101f', border: `2px solid ${AC}40`, borderRadius: '16px', padding: '28px', maxWidth: '500px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div style={{ fontSize: '22px', fontWeight: '700', fontFamily: S, color: '#fff' }}>Character Forge</div>
          <button onClick={() => setForgeOpen(false)} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', padding: '6px 14px', color: '#9990a8', cursor: 'pointer', fontFamily: M, fontSize: '12px' }}>CLOSE</button>
        </div>
        {!forgeResult ? (
          <>
            <Lbl c="CHOOSE ARCHETYPE" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '18px' }}>
              {ARCHETYPES.map(g => <div key={g.group}><div style={{ fontFamily: M, fontSize: '11px', color: '#6a6280', letterSpacing: '1px', marginBottom: '6px', fontWeight: 600 }}>{g.group.toUpperCase()}</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>{g.options.map(o => <div key={o} onClick={() => setForgeArch(o)} style={chip(forgeArch === o)}>{o}</div>)}</div></div>)}
            </div>
            <Lbl c="OPTIONAL DETAILS" />
            <textarea value={forgeDetails} onChange={e => setForgeDetails(e.target.value)} placeholder="e.g. Ancient warrior, honor-bound" style={{ ...inp, height: '70px', resize: 'none', marginBottom: '16px' }} />
            {forgeError && <div style={{ color: '#f07070', fontFamily: M, fontSize: '13px', marginBottom: '12px', padding: '8px 12px', background: 'rgba(240,70,70,0.1)', borderRadius: '8px' }}>{forgeError}</div>}
            <PB on={!!forgeArch && !forgeLoading} onClick={runForge} sx={{ width: '100%' }}>{forgeLoading ? `FORGING${'.'.repeat(dots)}` : 'FORGE CHARACTER'}</PB>
          </>
        ) : (
          <>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
              <div style={{ fontSize: '22px', fontWeight: '700', fontFamily: S, marginBottom: '4px', color: '#fff' }}>{forgeResult.name}</div>
              <div style={{ fontFamily: M, fontSize: '13px', color: AC, letterSpacing: '1px', marginBottom: '14px' }}>{forgeResult.title}</div>
              {[['APPEARANCE', forgeResult.appearance], ['COMBAT STYLE', forgeResult.combatStyle], ['CENTRAL DOGMA', forgeResult.centralDogma], ['ABILITIES', forgeResult.abilities], ['FLAW', forgeResult.flaw]].map(([lb, val]) => val ? <div key={lb} style={{ marginBottom: '10px' }}><Lbl c={lb} /><div style={{ fontSize: '14px', color: '#b0a8c0', lineHeight: 1.7, fontFamily: S }}>{val}</div></div> : null)}
              {forgeResult.voiceSample && <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '10px', marginTop: '6px', fontSize: '14px', color: '#9990a8', fontStyle: 'italic', fontFamily: S }}>"{forgeResult.voiceSample}"</div>}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setForgeResult(null)} style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', padding: '12px', color: '#9990a8', cursor: 'pointer', fontFamily: M, fontSize: '13px' }}>REFORGE</button>
              <PB on={true} onClick={useForge} sx={{ flex: 2 }}>USE THIS FIGHTER</PB>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // ── BATTLE SCREENS ──
  // TONE
  if (screen === 'tone') return (
    <div style={page}>
      {forgeOpen && <ForgeModal />}
      <BattleNav title="Battle Arena" backFn={onBack} />
      <div style={{ textAlign: 'center', maxWidth: '580px', width: '100%' }}>
        <Ey c="CHOOSE YOUR VOICE" />
        <H1 c="Choose Your Voice" /><Sub c="THE NARRATOR SHAPES EVERYTHING" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '28px' }}>
          {[{ id: 'kids_young', c: '#22c55e', lbl: 'KIDS JUNIOR', sub: 'AGES 6-8', desc: 'Fun and silly. BOOM! CRASH! Simple words. Win through heart and cleverness.' }, { id: 'kids_older', c: '#f59e0b', lbl: 'KIDS', sub: 'AGES 9-12', desc: 'Cinematic action. Real strategy. Vivid consequences. Read-aloud ready.' }, ...(!childMode ? [{ id: 'intense', c: '#4f8ef7', lbl: 'INTENSE', sub: 'AGES 13+', desc: 'High stakes. Gritty damage. Tactics decide everything. TTS-optimized.' }, { id: 'brutal', c: '#e03c3c', lbl: 'BRUTAL', sub: 'ADULT', desc: 'Forensic. Detached. Terminal Report. Psychological dissolution.' }] : [])].map(t => (
            <div key={t.id} onClick={() => setTone(t.id)} style={{ background: tone === t.id ? `${t.c}20` : 'rgba(255,255,255,0.04)', border: `2px solid ${tone === t.id ? t.c : 'rgba(255,255,255,0.1)'}`, borderRadius: '14px', padding: '20px', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'left', boxShadow: tone === t.id ? `0 4px 20px ${t.c}30` : 'none' }}>
              <div style={{ fontFamily: M, fontSize: '16px', fontWeight: '700', color: tone === t.id ? t.c : '#b0a8c0', marginBottom: '4px', letterSpacing: '1px' }}>{t.lbl}</div>
              <div style={{ fontFamily: M, fontSize: '12px', color: tone === t.id ? `${t.c}cc` : '#6a6280', letterSpacing: '1px', marginBottom: '10px' }}>{t.sub}</div>
              <div style={{ fontSize: '14px', color: tone === t.id ? '#d0c8e0' : '#7a7290', lineHeight: 1.65, fontFamily: S }}>{t.desc}</div>
            </div>
          ))}
        </div>
        {tone && <>
          {/* Voice picker */}
          {availableVoices.length > 0 && <div style={{ marginBottom: '16px', textAlign: 'left' }}>
            <Lbl c="NARRATOR VOICE" />
            <select value={selectedVoice?.name || ''} onChange={e => { const v = availableVoices.find(x => x.name === e.target.value); setSelectedVoice(v || null); if (v) { const u = new SpeechSynthesisUtterance('Ready to fight.'); u.voice = v; u.rate = 0.9; window.speechSynthesis?.speak(u); } }} style={{ ...inp, appearance: 'none', cursor: 'pointer' }}>
              <option value="">Default voice</option>
              {availableVoices.map(v => <option key={v.name} value={v.name}>{v.name.replace(/Microsoft |Google |Apple /, '')}</option>)}
            </select>
          </div>}
          {/* Battle music */}
          <div style={{ marginBottom: '16px', textAlign: 'left' }}>
            <Lbl c="BATTLE MUSIC" />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {[{ id: 'arena', l: '🏟️ Arena' }, { id: 'epic', l: '🥁 Epic' }, { id: 'spooky', l: '🌲 Dark' }, { id: 'warm', l: '🌅 Calm' }, { id: 'none', l: '🔇 None' }].map(m => <div key={m.id} onClick={() => setBattleMusic(m.id)} style={chip(battleMusic === m.id)}>{m.l}</div>)}
            </div>
          </div>
          {/* Reading level */}
          <div style={{ marginBottom: '16px', textAlign: 'left' }}>
            <Lbl c="READING LEVEL (OPTIONAL)" />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {[{ id: null, l: 'Auto (from tone)' }, { id: 'ages5-7', l: 'Ages 5-7' }, { id: 'ages8-10', l: 'Ages 8-10' }, { id: 'ages11+', l: 'Ages 11+' }, { id: 'adult', l: 'Adult' }].map(r => <div key={r.id || 'auto'} onClick={() => setBattleReadingLevel(r.id)} style={chip(battleReadingLevel === r.id)}>{r.l}</div>)}
            </div>
          </div>
          {/* Battle length */}
          <div style={{ marginBottom: '16px', textAlign: 'left' }}>
            <Lbl c="BATTLE LENGTH" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {BATTLE_LENGTHS.map(bl => (
                <div key={bl.id} onClick={() => setBattleLength(bl.id)} style={{ background: battleLength === bl.id ? `${AC}18` : 'rgba(255,255,255,0.04)', border: `2px solid ${battleLength === bl.id ? AC : 'rgba(255,255,255,0.1)'}`, borderRadius: '12px', padding: '12px', cursor: 'pointer', transition: 'all 0.2s', boxShadow: battleLength === bl.id ? `0 2px 12px ${AC}30` : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '16px' }}>{bl.icon}</span>
                    <span style={{ fontFamily: M, fontSize: '14px', fontWeight: '700', color: battleLength === bl.id ? AC : '#c0b8d0' }}>{bl.label}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: battleLength === bl.id ? '#d0c8e0' : '#7a7290', fontFamily: S }}>{bl.sub}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Narrative density */}
          <div style={{ marginBottom: '16px', textAlign: 'left' }}>
            <Lbl c="NARRATIVE DENSITY" />
            <div style={{ display: 'flex', gap: '8px' }}>
              {NARRATIVE_DENSITY.map(nd => (
                <div key={nd.id} onClick={() => setNarrativeDensity(nd.id)} style={{ flex: 1, background: narrativeDensity === nd.id ? `${AC}18` : 'rgba(255,255,255,0.04)', border: `2px solid ${narrativeDensity === nd.id ? AC : 'rgba(255,255,255,0.1)'}`, borderRadius: '12px', padding: '10px', cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s', boxShadow: narrativeDensity === nd.id ? `0 2px 12px ${AC}30` : 'none' }}>
                  <span style={{ fontSize: '16px' }}>{nd.icon}</span>
                  <div style={{ fontFamily: M, fontSize: '13px', fontWeight: '700', color: narrativeDensity === nd.id ? AC : '#c0b8d0', marginTop: '4px' }}>{nd.label}</div>
                  <div style={{ fontSize: '10px', color: narrativeDensity === nd.id ? '#d0c8e0' : '#7a7290', fontFamily: S, marginTop: '2px' }}>{nd.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <PB on={!!tone} onClick={() => tone && setScreen('type')} sx={{ padding: '12px 48px' }}>CONTINUE</PB>
          {tone && <PB on={true} onClick={() => {
            const rArena = ALL_ARENAS[Math.floor(Math.random() * ALL_ARENAS.length)];
            const rWeather = WEATHER[Math.floor(Math.random() * WEATHER.length)];
            const rObj = OBJECTIVES[Math.floor(Math.random() * OBJECTIVES.length)];
            setArena(rArena); setWeather(rWeather); setObjective(rObj);
            setBattleType('1v1'); setScreen('fighters');
          }} sx={{ padding: '12px 24px', background: '#c4922a' }}>⚡ QUICK</PB>}
        </div>
      </div>
      <GlobalStyles />
    </div>
  );

  // TYPE
  if (screen === 'type') return (
    <div style={page}>
      <BattleNav title="Battle Format" backFn={() => setScreen('tone')} />
      <div style={{ textAlign: 'center', maxWidth: '560px', width: '100%' }}>
        <Ey c="BATTLE FORMAT" /><H1 c="How do they fight?" /><Sub c="STRUCTURE SHAPES EVERYTHING" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
          {[{ id: '1v1', lbl: '1 vs 1', icon: '⚔️', desc: 'Pure duel. One on one.' }, { id: 'team', lbl: 'Teams', icon: '🛡️', desc: '2-4 fighters per side.' }, { id: 'ffa', lbl: 'Free For All', icon: '💥', desc: '3-8 fighters. Chaos.' }, { id: 'tournament', lbl: 'Tournament', icon: '🏆', desc: '4-8 fighters, bracket.' }, { id: 'cinematic', lbl: 'Cinematic', icon: '🎬', desc: 'No choices. Watch it unfold.' }].map(t => (
            <div key={t.id} onClick={() => setBattleType(t.id)} style={{ ...crd(battleType === t.id), textAlign: 'center', padding: '24px 16px' }}>
              <div style={{ fontSize: '40px', marginBottom: '10px' }}>{t.icon}</div>
              <div style={{ fontFamily: M, fontSize: '16px', fontWeight: '700', color: battleType === t.id ? AC : '#c0b8d0', marginBottom: '6px', letterSpacing: '0.5px' }}>{t.lbl}</div>
              <div style={{ fontSize: '14px', color: battleType === t.id ? '#d0c8e0' : '#7a7290', lineHeight: 1.5, fontFamily: S }}>{t.desc}</div>
            </div>
          ))}
        </div>
        {battleType === 'team' && <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}><Lbl c="FIGHTERS PER SIDE" /><div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>{[2, 3, 4].map(n => <div key={n} onClick={() => setTeamSize(n)} style={{ background: teamSize === n ? `${AC}20` : 'rgba(255,255,255,0.04)', border: `2px solid ${teamSize === n ? AC : 'rgba(255,255,255,0.1)'}`, borderRadius: '10px', padding: '10px 24px', cursor: 'pointer', fontFamily: M, fontSize: '16px', fontWeight: '700', color: teamSize === n ? AC : '#9990a8' }}>{n}</div>)}</div></div>}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}><BK onClick={() => setScreen('tone')} /><PB on={!!battleType} onClick={() => battleType && setScreen('fighters')}>CONTINUE</PB></div>
      </div>
      <GlobalStyles />
    </div>
  );

  // FIGHTERS
  if (screen === 'fighters') {
    const isCinematic = battleType === 'cinematic', is1v1 = battleType === '1v1', isTeam = battleType === 'team', isFFA = battleType === 'ffa', isTourney = battleType === 'tournament';
    // For cinematic, determine layout from cinematicFormat
    const effectiveType = isCinematic ? cinematicFormat : battleType;
    const showDuel = effectiveType === '1v1' || effectiveType === 'team';
    const showSlots = effectiveType === 'ffa' || effectiveType === 'tournament';
    const slots = showSlots ? (effectiveType === 'ffa' ? ffaFighters : tourneyFighters) : null;
    const setSlots = showSlots ? (effectiveType === 'ffa' ? setFfaFighters : setTourneyFighters) : null;
    const minSlots = effectiveType === 'ffa' ? 3 : 4;
    const ready = showDuel ? (fighterA.trim() && fighterB.trim()) : slots && slots.filter(f => f.trim()).length >= minSlots;
    const showWC = !isKids && (effectiveType === '1v1' || effectiveType === 'team');
    return (
      <div style={page}>
        {forgeOpen && <ForgeModal />}
        <BattleNav title="Fighters" backFn={() => setScreen('type')} />
        <div style={{ textAlign: 'center', maxWidth: '540px', width: '100%' }}>
          <Ey c="THE COMBATANTS" /><H1 c="Name Your Fighters" /><Sub c="BE SPECIFIC" />
          {isCinematic && (
            <div style={{ marginBottom: '20px' }}>
              <Lbl c="HOW MANY FIGHT?" />
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '8px' }}>
                {[{ id: '1v1', l: '⚔️ 1 vs 1' }, { id: 'team', l: '🛡️ Teams' }, { id: 'ffa', l: '💥 Multi (3-8)' }, { id: 'tournament', l: '🏆 Tournament' }].map(f => (
                  <button key={f.id} onClick={() => setCinematicFormat(f.id)} style={{ background: cinematicFormat === f.id ? `${AC}20` : 'rgba(255,255,255,0.04)', border: `2px solid ${cinematicFormat === f.id ? AC : 'rgba(255,255,255,0.1)'}`, borderRadius: '10px', padding: '10px 20px', cursor: 'pointer', fontFamily: M, fontSize: '14px', fontWeight: '700', color: cinematicFormat === f.id ? AC : '#9990a8' }}>{f.l}</button>
                ))}
              </div>
            </div>
          )}
          {isCinematic && cinematicFormat === 'team' && (
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
              <Lbl c="FIGHTERS PER SIDE" />
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>{[2, 3, 4].map(n => <div key={n} onClick={() => setTeamSize(n)} style={{ background: teamSize === n ? `${AC}20` : 'rgba(255,255,255,0.04)', border: `2px solid ${teamSize === n ? AC : 'rgba(255,255,255,0.1)'}`, borderRadius: '10px', padding: '10px 24px', cursor: 'pointer', fontFamily: M, fontSize: '16px', fontWeight: '700', color: teamSize === n ? AC : '#9990a8' }}>{n}</div>)}</div>
            </div>
          )}
          {showDuel && (
            <div style={{ textAlign: 'left', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}><Lbl c={isTeam ? `TEAM A (${teamSize})` : 'FIGHTER A'} />{!isKids && !isCinematic && <button onClick={() => openForge(0)} style={{ background: 'transparent', border: `1px solid ${ABorder}`, borderRadius: '4px', padding: '3px 9px', color: AC, cursor: 'pointer', fontFamily: M, fontSize: '12px', letterSpacing: '2px' }}>+ FORGE</button>}</div>
              <input value={fighterA} onChange={e => setFighterA(e.target.value)} placeholder={isTeam ? 'e.g. Thor, Iron Man' : 'e.g. Achilles'} style={inp} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', margin: '14px 0' }}><div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} /><div style={{ fontFamily: M, fontSize: '11px', fontWeight: '700', color: AC, letterSpacing: '3px' }}>VS</div><div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} /></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}><Lbl c={isTeam ? `TEAM B (${teamSize})` : 'FIGHTER B'} />{!isKids && !isCinematic && <button onClick={() => openForge(1)} style={{ background: 'transparent', border: `1px solid ${ABorder}`, borderRadius: '4px', padding: '3px 9px', color: AC, cursor: 'pointer', fontFamily: M, fontSize: '12px', letterSpacing: '2px' }}>+ FORGE</button>}</div>
              <input value={fighterB} onChange={e => setFighterB(e.target.value)} placeholder={isTeam ? 'e.g. Thanos, Ebony Maw' : 'e.g. Hector'} style={inp} />
              {!isCinematic && <div style={{ marginTop: '20px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '16px' }}>
                <Lbl c="WHO CONTROLS EACH SIDE?" />
                <p style={{ color: '#7a7290', fontSize: '12px', margin: '0 0 12px', fontFamily: S }}>Leave blank for AI-narrated (no turns). Enter names to take turns choosing for your fighter.</p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1 }}><div style={{ color: AC, fontSize: '11px', fontWeight: '700', marginBottom: '4px', fontFamily: M }}>SIDE A</div><input value={playerA} onChange={e => setPlayerA(e.target.value)} placeholder="e.g. Dad" style={{ ...inp, padding: '8px 12px', fontSize: '14px' }} /></div>
                  <div style={{ flex: 1 }}><div style={{ color: AC, fontSize: '11px', fontWeight: '700', marginBottom: '4px', fontFamily: M }}>SIDE B</div><input value={playerB} onChange={e => setPlayerB(e.target.value)} placeholder="e.g. Nathaniel" style={{ ...inp, padding: '8px 12px', fontSize: '14px' }} /></div>
                </div>
              </div>}
            </div>
          )}
          {showSlots && (
            <div style={{ textAlign: 'left', marginBottom: '16px' }}>
              {slots.map((f, i) => <div key={i} style={{ marginBottom: '8px', display: 'flex', gap: '7px', alignItems: 'center' }}><div style={{ fontFamily: M, fontSize: '13px', color: f.trim() ? AC : '#252118', width: '18px', flexShrink: 0 }}>{i + 1}.</div><input value={f} onChange={e => { const n = [...slots]; n[i] = e.target.value; setSlots(n); }} placeholder={`Fighter ${i + 1}${i < minSlots ? ' (required)' : ''}`} style={{ ...inp, borderColor: f.trim() ? ABorder : 'rgba(255,255,255,0.12)' }} /></div>)}
            </div>
          )}
          {showWC && (
            <div style={{ border: `1px solid ${wcEnabled ? WCBorder : '#181410'}`, borderRadius: '8px', padding: '14px', marginBottom: '18px', textAlign: 'left', background: wcEnabled ? WCDim : 'transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: wcEnabled ? '12px' : '0' }}>
                <div><div style={{ fontFamily: M, fontSize: '8px', fontWeight: '700', color: wcEnabled ? WCC : '#3d3830', letterSpacing: '2px' }}>WILD CARD</div></div>
                <div onClick={() => setWcEnabled(v => !v)} style={{ width: '34px', height: '18px', background: wcEnabled ? WCC : '#1c1814', borderRadius: '10px', cursor: 'pointer', position: 'relative' }}><div style={{ width: '12px', height: '12px', background: '#ddd6c8', borderRadius: '50%', position: 'absolute', top: '3px', left: wcEnabled ? '19px' : '3px', transition: 'left 0.2s' }} /></div>
              </div>
              {wcEnabled && <><div style={{ marginBottom: '8px' }}><Lbl c="FACTION NAME" /><input value={wc.name} onChange={e => setWc(w => ({ ...w, name: e.target.value }))} placeholder="e.g. The Shadow Conclave" style={{ ...inp, borderColor: WCBorder }} /></div><div><Lbl c="SECRET OBJECTIVE" /><input value={wc.objective} onChange={e => setWc(w => ({ ...w, objective: e.target.value }))} placeholder="e.g. Destroy the artifact" style={{ ...inp, borderColor: WCBorder }} /></div></>}
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}><BK onClick={() => setScreen('type')} /><PB on={!!ready} onClick={() => ready && setScreen('arena')}>CONTINUE</PB></div>
        </div>
        <GlobalStyles />
      </div>
    );
  }

  // ARENA
  if (screen === 'arena') {
    const arenaOk = arena && !(arena === 'custom' && !customArena.trim());
    return (
      <div style={page}>
        <BattleNav title="Arena" backFn={() => setScreen('fighters')} />
        <div style={{ textAlign: 'center', maxWidth: '520px', width: '100%' }}>
          <Ey c="THE BATTLEFIELD" /><H1 c="Choose Your Arena" /><Sub c="THE ENVIRONMENT IS A COMBATANT" />
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <select value={arena === 'custom' ? 'custom' : arena} onChange={e => setArena(e.target.value)} style={{ ...inp, appearance: 'none', paddingRight: '36px', cursor: 'pointer' }}><option value="">Select arena...</option>{ALL_ARENAS.map(a => <option key={a} value={a}>{a}</option>)}<option value="custom">+ Custom Arena...</option></select>
              <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8a82a0', pointerEvents: 'none', fontSize: '11px' }}>▼</div>
            </div>
            <button onClick={randomArena} style={{ background: ADim, border: `1px solid ${ABorder}`, borderRadius: '6px', padding: '10px 14px', color: AC, cursor: 'pointer', fontFamily: M, fontSize: '8px', flexShrink: 0 }}>🎲 RANDOM</button>
          </div>
          {arena && arena !== 'custom' && <div style={{ background: ADim, border: `1px solid ${ABorder}`, borderRadius: '6px', padding: '10px 14px', marginBottom: '12px', textAlign: 'left' }}><div style={{ fontFamily: M, fontSize: '12px', color: AC, letterSpacing: '3px', marginBottom: '3px' }}>SELECTED</div><div style={{ fontSize: '15px', color: '#ddd6c8', fontFamily: S }}>{arena}</div></div>}
          {arena === 'custom' && <input value={customArena} onChange={e => setCustomArena(e.target.value)} placeholder="Describe your custom arena..." style={{ ...inp, marginBottom: '12px' }} />}
          <div style={{ marginBottom: '22px', textAlign: 'left' }}><Lbl c="CONDITIONS" /><div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>{WEATHER.map(w => <div key={w} onClick={() => setWeather(w)} style={chip(weather === w)}>{w}</div>)}</div></div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}><BK onClick={() => setScreen('fighters')} /><PB on={arenaOk} onClick={() => arenaOk && setScreen('objective')}>CONTINUE</PB></div>
        </div>
        <GlobalStyles />
      </div>
    );
  }

  // OBJECTIVE
  if (screen === 'objective') {
    return (
      <div style={page}>
        <BattleNav title="Objective" backFn={() => setScreen('arena')} />
        <div style={{ textAlign: 'center', maxWidth: '460px', width: '100%' }}>
          <Ey c="WIN CONDITION" /><H1 c="What decides this?" /><Sub c="THE OBJECTIVE DEFINES WHAT VICTORY COSTS" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '20px' }}>
            {OBJECTIVES.map(o => <div key={o} onClick={() => setObjective(o)} style={{ background: objective === o ? `${AC}20` : 'rgba(255,255,255,0.04)', border: `2px solid ${objective === o ? AC : 'rgba(255,255,255,0.1)'}`, borderRadius: '12px', padding: '16px 12px', cursor: 'pointer', textAlign: 'center', fontFamily: M, fontSize: '13px', letterSpacing: '0.5px', color: objective === o ? AC : '#9990a8', fontWeight: '600', transition: 'all 0.2s', boxShadow: objective === o ? `0 2px 12px ${AC}30` : 'none' }}>{o.toUpperCase()}</div>)}
          </div>
          {error && <div style={{ color: '#f07070', fontFamily: M, fontSize: '13px', marginBottom: '10px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}><BK onClick={() => setScreen('arena')} /><PB on={!!objective && !loading} onClick={() => objective && !loading && getBriefingData()} sx={{ padding: '12px 36px' }}>{loading ? `ANALYZING${'.'.repeat(dots)}` : 'ANALYZE + CONTINUE'}</PB></div>
        </div>
        <GlobalStyles />
      </div>
    );
  }

  // BRIEFING
  if (screen === 'briefing') return (
    <div style={page}>
      <BattleNav title="Briefing" backFn={() => setScreen('objective')} />
      <div style={{ textAlign: 'center', maxWidth: '500px', width: '100%' }}>
        <Ey c={tone === 'brutal' ? 'THE PREMORTEM' : isKids ? 'BATTLE CARD' : 'PRE-BATTLE ANALYSIS'} />
        <H1 c={tone === 'brutal' ? 'Initial Conditions' : isKids ? 'Ready to Fight?' : 'Power Analysis'} />
        {briefing && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${ABorder}`, borderRadius: '10px', padding: '22px', marginBottom: '22px', textAlign: 'left' }}>
            {tone === 'brutal' ? (
              [['ALPHA DOGMA', briefing.alphaDogma], ['BETA DOGMA', briefing.betaDogma], briefing.wildcardVector ? ['WILD CARD VECTOR', briefing.wildcardVector] : null, ['MISMATCH DOCTRINE', briefing.mismatch], ['ARENA LAW', briefing.arenaLaw]].filter(Boolean).map(([lb, val]) => val ? <div key={lb} style={{ marginBottom: '14px' }}><Lbl c={lb} /><div style={{ fontSize: '14px', color: '#7a7268', lineHeight: 1.8, fontFamily: S }}>{val}</div></div> : null)
            ) : (
              [['POWER CONTRAST', briefing.powerContrast], briefing.wildcardFactor ? ['WILD CARD FACTOR', briefing.wildcardFactor] : null, ['ARENA FACTOR', briefing.arenaFactor], ['FIGHT FORECAST', briefing.fightForecast]].filter(Boolean).map(([lb, val]) => val ? <div key={lb} style={{ marginBottom: '14px' }}><Lbl c={lb} /><div style={{ fontSize: '14px', color: '#7a7268', lineHeight: 1.8, fontFamily: S }}>{val}</div></div> : null)
            )}
          </div>
        )}
        {error && <div style={{ color: '#f07070', fontFamily: M, fontSize: '13px', marginBottom: '10px' }}>{error}</div>}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}><BK onClick={() => setScreen('objective')} /><PB on={!loading} onClick={battleType === 'cinematic' ? startCinematic : startBattle} sx={{ padding: '12px 48px', fontSize: '10px', letterSpacing: '4px' }}>{battleType === 'cinematic' ? 'WATCH' : 'BEGIN'}</PB></div>
      </div>
      <GlobalStyles />
    </div>
  );

  // STORY + RESOLUTION
  // CINEMATIC SCREEN
  if (screen === 'cinematic') {
    const paras = cinematicStory ? cinematicStory.content.split(/\n+/).filter(Boolean) : [];
    const allRevealed = showAllCinematic || cinematicParas >= paras.length;
    return (
      <div style={{ background: 'linear-gradient(180deg, #0a0a1a 0%, #0f0818 100%)', minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: S, color: '#e0d8f0' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: M, fontSize: '11px', color: AC, letterSpacing: '1px', fontWeight: 700 }}>🎬 CINEMATIC</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {cinematicStory && !allRevealed && <button onClick={() => setShowAllCinematic(true)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', padding: '4px 10px', color: '#9990a8', cursor: 'pointer', fontSize: '11px', fontFamily: M }}>SKIP</button>}
            {allRevealed && <button onClick={() => { const text = paras.join(' '); if (isSpeaking) stopSpeaking(); else readAloud(text); }} style={{ background: isSpeaking ? `${AC}20` : 'rgba(255,255,255,0.06)', border: `1px solid ${isSpeaking ? AC : 'rgba(255,255,255,0.12)'}`, borderRadius: '6px', padding: '4px 10px', color: isSpeaking ? AC : '#9990a8', cursor: 'pointer', fontSize: '11px', fontFamily: M }}>{isSpeaking ? '◼ STOP' : '▶ READ'}</button>}
            <button onClick={toggleAudio} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', padding: '4px 10px', color: '#9990a8', cursor: 'pointer', fontSize: '11px', fontFamily: M }}>{audioOn ? '♪ ON' : '♪ OFF'}</button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 20px' }}>
          <div style={{ maxWidth: '640px', margin: '0 auto' }}>
            {loading && <div style={{ textAlign: 'center', padding: '60px 0' }}><div style={{ width: 38, height: 38, borderRadius: '50%', border: `3px solid rgba(255,255,255,0.1)`, borderTopColor: AC, animation: 'spin 0.9s linear infinite', margin: '0 auto' }} /><p style={{ color: AC, marginTop: 16, fontSize: 15, fontStyle: 'italic', fontFamily: M }}>Generating battle...</p></div>}
            {cinematicStory && <>
              <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                <div style={{ fontSize: '28px', fontWeight: '700', fontFamily: S, color: '#fff', marginBottom: '6px' }}>{cinematicStory.title}</div>
                <div style={{ fontSize: '13px', color: '#7a7290', fontFamily: M }}>{cinematicFormat === 'ffa' || cinematicFormat === 'tournament' ? (cinematicFormat === 'ffa' ? ffaFighters : tourneyFighters).filter(f => f.trim()).join(' vs ') : `${fighterA} vs ${fighterB}`} · {finalArena}</div>
              </div>
              <div style={{ lineHeight: 2, fontSize: '16px', color: '#d0c8e0', fontFamily: S }}>
                {paras.slice(0, showAllCinematic ? paras.length : cinematicParas).map((p, i) => <p key={i} style={{ margin: '0 0 16px', animation: !showAllCinematic && i === cinematicParas - 1 ? 'fadeUp 0.5s ease-out' : 'none' }}>{p}</p>)}
              </div>
              {allRevealed && <>
                <div style={{ textAlign: 'center', margin: '32px 0', opacity: 0.4 }}>
                  <div style={{ width: '60px', height: '1px', background: AC, margin: '0 auto' }} />
                </div>
                {cinematicStory.winner && <div style={{ textAlign: 'center', marginBottom: '20px' }}><div style={{ fontFamily: M, fontSize: '12px', color: AC, letterSpacing: '2px', marginBottom: '6px' }}>VICTOR</div><div style={{ fontSize: '24px', fontWeight: '700', fontFamily: S, color: '#fff' }}>{cinematicStory.winner}</div>{cinematicStory.summary && <p style={{ color: '#7a7290', fontSize: '14px', marginTop: '8px', fontFamily: S }}>{cinematicStory.summary}</p>}</div>}
                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '16px', marginBottom: '16px', textAlign: 'center' }}>
                  <div style={{ fontFamily: M, fontSize: '11px', color: '#7a7290', letterSpacing: '1px', marginBottom: '8px' }}>RATE THIS BATTLE</div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>{[1,2,3,4,5].map(s => <span key={s} onClick={() => setSessionRating(s)} style={{ fontSize: '24px', cursor: 'pointer', opacity: s <= sessionRating ? 1 : 0.25 }}>⭐</span>)}</div>
                </div>
                <button onClick={() => { const text = `${cinematicStory.title}\n${fighterA || ''} vs ${fighterB || ''}\nArena: ${finalArena}\n\n${cinematicStory.content}\n\nVictor: ${cinematicStory.winner || '?'}\n${cinematicStory.summary || ''}`; navigator.clipboard?.writeText(text); }} style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '12px', color: '#9990a8', cursor: 'pointer', fontFamily: M, fontSize: '13px', marginBottom: '12px' }}>📋 Copy Battle to Clipboard</button>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '8px' }}>
                  <BK onClick={resetBattle} />
                  <PB on={true} onClick={() => { setCinematicStory(null); setSessionRating(0); startCinematic(); }}>REMATCH</PB>
                </div>
              </>}
            </>}
            {error && <div style={{ color: '#f07070', fontFamily: M, fontSize: '13px', textAlign: 'center', marginTop: '20px' }}>{error}</div>}
          </div>
        </div>
        <GlobalStyles />
      </div>
    );
  }

  if (screen === 'story' || screen === 'resolution') {
    const pct = Math.min((beatCount / blObj.max) * 100, 100);
    const curPhase = currentBeat?.phase || beats[beats.length - 1]?.phase || '';
    const latestNarr = currentBeat?.narrative || null;
    return (
      <div style={{ background: 'linear-gradient(180deg, #0a0a1a 0%, #0f0818 100%)', minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: S, color: '#e0d8f0' }}>
        <div style={{ padding: '9px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: '10px' }}>
          <div style={{ minWidth: 0 }}><div style={{ fontFamily: M, fontSize: '10px', letterSpacing: '2px', color: '#4a4560', marginBottom: '2px' }}>STORYVERSE BATTLE</div><div style={{ fontSize: '11px', color: '#9990a8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ fontFamily: M, fontSize: '11px', color: AC, letterSpacing: '1px', marginRight: '6px' }}>{battleType.toUpperCase()}</span><span style={{ color: '#8a82a0' }}>{finalArena}</span></div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {latestNarr && !resolution && <button onClick={isSpeaking ? stopSpeaking : () => readAloud(latestNarr)} style={{ background: isSpeaking ? `${AC}20` : 'transparent', border: `1px solid ${isSpeaking ? AC : '#1c1814'}`, borderRadius: '5px', padding: '4px 9px', color: isSpeaking ? AC : '#3d3830', cursor: 'pointer', fontFamily: M, fontSize: '12px' }}>{isSpeaking ? '◼ STOP' : '▶ READ'}</button>}
            <button onClick={toggleAudio} style={{ background: 'transparent', border: `1px solid ${audioOn ? '#2a2520' : '#181410'}`, borderRadius: '5px', padding: '4px 9px', color: audioOn ? '#5a5248' : '#2a2520', cursor: 'pointer', fontFamily: M, fontSize: '12px' }}>{audioOn ? '♪ ON' : '♪ OFF'}</button>
            {curPhase && <span style={{ fontFamily: M, fontSize: '10px', letterSpacing: '3px', color: AC, opacity: 0.6 }}>{PH[curPhase] || curPhase.toUpperCase()}</span>}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><div style={{ width: '40px', height: '2px', background: '#1a1714', borderRadius: '2px', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: AC, transition: 'width 0.6s' }} /></div><span style={{ fontFamily: M, fontSize: '10px', color: '#4a4560' }}>{beatCount}/{blObj.max}</span></div>
            <button onClick={resetBattle} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '5px', padding: '3px 9px', color: '#5a5270', cursor: 'pointer', fontFamily: M, fontSize: '12px', letterSpacing: '2px' }}>NEW</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '26px 18px' }}>
          <div style={{ maxWidth: '640px', margin: '0 auto' }}>
            {beats.map((beat, i) => <div key={i} style={{ marginBottom: '24px' }}><Narr text={beat.narrative} dim={true} onRead={readAloud} />{beat.choiceMade && <div style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', background: beat.wasWildcard ? `${WCC}10` : `${AC}10`, border: `1px solid ${beat.wasWildcard ? WCC : AC}22`, borderRadius: '4px' }}><span style={{ fontFamily: M, fontSize: '10px', letterSpacing: '2px', color: beat.wasWildcard ? WCC : '#1c1814' }}>{beat.wasWildcard ? '⚡ WILDCARD' : 'CHOSE'}</span><span style={{ fontFamily: M, fontSize: '12px', color: beat.wasWildcard ? WCC : AC }}>{beat.choiceMade}</span></div>}{i < beats.length - 1 && <div style={{ height: '1px', background: '#0f0e0c', margin: '20px 0 0' }} />}</div>)}
            {currentBeat && !resolution && <Narr text={currentBeat.narrative} dim={false} onRead={readAloud} />}
            {loading && <div style={{ padding: '32px 0' }}><div style={{ fontFamily: M, fontSize: '10px', letterSpacing: '2px', color: '#4a4560', marginBottom: '8px' }}>GENERATING</div><div style={{ display: 'flex', gap: '5px' }}>{[1, 2, 3].map(d => <div key={d} style={{ width: '4px', height: '4px', borderRadius: '50%', background: AC, opacity: dots >= d ? 0.85 : 0.12 }} />)}</div></div>}
            {error && <div style={{ padding: '10px 13px', background: '#120808', border: '1px solid #2c1010', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}><span style={{ fontSize: '10px', color: '#d07070', fontFamily: M }}>{error}</span><button onClick={() => setError('')} style={{ background: 'transparent', border: '1px solid #2c1010', borderRadius: '4px', padding: '3px 8px', color: '#b05050', cursor: 'pointer', fontSize: '12px', fontFamily: M }}>DISMISS</button></div>}
            {resolution && (
              <div style={{ marginTop: '28px' }}>
                <div style={{ height: '1px', background: `${AC}40`, marginBottom: '28px' }} />
                <div style={{ padding: '24px', background: 'rgba(255,255,255,0.05)', borderRadius: '14px', border: `2px solid ${AC}40` }}>
                  {tone === 'brutal' ? (
                    <><div style={{ fontFamily: M, fontSize: '11px', letterSpacing: '2px', color: AC, marginBottom: '18px' }}>TERMINAL REPORT</div><div style={{ marginBottom: '18px' }}><Lbl c="VICTOR" /><div style={{ fontSize: '26px', fontWeight: '700', fontFamily: S }}>{resolution.winner}</div></div>{resolution.definingMoment && <div style={{ marginBottom: '14px' }}><Lbl c="THE DEFINING MOMENT" /><div style={{ fontSize: '14px', color: '#6a6258', lineHeight: 1.85, fontStyle: 'italic', fontFamily: S }}>{resolution.definingMoment}</div></div>}{resolution.indifferentLaw && <div style={{ marginBottom: '14px' }}><Lbl c="THE INDIFFERENT LAW" /><div style={{ fontSize: '14px', color: '#6a6258', lineHeight: 1.85, fontFamily: S }}>{resolution.indifferentLaw}</div></div>}{resolution.scaredInstrument && <div style={{ marginBottom: '14px', background: '#0a0806', borderRadius: '7px', padding: '12px', border: '1px solid rgba(255,255,255,0.1)' }}><Lbl c="THE SCARRED INSTRUMENT" /><div style={{ fontFamily: M, fontSize: '9px', color: AC, letterSpacing: '1px', marginBottom: '5px' }}>{resolution.scaredInstrument.name}</div><div style={{ fontSize: '13px', color: '#9990a8', lineHeight: 1.8, fontFamily: S, fontStyle: 'italic' }}>{resolution.scaredInstrument.sacrifice}</div></div>}{resolution.hollowLine && <div style={{ borderTop: '1px solid #181410', paddingTop: '14px' }}><div style={{ fontSize: '16px', color: '#8a82a0', fontStyle: 'italic', lineHeight: 1.85, fontFamily: S }}>"{resolution.hollowLine}"</div></div>}</>
                  ) : (
                    <><div style={{ fontFamily: M, fontSize: '11px', letterSpacing: '2px', color: AC, marginBottom: '18px' }}>{isKids ? 'BATTLE OVER!' : 'BATTLE COMPLETE'}</div><div style={{ marginBottom: '18px' }}><Lbl c="WINNER" /><div style={{ fontSize: '26px', fontWeight: '700', fontFamily: S }}>{resolution.winner}</div></div>{resolution.winReason && <div style={{ fontSize: '14px', color: '#7a7268', lineHeight: 1.85, marginBottom: '14px', fontFamily: S }}>{resolution.winReason}</div>}{resolution.mvp && <div style={{ background: '#0a0806', borderRadius: '7px', padding: '12px', border: '1px solid rgba(255,255,255,0.1)', marginBottom: '14px' }}><Lbl c="MVP" /><div style={{ fontFamily: M, fontSize: '9px', color: AC, letterSpacing: '1px', marginBottom: '4px' }}>{resolution.mvp.name}</div><div style={{ fontSize: '13px', color: '#9990a8', lineHeight: 1.8, fontFamily: S }}>{resolution.mvp.keyMoment}</div></div>}{resolution.victoryLine && <div style={{ padding: '11px 15px', background: '#080705', borderRadius: '6px', marginBottom: '14px', fontSize: '15px', color: '#8a8278', fontStyle: 'italic', lineHeight: 1.75, border: '1px solid rgba(255,255,255,0.1)', fontFamily: S }}>"{resolution.victoryLine}"</div>}{resolution.lesson && <><Lbl c={isKids ? 'THE LESSON' : 'WHAT DECIDED IT'} /><div style={{ fontSize: '13px', color: '#8a82a0', lineHeight: 1.85, fontFamily: S }}>{resolution.lesson}</div></>}</>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <button onClick={resetBattle} style={{ flex: 1, background: AC, border: 'none', borderRadius: '6px', padding: '12px', color: '#080705', cursor: 'pointer', fontFamily: M, fontSize: '9px', fontWeight: '700', letterSpacing: '4px' }}>NEW BATTLE</button>
                  <button onClick={onBack} style={{ flex: 1, background: 'transparent', border: `1px solid ${ABorder}`, borderRadius: '6px', padding: '12px', color: AC, cursor: 'pointer', fontFamily: M, fontSize: '9px', letterSpacing: '2px' }}>MAIN MENU</button>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>
        {currentBeat && !loading && !resolution && currentBeat.choices && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', background: 'rgba(10,10,26,0.95)', padding: '12px 18px', flexShrink: 0 }}>
            <div style={{ maxWidth: '640px', margin: '0 auto' }}>
              {(() => { const hasTurns = playerA.trim() && playerB.trim(); const turnPlayer = currentTurn === 'A' ? playerA : playerB; const turnFighter = currentTurn === 'A' ? fighterA : fighterB; const turnLabel = currentBeat?.turnLabel; return hasTurns ? (<div style={{ marginBottom: '10px' }}><div style={{ fontFamily: M, fontSize: '14px', fontWeight: '700', letterSpacing: '1px', color: currentTurn === 'A' ? '#22c55e' : '#f59e0b', marginBottom: '2px' }}>{turnLabel || `${turnPlayer.toUpperCase()}'S TURN`}</div><div style={{ fontFamily: S, fontSize: '12px', color: '#7a7290' }}>Choose for {turnFighter || `Side ${currentTurn}`}</div></div>) : (<div style={{ fontFamily: M, fontSize: '10px', letterSpacing: '2px', color: '#4a4560', marginBottom: '7px' }}>YOUR MOVE</div>); })()}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {currentBeat.choices.map(ch => {
                  const isWC = ch.id === 4;
                  return <button key={ch.id} onClick={() => handleChoice(ch)} style={{ background: 'rgba(255,255,255,0.04)', border: `2px solid ${isWC ? WCBorder : 'rgba(255,255,255,0.12)'}`, borderRadius: '8px', padding: '11px 14px', color: '#ddd6c8', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '4px', transition: 'all 0.15s' }} onMouseEnter={e => { e.currentTarget.style.borderColor = isWC ? WCC : AC; e.currentTarget.style.background = isWC ? WCDim : ADim; }} onMouseLeave={e => { e.currentTarget.style.borderColor = isWC ? WCBorder : 'rgba(255,255,255,0.12)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}><div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>{isWC && <span style={{ fontSize: '12px' }}>⚡</span>}<span style={{ fontFamily: M, fontSize: '14px', fontWeight: '700', letterSpacing: '0.5px', color: isWC ? WCC : '#e8e0f0' }}>{ch.text.toUpperCase()}</span>{isWC && <span style={{ fontFamily: M, fontSize: '10px', color: WCC, letterSpacing: '2px', opacity: 0.8 }}>WILDCARD</span>}</div><span style={{ fontSize: '13px', color: isWC ? '#b8944a' : '#9990a8', fontFamily: S, lineHeight: 1.5 }}>{ch.detail}</span></button>;
                })}
              </div>
            </div>
          </div>
        )}
        <GlobalStyles />
      </div>
    );
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// ADVENTURE MODE (full self-contained component)
// ═══════════════════════════════════════════════════════════════
function AdventureMode({ provider, apiKey, muted, setMuted, childMode, onBack }) {
  const [phase, setPhase] = useState("setup_player");
  const [players, setPlayers] = useState(null);
  const [playerList, setPlayerList] = useState([]);
  const [characterChoices, setCharacterChoices] = useState({});
  const [playerColors, setPlayerColors] = useState({});
  const [charSetupIdx, setCharSetupIdx] = useState(0);
  const [customPlayerName, setCustomPlayerName] = useState("");
  const [customPlayerAge, setCustomPlayerAge] = useState("");
  const [groupEntries, setGroupEntries] = useState([{ name: "", age: "", _id: 1 }, { name: "", age: "", _id: 2 }]);
  const _nextGroupId = useRef(3);
  const [charType, setCharType] = useState("self");
  const [charCustomName, setCharCustomName] = useState("");
  const [wantsDifferent, setWantsDifferent] = useState(false);
  const [continuityMode, setContinuityMode] = useState(null);
  const [allSessions, setAllSessions] = useState(() => getLS("momah_sessions") || []);
  const [allAchievements, setAllAchievements] = useState(() => getLS("momah_achievements") || {});
  const [allInventory, setAllInventory] = useState(() => getLS("momah_inventory") || {});
  const [allTraits, setAllTraits] = useState(() => getLS("momah_traits") || {});
  const [allRatings, setAllRatings] = useState(() => getLS("momah_ratings") || {});
  const [sessionRating, setSessionRating] = useState(0);
  const [sessionTags, setSessionTags] = useState([]);
  const TAG_OPTIONS = ["Scary","Funny","Epic","Surprising","Best villain","Emotional","Mind-blowing","Cozy"];
  const [showVillainPOV, setShowVillainPOV] = useState(false);
  const [savedSession, setSavedSession] = useState(() => getLS("momah_active_session"));

  function resumeSaved(s) { setPlayers(s.players); setPlayerList(s.playerList); setCharacterChoices(s.characterChoices); setPlayerColors(s.playerColors || {}); setWorldObj(s.worldObj); setCustomWorld(s.customWorld || ""); setToneObj(s.toneObj); setCustomTone(s.customTone || ""); setDuration(s.duration); setMusicTrack(s.musicTrack || "african"); setAdvDensity(s.advDensity || "quest"); setMessages(s.messages || []); setBeat(s.beat); setBeatCount(s.beatCount || 0); setIsNewBeat(false); setShowAllText(true); setVisibleParas(999); setMusicActive(true); setPhase("story"); setSavedSession(null); }
  const [worlds, setWorlds] = useState(null);
  const [worldsLoading, setWorldsLoading] = useState(false);
  const [worldObj, setWorldObj] = useState(null);
  const [customWorld, setCustomWorld] = useState("");
  const [toneObj, setToneObj] = useState(null);
  const [customTone, setCustomTone] = useState("");
  const [duration, setDuration] = useState(null);
  const [advDensity, setAdvDensity] = useState('quest');
  const [messages, setMessages] = useState([]);
  const [beat, setBeat] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [beatCount, setBeatCount] = useState(0);
  const [isNewBeat, setIsNewBeat] = useState(false);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [retryPayload, setRetryPayload] = useState(null);
  const [visibleParas, setVisibleParas] = useState(0);
  const [showAllText, setShowAllText] = useState(false);
  const typewriterRef = useRef(null);
  const [musicTrack, setMusicTrack] = useState("african");
  const [musicActive, setMusicActive] = useState(false);
  const [toast, setToast] = useState(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [dashTaps, setDashTaps] = useState(0);
  const dashTimer = useRef(null);
  function handleDashTap() { setDashTaps(d => d + 1); clearTimeout(dashTimer.current); dashTimer.current = setTimeout(() => setDashTaps(0), 2000); if (dashTaps >= 2) { setShowDashboard(true); setDashTaps(0); } }

  useAmbientMusic(musicActive ? musicTrack : "none", muted);

  useEffect(() => { if (!loading) { setLoadingSeconds(0); return; } const iv = setInterval(() => setLoadingSeconds(s => s + 1), 1000); return () => clearInterval(iv); }, [loading]);
  useEffect(() => { if (!beat || !isNewBeat || showAllText) return; const paras = (beat.narration || "").split(/\n+/).filter(Boolean); setVisibleParas(0); let i = 0; const iv = setInterval(() => { i++; if (i >= paras.length) { clearInterval(iv); setIsNewBeat(false); } setVisibleParas(i + 1); }, 1100); typewriterRef.current = iv; return () => clearInterval(iv); }, [beat, isNewBeat, showAllText]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [beat]);

  const worldText = worldObj === "custom" ? customWorld : (worldObj ? `${worldObj.title}: ${worldObj.desc}` : "");
  const toneText = toneObj === "custom" ? customTone : (toneObj ? toneObj.label : "");
  const hasFamilyContext = playerList.some(p => KNOWN_PLAYERS[p.id] || FAMILY_NAMES.includes(p.id));

  function getPriorSessions() { const ids = playerList.map(p => p.id); return allSessions.filter(s => s.playerList?.some(sp => ids.includes(sp.id))).slice(0, 3); }

  const generateWorlds = useCallback(async () => {
    setWorldsLoading(true);
    try {
      const provObj = PROVIDERS.find(p => p.id === provider);
      const raw = await callAI(provider, apiKey, provObj.model, [{ role: "user", content: WORLD_GEN_PROMPT }], "You generate creative story world options for children. Respond only with a valid JSON array, no markdown.");
      let parsed;
      try { parsed = parseAIJson(raw); } catch {
        const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
        const arrMatch = cleaned.match(/\[[\s\S]*\]/);
        parsed = arrMatch ? JSON.parse(arrMatch[0]) : null;
      }
      if (Array.isArray(parsed) && parsed.length >= 5) setWorlds(parsed.slice(0, 5)); else setWorlds(FALLBACK_WORLDS);
    } catch { setWorlds(FALLBACK_WORLDS); }
    setWorldsLoading(false);
  }, [provider, apiKey]);

  async function sendBeat(userMsg) {
    if (loading) return; setLoading(true); setError(null); setLoadingSeconds(0);
    const newMessages = userMsg ? [...messages, { role: "user", content: userMsg }] : messages;
    const priorSessions = continuityMode === "continue" ? getPriorSessions() : [];
    const sysPrompt = buildSystemPrompt({ playerList, characterChoices, world: worldText, tone: toneText, duration, continuityMode, priorSessions, hasFamilyContext, playerInventory: allInventory, playerTraits: allTraits, narrativeDensity: advDensity });
    const provObj = PROVIDERS.find(p => p.id === provider);
    try {
      const raw = await callAI(provider, apiKey, provObj.model, newMessages.length === 0 ? [{ role: "user", content: "Begin the story." }] : newMessages, sysPrompt);
      let parsed; try { parsed = parseAIJson(raw); } catch (e) { throw new Error("AI returned invalid JSON. Tap retry."); }
      const assistantMsg = { role: "assistant", content: raw };
      const updatedMessages = [...newMessages, ...(newMessages.length === 0 ? [{ role: "user", content: "Begin the story." }] : []), assistantMsg];
      setMessages(updatedMessages); setBeat(parsed); setBeatCount(c => c + 1); setIsNewBeat(true); setShowAllText(false); setVisibleParas(0); SFX.next();
      // Mid-session auto-save
      setLS("momah_active_session", { players, playerList, characterChoices, playerColors, worldObj, customWorld, toneObj, customTone, duration, musicTrack, advDensity, messages: updatedMessages, beat: parsed, beatCount: beatCount + 1 });
      if (parsed.achievement) { setToast(parsed.achievement); SFX.achievement(); }
      // Item found
      if (parsed.itemFound) { setToast({ type: "item", ...parsed.itemFound }); SFX.item(); const inv = { ...allInventory }; playerList.forEach(p => { if (!inv[p.id]) inv[p.id] = []; if (!inv[p.id].find(i => i.name === parsed.itemFound.name)) inv[p.id].push({ ...parsed.itemFound, from: worldText, date: new Date().toLocaleDateString() }); }); setAllInventory(inv); setLS("momah_inventory", inv); }
      // Trait earned
      if (parsed.traitEarned?.player && parsed.traitEarned?.trait) { const { player, trait } = parsed.traitEarned; setToast({ type: "trait", player, trait }); SFX.trait(); const tr = { ...allTraits }; if (!tr[player]) tr[player] = {}; tr[player][trait] = (tr[player][trait] || 0) + 1; setAllTraits(tr); setLS("momah_traits", tr); }
      if (parsed.isEnding) {
        const session = { id: Date.now(), date: new Date().toLocaleDateString(), players, playerList, world: worldText, tone: toneText, recap: parsed.closingRitual?.recap || "", playerData: {} };
        if (parsed.closingRitual) { (parsed.closingRitual.walkAways || []).forEach(w => { if (!session.playerData[w.player]) session.playerData[w.player] = {}; session.playerData[w.player].walkAway = w.text; }); }
        const updatedSessions = [session, ...allSessions].slice(0, 20); setAllSessions(updatedSessions); setLS("momah_sessions", updatedSessions);
        // Save world seed for remix/derivative
        if (parsed.closingRitual) { saveWorldSeed({ world: worldText, tone: toneText, thread: parsed.closingRitual.thread || "", villain: "", title: worldObj?.title || customWorld || worldText, date: new Date().toLocaleDateString(), sourceMode: "adventure" }); }
        localStorage.removeItem("momah_active_session");
        setPhase("closing"); setSessionRating(0); setSessionTags([]);
        completeChallenge("adventure", { duration, advDensity, players, tone: toneObj?.id || toneText, playerCount: playerList.length, customWorld: worldObj === "custom", earnedTrait: !!parsed.traitEarned, foundItem: !!parsed.itemFound, earnedSecret: (parsed.closingRitual?.secretAchievements?.length || 0) > 0, continued: continuityMode === "continue", continuedSaga: false });
      }
    } catch (e) { setError(e.message || "Something went wrong."); setRetryPayload(userMsg); }
    setLoading(false);
  }

  function resetToStart() { localStorage.removeItem("momah_active_session"); setPhase("setup_player"); setPlayers(null); setPlayerList([]); setCharacterChoices({}); setPlayerColors({}); setCharSetupIdx(0); setContinuityMode(null); setWorlds(null); setWorldObj(null); setCustomWorld(""); setToneObj(null); setCustomTone(""); setDuration(null); setAdvDensity("quest"); setMessages([]); setBeat(null); setBeatCount(0); setError(null); setShowConfirmReset(false); setShowExport(false); setShowDashboard(false); setMusicActive(false); }
  function startStory() { SFX.begin(); setMusicActive(true); setPhase("story"); sendBeat(null); }
  function saveRating() { if (sessionRating > 0 && allSessions[0]?.id) { const r = { ...allRatings }; r[allSessions[0].id] = { rating: sessionRating, tags: sessionTags }; setAllRatings(r); setLS("momah_ratings", r); } }
  function continueThisStory() {
    // Chapter 2: same world, same players, same tone, same density. Fresh messages with recap context.
    saveRating();
    const recap = beat?.closingRitual?.recap || "";
    const thread = beat?.closingRitual?.thread || "";
    const villainHint = beat?.closingRitual?.villainPOV || "";
    setMessages([]); setBeat(null); setBeatCount(0); setIsNewBeat(false); setShowAllText(false); setVisibleParas(0);
    setPhase("story"); setMusicActive(true); SFX.begin();
    const chapterPrompt = `CHAPTER 2: Continue the story directly from where we left off.\nPREVIOUSLY: ${recap}\nUNRESOLVED THREAD: ${thread}\n${villainHint ? `VILLAIN'S NEXT MOVE: ${villainHint}` : ''}\nAll players keep their inventory, traits, and reputation. Open with a brief cinematic "time has passed" transition (hours, days, or weeks, your choice). Then launch into a new conflict connected to the unresolved thread. Do NOT repeat the previous story. This is a new chapter.\nBegin now.`;
    sendBeat(chapterPrompt);
  }
  function continueNewSaga() {
    // New story, same players, new world. Go through world/tone/duration setup with continuity mode on.
    saveRating();
    setContinuityMode("continue");
    setMessages([]); setBeat(null); setBeatCount(0);
    setWorldObj(null); setCustomWorld(""); setToneObj(null); setCustomTone(""); setDuration(null); setAdvDensity("quest");
    setPhase("setup_world"); generateWorlds();
  }
  function speak(text) { if (!("speechSynthesis" in window)) return; window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/\n/g, " ")); u.rate = 0.92; u.pitch = 1.05; window.speechSynthesis.speak(u); }
  function stopSpeak() { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); }

  const shell = (title, children, showBack, onBackFn) => (
    <div style={{ minHeight: "100vh", background: C.ink, color: C.cream, fontFamily: "'Playfair Display', Georgia, serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 20px", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, minHeight: 40 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {showBack && <button onClick={() => { SFX.back(); onBackFn?.(); }} style={{ background: "none", border: "none", color: C.creamDim, fontSize: 22, cursor: "pointer", padding: 4 }}>←</button>}
            <span onClick={(phase === "story" || phase === "closing") ? handleDashTap : undefined} style={{ color: C.textDim, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", cursor: (phase === "story" || phase === "closing") ? "pointer" : "default", userSelect: "none" }}>{title || "Adventure"}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {(phase === "story" || phase === "closing") && <div style={{ display: "flex", gap: 4, marginRight: 8 }}>{Array.from({ length: Math.min(beatCount, 12) }).map((_, i) => <div key={i} style={{ width: i === beatCount - 1 ? 8 : 6, height: i === beatCount - 1 ? 8 : 6, borderRadius: "50%", background: C.gold, opacity: i === beatCount - 1 ? 1 : 0.4 }} />)}</div>}
            {phase === "story" && <button onClick={() => setShowConfirmReset(true)} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 8, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>New</button>}
            <button onClick={() => setMuted(m => !m)} style={{ background: "none", border: "none", color: C.creamDim, fontSize: 18, cursor: "pointer", padding: 4 }}>{muted ? "🔇" : "🔊"}</button>
          </div>
        </div>
        {children}
      </div>
      {showConfirmReset && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}><div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, maxWidth: 360, width: "100%", textAlign: "center" }}><p style={{ color: C.cream, fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Abandon this adventure?</p><div style={{ display: "flex", gap: 10 }}><button onClick={() => { resetToStart(); }} style={{ flex: 1, background: C.terra, color: C.cream, border: "none", borderRadius: 10, padding: "12px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>Leave</button><button onClick={() => setShowConfirmReset(false)} style={{ flex: 1, background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 10, padding: "12px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>Keep playing</button></div></div></div>}
      {toast && <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: toast.type === "trait" ? `linear-gradient(135deg, ${TRAIT_ICONS[toast.trait]?.color || C.gold} 0%, ${C.green} 100%)` : toast.type === "item" ? `linear-gradient(135deg, ${C.gold} 0%, ${C.goldDark} 100%)` : `linear-gradient(135deg, ${C.green} 0%, #2a8f48 100%)`, color: C.cream, padding: "12px 24px", borderRadius: 12, zIndex: 200, textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", animation: "fadeUp 0.3s ease-out" }}>
        {toast.type === "item" ? <><p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{toast.icon || "🎒"} Item: {toast.name}</p><p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.9 }}>{toast.description}</p></> : toast.type === "trait" ? <><p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{TRAIT_ICONS[toast.trait]?.icon || "⭐"} {TRAIT_ICONS[toast.trait]?.label || toast.trait} earned!</p><p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.9 }}>{toast.player} grows stronger.</p></> : <><p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>🏆 {toast.name}</p><p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.9 }}>{toast.description}</p></>}
      </div>}
      {showDashboard && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 100, overflow: "auto", padding: 20 }}><div style={{ maxWidth: 500, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}><h2 style={{ color: C.gold, margin: 0 }}>Parent Dashboard</h2><button onClick={() => setShowDashboard(false)} style={{ background: "none", border: "none", color: C.creamDim, fontSize: 24, cursor: "pointer" }}>✕</button></div>
        <h3 style={{ color: C.cream, fontSize: 16, marginBottom: 12 }}>Trait Badges</h3>
        {Object.entries(allTraits).length > 0 ? Object.entries(allTraits).map(([pid, traits]) => <div key={pid} style={{ marginBottom: 16 }}><p style={{ color: C.gold, fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{pid}</p><div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{Object.entries(traits).map(([t, lvl]) => <TraitBadge key={t} traitId={t} level={lvl} size="sm" />)}</div></div>) : <p style={{ color: C.textDim, fontSize: 13 }}>No traits yet.</p>}
        <h3 style={{ color: C.cream, fontSize: 16, marginTop: 20, marginBottom: 12 }}>Inventory</h3>
        {Object.entries(allInventory).length > 0 ? Object.entries(allInventory).map(([pid, items]) => <div key={pid} style={{ marginBottom: 16 }}><p style={{ color: C.gold, fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{pid} ({items.length})</p>{items.map((item, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}><span style={{ fontSize: 16 }}>{item.icon || "📦"}</span><span style={{ color: C.cream, fontSize: 13 }}>{item.name}</span></div>)}</div>) : <p style={{ color: C.textDim, fontSize: 13 }}>No items yet.</p>}
        <h3 style={{ color: C.cream, fontSize: 16, marginTop: 20, marginBottom: 12 }}>Sessions</h3>
        {allSessions.map((s, i) => { const r = allRatings[s.id]; return <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 8 }}><p style={{ color: C.gold, fontWeight: 600, margin: 0, fontSize: 14 }}>{s.world}</p><p style={{ color: C.textDim, fontSize: 12, margin: "2px 0" }}>{s.date}</p>{r && <StarRating value={r.rating} size={14} />}</div>; })}
        {allSessions.length === 0 && <p style={{ color: C.textDim, fontSize: 13 }}>No sessions yet.</p>}
        <button onClick={() => { if (window.confirm("Clear all data?")) { setAllAchievements({}); setAllSessions([]); setAllInventory({}); setAllTraits({}); setAllRatings({}); setLS("momah_achievements", {}); setLS("momah_sessions", []); setLS("momah_inventory", {}); setLS("momah_traits", {}); setLS("momah_ratings", {}); } }} style={{ marginTop: 20, background: "rgba(212,92,26,0.2)", border: `1px solid ${C.terra}`, color: C.terraLight, borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Clear all data</button>
      </div></div>}
      <GlobalStyles />
    </div>
  );

  // SETUP_PLAYER
  if (phase === "setup_player") return shell("Who's Playing?", (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, paddingTop: 20 }}>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 36, marginBottom: 6 }}>📖</div>
        <h2 style={{ color: C.gold, fontSize: 24, margin: "0 0 4px", fontWeight: 800 }}>Who is playing today?</h2>
        <div style={{ width: 60, height: 2, background: `linear-gradient(90deg, transparent, ${C.gold}, transparent)`, margin: "8px auto 0" }} />
      </div>
      {savedSession && (
        <div style={{ background: C.card, border: `1px solid ${C.gold}50`, borderRadius: 14, padding: 16, marginBottom: 4, animation: "shimmer 2s ease-in-out infinite" }}>
          <p style={{ color: C.gold, fontWeight: 700, margin: "0 0 6px", fontSize: 15 }}>📖 Saved adventure found</p>
          <p style={{ color: C.creamDim, fontSize: 13, margin: "0 0 12px" }}>{savedSession.worldObj?.title || savedSession.customWorld || "In progress"} ({savedSession.beatCount || 0} beats)</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => resumeSaved(savedSession)} style={{ flex: 1, background: `linear-gradient(135deg, ${C.green} 0%, #2a8f48 100%)`, color: C.cream, border: "none", borderRadius: 10, padding: "11px", cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}>Resume</button>
            <button onClick={() => { localStorage.removeItem("momah_active_session"); setSavedSession(null); }} style={{ flex: 1, background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 10, padding: "11px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Start fresh</button>
          </div>
        </div>
      )}
      {[{ key: "justina", label: "Justina", sub: "Age 9, 4th grade", color: C.justina, icon: "👧🏾" }, { key: "nathaniel", label: "Nathaniel", sub: "Age 7, 2nd grade", color: C.nathaniel, icon: "👦🏾" }, { key: "both", label: "Both together", sub: "Joint adventure", color: C.gold, icon: "👫🏾" }].map(opt => (
        <button key={opt.key} onClick={() => { SFX.select(); setPlayers(opt.key); let list; if (opt.key === "justina") list = [{ ...KNOWN_PLAYERS.justina, isKnown: true }]; else if (opt.key === "nathaniel") list = [{ ...KNOWN_PLAYERS.nathaniel, isKnown: true }]; else list = [{ ...KNOWN_PLAYERS.justina, isKnown: true }, { ...KNOWN_PLAYERS.nathaniel, isKnown: true }]; setPlayerList(list); setCharacterChoices({}); setCharSetupIdx(0); setPhase("setup_character"); }} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${opt.color}`, borderRadius: 14, padding: "16px 18px", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 14, fontFamily: "inherit", transition: "all 0.2s" }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: `${opt.color}15`, border: `1px solid ${opt.color}30`, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 22 }}>{opt.icon}</span></div>
          <div><p style={{ color: C.cream, fontWeight: 700, margin: 0, fontSize: 16 }}>{opt.label}</p><p style={{ color: C.textDim, margin: "2px 0 0", fontSize: 13 }}>{opt.sub}</p></div>
        </button>
      ))}
      <button onClick={() => { SFX.select(); setPlayers("custom"); setPhase("setup_character"); setCharSetupIdx(0); setPlayerList([]); }} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px dashed ${C.gold}40`, borderRadius: 14, padding: "16px 18px", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 14, fontFamily: "inherit", transition: "all 0.2s" }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: `${C.gold}10`, border: `1px dashed ${C.gold}30`, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 22 }}>✨</span></div>
        <div><p style={{ color: C.cream, fontWeight: 600, margin: 0, fontSize: 16 }}>Someone else</p><p style={{ color: C.textDim, margin: "2px 0 0", fontSize: 13 }}>Enter a name and age</p></div>
      </button>
      <button onClick={() => { SFX.select(); setPlayers("group"); setPhase("setup_group"); }} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px dashed ${C.gold}40`, borderRadius: 14, padding: "16px 18px", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 14, fontFamily: "inherit", transition: "all 0.2s" }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: `${C.gold}10`, border: `1px dashed ${C.gold}30`, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 22 }}>👥</span></div>
        <div><p style={{ color: C.cream, fontWeight: 600, margin: 0, fontSize: 16 }}>A group</p><p style={{ color: C.textDim, margin: "2px 0 0", fontSize: 13 }}>Multiple players</p></div>
      </button>
    </div>
  ), true, onBack);

  // SETUP_GROUP (multi-player entry)
  if (phase === "setup_group") {
    const validCount = groupEntries.filter(g => g.name.trim() && g.age).length;
    return shell("Players", (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, paddingTop: 20 }}>
        <h2 style={{ color: C.gold, fontSize: 22, margin: 0, fontWeight: 700 }}>Who is in the group?</h2>
        {groupEntries.map((g, i) => (
          <div key={g._id} style={{ display: "flex", gap: 8 }}>
            <input value={g.name} onChange={e => { const u = [...groupEntries]; u[i].name = e.target.value; setGroupEntries(u); }} placeholder={`Player ${i + 1} name`} style={{ flex: 2, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", color: C.cream, fontSize: 14, fontFamily: "inherit" }} />
            <input value={g.age} onChange={e => { const u = [...groupEntries]; u[i].age = e.target.value; setGroupEntries(u); }} placeholder="Age" type="number" style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", color: C.cream, fontSize: 14, fontFamily: "inherit" }} />
          </div>
        ))}
        <button onClick={() => setGroupEntries([...groupEntries, { name: "", age: "", _id: _nextGroupId.current++ }])} style={{ background: "none", border: `1px dashed ${C.textDim}`, color: C.creamDim, borderRadius: 10, padding: "10px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>+ Add player</button>
        <PrimaryBtn disabled={validCount < 2} onClick={() => {
          const list = groupEntries.filter(g => g.name.trim() && g.age).map(g => {
            const id = KNOWN_PLAYERS[g.name.trim().toLowerCase()] ? g.name.trim().toLowerCase() : sanitizeId(g.name.trim());
            return { id, name: g.name.trim(), age: parseInt(g.age), isKnown: !!KNOWN_PLAYERS[id] };
          });
          setPlayerList(list); setPlayerColors(assignColors(list));
          list.forEach(p => { setCharacterChoices(prev => ({ ...prev, [p.id]: { type: "self", name: p.name, age: p.age } })); });
          const prior = allSessions.filter(s => s.playerList?.some(sp => list.map(l => l.id).includes(sp.id))).slice(0, 3);
          if (prior.length > 0) setPhase("setup_continuity"); else { setPhase("setup_world"); generateWorlds(); }
        }}>Continue ({validCount} players)</PrimaryBtn>
      </div>
    ), true, () => setPhase("setup_player"));
  }

  // SETUP_CHARACTER
  if (phase === "setup_character") {
    // Custom single player entry
    if (players === "custom" && playerList.length === 0) {
      return shell("Who Are You?", (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, paddingTop: 20 }}>
          <h2 style={{ color: C.gold, fontSize: 22, margin: 0, fontWeight: 700 }}>What is your name?</h2>
          <input value={customPlayerName} onChange={e => setCustomPlayerName(e.target.value)} placeholder="Your name" style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", color: C.cream, fontSize: 15, boxSizing: "border-box", fontFamily: "inherit" }} />
          <input value={customPlayerAge} onChange={e => setCustomPlayerAge(e.target.value)} placeholder="Your age" type="number" style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", color: C.cream, fontSize: 15, boxSizing: "border-box", fontFamily: "inherit" }} />
          <PrimaryBtn disabled={!customPlayerName.trim() || !customPlayerAge} onClick={() => { const id = sanitizeId(customPlayerName.trim()); const list = [{ id, name: customPlayerName.trim(), age: parseInt(customPlayerAge), isKnown: !!KNOWN_PLAYERS[id] }]; setPlayerList(list); setPlayerColors(assignColors(list)); setCharacterChoices({ [id]: { type: "self", name: customPlayerName.trim(), age: parseInt(customPlayerAge) } }); setPhase("setup_world"); generateWorlds(); }}>Continue</PrimaryBtn>
        </div>
      ), true, () => setPhase("setup_player"));
    }
    // Known or multi-player character flow
    const advanceFromChar = () => {
      const next = charSetupIdx + 1;
      if (next < playerList.length) { setCharSetupIdx(next); setWantsDifferent(false); }
      else { const prior = allSessions.filter(s => s.playerList?.some(sp => playerList.map(l => l.id).includes(sp.id))).slice(0, 3); if (prior.length > 0) setPhase("setup_continuity"); else { setPhase("setup_world"); generateWorlds(); } }
    };
    if (charSetupIdx >= 0 && charSetupIdx < playerList.length) {
      const p = playerList[charSetupIdx];
      const isKnown = p.isKnown;
      // Known player: auto-advance confirmation
      if (isKnown && !wantsDifferent) {
        return shell(`${p.name}'s Character`, (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, paddingTop: 20, alignItems: "center" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: `${getPlayerColor(p.id, playerColors)}15`, border: `2px solid ${getPlayerColor(p.id, playerColors)}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>{p.id === "justina" ? "👧🏾" : p.id === "nathaniel" ? "👦🏾" : "🧒"}</div>
            <h2 style={{ color: getPlayerColor(p.id, playerColors), fontSize: 26, margin: 0, fontWeight: 800 }}>{p.name}</h2>
            <p style={{ color: C.creamDim, fontSize: 15, fontStyle: "italic" }}>Playing as themselves.</p>
            <button onClick={() => setWantsDifferent(true)} style={{ background: "none", border: `1px dashed ${C.textDim}`, color: C.creamDim, borderRadius: 12, padding: "10px 18px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Play as someone different?</button>
            <PrimaryBtn onClick={() => { setCharacterChoices(prev => ({ ...prev, [p.id]: { type: "self", name: p.name, age: p.age } })); advanceFromChar(); }}>Continue as {p.name}</PrimaryBtn>
          </div>
        ), true, () => { if (charSetupIdx > 0) { setCharSetupIdx(charSetupIdx - 1); setWantsDifferent(false); } else setPhase("setup_player"); });
      }
      // Full character choice
      const charOpts = [{ t: "self", icon: "🪞", label: `Yourself (${p.name})` }, { t: "known", icon: "👥", label: "Someone you know" }, { t: "invented", icon: "✨", label: "A made-up character" }];
      return shell(`${p.name}'s Character`, (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, paddingTop: 20 }}>
          <h2 style={{ color: getPlayerColor(p.id, playerColors), fontSize: 22, margin: 0, fontWeight: 700 }}>{p.name}, who do you want to be?</h2>
          {charOpts.map(o => (
            <button key={o.t} onClick={() => { setCharType(o.t); if (o.t === "self") setCharCustomName(p.name); else setCharCustomName(""); }} style={{ background: charType === o.t ? C.green : C.card, border: `1px solid ${charType === o.t ? C.green : C.border}`, color: C.cream, borderRadius: 14, padding: "14px 18px", cursor: "pointer", textAlign: "left", fontSize: 15, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 12, transition: "all 0.2s" }}>
              <span style={{ fontSize: 22 }}>{o.icon}</span><span>{o.label}</span>
            </button>
          ))}
          {charType !== "self" && <input value={charCustomName} onChange={e => setCharCustomName(e.target.value)} placeholder={charType === "known" ? "Who? (name)" : "Character name"} style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", color: C.cream, fontSize: 15, boxSizing: "border-box", fontFamily: "inherit" }} />}
          <PrimaryBtn disabled={charType !== "self" && !charCustomName.trim()} onClick={() => { setCharacterChoices(prev => ({ ...prev, [p.id]: { type: charType, name: charType === "self" ? p.name : charCustomName.trim(), age: p.age } })); setWantsDifferent(false); setCharType("self"); setCharCustomName(""); advanceFromChar(); }}>Continue</PrimaryBtn>
        </div>
      ), true, () => { if (isKnown) { setWantsDifferent(false); } else if (charSetupIdx > 0) { setCharSetupIdx(charSetupIdx - 1); } else setPhase("setup_player"); });
    }
  }

  // SETUP_CONTINUITY
  if (phase === "setup_continuity") {
    const prior = getPriorSessions();
    return shell("Continue?", (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, paddingTop: 20 }}>
        <h2 style={{ color: C.gold, fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>Continue your saga?</h2>
        <p style={{ color: C.creamDim, fontSize: 14, margin: 0 }}>You have {prior.length} previous adventure{prior.length > 1 ? "s" : ""}.</p>
        {prior.map((s, i) => <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}><p style={{ color: C.cream, fontWeight: 600, margin: 0, fontSize: 14 }}>{s.world}</p><p style={{ color: C.textDim, fontSize: 12, margin: "2px 0" }}>{s.date}</p></div>)}
        <PrimaryBtn onClick={() => { setContinuityMode("continue"); setPhase("setup_world"); generateWorlds(); }}>Continue the Saga</PrimaryBtn>
        <button onClick={() => { setContinuityMode("fresh"); setPhase("setup_world"); generateWorlds(); }} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 12, padding: "14px", cursor: "pointer", fontSize: 15, fontFamily: "inherit" }}>Brand New Adventure</button>
      </div>
    ), true, () => setPhase("setup_player"));
  }

  // SETUP_WORLD
  if (phase === "setup_world") {
    const displayWorlds = worlds || FALLBACK_WORLDS;
    return shell("World", (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, paddingTop: 20 }}>
        <h2 style={{ color: C.gold, fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>Where does the story take place?</h2>
        <div style={{ width: 50, height: 2, background: `linear-gradient(90deg, ${C.gold}, transparent)`, marginBottom: 12 }} />
        {worldsLoading && <p style={{ color: C.creamDim, fontSize: 14, animation: "pulse 1.5s infinite" }}>Generating worlds...</p>}
        {displayWorlds.map((w, i) => <button key={i} onClick={() => { SFX.select(); setWorldObj(w); setPhase("setup_tone"); }} style={{ background: `linear-gradient(135deg, ${C.card} 0%, rgba(15,30,17,0.6) 100%)`, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 18px", cursor: "pointer", textAlign: "left", fontFamily: "inherit", transition: "all 0.2s" }}><p style={{ color: C.cream, fontWeight: 700, margin: 0, fontSize: 16 }}>{w.title}</p><p style={{ color: C.creamDim, margin: "4px 0 0", fontSize: 13, lineHeight: 1.5 }}>{w.desc}</p></button>)}
        <button onClick={() => setWorldObj("custom")} style={{ background: "transparent", border: `1px dashed ${C.textDim}`, borderRadius: 12, padding: "14px 18px", cursor: "pointer", color: C.creamDim, fontSize: 14, textAlign: "left", fontFamily: "inherit" }}>✨ Somewhere totally different...</button>
        {worldObj === "custom" && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}><input value={customWorld} onChange={e => setCustomWorld(e.target.value)} placeholder="Describe your world" style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", color: C.cream, fontSize: 14, boxSizing: "border-box", fontFamily: "inherit" }} /><PrimaryBtn disabled={!customWorld.trim()} onClick={() => setPhase("setup_tone")}>Continue</PrimaryBtn></div>}
      </div>
    ), true, () => setPhase("setup_player"));
  }

  // SETUP_TONE
  if (phase === "setup_tone") return shell("Tone", (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, paddingTop: 20 }}>
      <h2 style={{ color: C.gold, fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>What is the tone?</h2>
      <div style={{ width: 50, height: 2, background: `linear-gradient(90deg, ${C.gold}, transparent)`, marginBottom: 12 }} />
      {TONES.map(t => <button key={t.id} onClick={() => { SFX.select(); setToneObj(t); setMusicTrack(getSuggestedTrack(t.label)); setPhase("setup_duration"); }} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 18px", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 14, fontFamily: "inherit", transition: "all 0.2s" }}><span style={{ fontSize: 32 }}>{t.emoji}</span><span style={{ color: C.cream, fontSize: 16, fontWeight: 700 }}>{t.label}</span></button>)}
      <button onClick={() => setToneObj("custom")} style={{ background: "transparent", border: `1px dashed ${C.textDim}`, borderRadius: 12, padding: "14px 18px", cursor: "pointer", color: C.creamDim, fontSize: 14, textAlign: "left", fontFamily: "inherit" }}>🎨 Something else...</button>
      {toneObj === "custom" && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}><input value={customTone} onChange={e => setCustomTone(e.target.value)} placeholder="Describe the tone" style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", color: C.cream, fontSize: 14, boxSizing: "border-box", fontFamily: "inherit" }} /><PrimaryBtn disabled={!customTone.trim()} onClick={() => setPhase("setup_duration")}>Continue</PrimaryBtn></div>}
    </div>
  ), true, () => setPhase("setup_world"));

  // SETUP_DURATION
  if (phase === "setup_duration") return shell("Duration", (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, paddingTop: 20 }}>
      <h2 style={{ color: C.gold, fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>How long do we have?</h2>
      <div style={{ width: 50, height: 2, background: `linear-gradient(90deg, ${C.gold}, transparent)`, marginBottom: 12 }} />
      {DURATIONS.map(d => { const pct = d.id === "20" ? 33 : d.id === "45" ? 66 : 100; return <button key={d.id} onClick={() => { SFX.select(); setDuration(d.id); setAdvDensity(d.id === "20" ? "short" : d.id === "60" ? "cinematic" : "quest"); }} style={{ background: duration === d.id ? C.green : C.card, border: `1px solid ${duration === d.id ? C.green : C.border}`, borderRadius: 14, padding: "16px 18px", cursor: "pointer", textAlign: "left", fontFamily: "inherit", transition: "all 0.2s" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><p style={{ color: C.cream, fontWeight: 700, margin: 0, fontSize: 16 }}>{d.label}</p></div><p style={{ color: duration === d.id ? C.cream : C.textDim, margin: "4px 0 8px", fontSize: 13 }}>{d.sub}</p><div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: duration === d.id ? C.cream : C.gold, borderRadius: 2, transition: "all 0.3s" }} /></div></button>; })}
      {duration && <>
        <p style={{ color: C.gold, fontSize: 12, margin: "12px 0 4px", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700 }}>Narrative Density</p>
        <div style={{ display: "flex", gap: 8 }}>
          {ADVENTURE_DENSITY.map(nd => (
            <button key={nd.id} onClick={() => { SFX.select(); setAdvDensity(nd.id); }} style={{ flex: 1, background: advDensity === nd.id ? "rgba(245,200,66,0.1)" : C.card, border: `1px solid ${advDensity === nd.id ? C.gold : C.border}`, borderRadius: 14, padding: "10px 8px", cursor: "pointer", textAlign: "center", fontFamily: "inherit", transition: "all 0.2s" }}>
              <span style={{ fontSize: 18 }}>{nd.icon}</span>
              <p style={{ color: advDensity === nd.id ? C.gold : C.cream, fontWeight: 700, margin: "4px 0 2px", fontSize: 13 }}>{nd.label}</p>
              <p style={{ color: advDensity === nd.id ? C.creamDim : C.textDim, margin: 0, fontSize: 10, lineHeight: 1.4 }}>{nd.sub}</p>
            </button>
          ))}
        </div>
      </>}
      <p style={{ color: C.creamDim, fontSize: 14, margin: "12px 0 4px" }}>Ambient music:</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
        {[{ id: "none", label: "None", emoji: "🔇" }, { id: "epic", label: "Drums", emoji: "🥁" }, { id: "spooky", label: "Dark", emoji: "🌲" }, { id: "playful", label: "Bells", emoji: "🔔" }, { id: "warm", label: "Calm", emoji: "🌅" }, { id: "african", label: "Igbo", emoji: "🪘" }].map(m => <button key={m.id} onClick={() => { SFX.select(); setMusicTrack(m.id); }} style={{ background: musicTrack === m.id ? "rgba(245,200,66,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${musicTrack === m.id ? C.gold : C.border}`, borderRadius: 10, padding: "10px 4px", cursor: "pointer", textAlign: "center", fontFamily: "inherit" }}><span style={{ fontSize: 24, display: "block" }}>{m.emoji}</span><span style={{ color: musicTrack === m.id ? C.gold : C.creamDim, fontSize: 10, display: "block", marginTop: 4 }}>{m.label}</span></button>)}
      </div>
      <PrimaryBtn disabled={!duration} onClick={startStory} style={{ marginTop: 16 }}>Begin the Adventure</PrimaryBtn>
    </div>
  ), true, () => setPhase("setup_tone"));

  // STORY
  if (phase === "story") {
    const paras = (beat?.narration || "").split(/\n+/).filter(Boolean);
    const allRevealed = showAllText || visibleParas >= paras.length;
    const beatStyle = beat?.beatType && BEAT_STYLES[beat.beatType];
    return shell(worldObj?.title || customWorld?.slice(0, 20) || "Adventure", (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ height: 5, borderRadius: 3, background: `linear-gradient(90deg, ${C.green} 0%, ${C.gold} 33%, ${C.terra} 66%, ${C.green} 100%)`, opacity: 0.85 }} />
        {loading && <div style={{ position: "fixed", inset: 0, background: "rgba(5,14,7,0.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 50 }}><div style={{ width: 38, height: 38, borderRadius: "50%", border: `3px solid rgba(245,200,66,0.15)`, borderTopColor: C.gold, animation: "spin 0.9s linear infinite" }} /><div style={{ color: C.gold, marginTop: 12, fontSize: 15, fontStyle: "italic" }}>{loadingSeconds < 5 ? "The story continues..." : loadingSeconds < 8 ? `${loadingSeconds}s...` : loadingSeconds < 20 ? "Still crafting your world..." : "Taking a while. Check your connection or try a different provider."}</div></div>}
        {beat && <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {beatStyle && <div style={{ background: beatStyle.bg, borderRadius: 12, padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 18 }}>{beatStyle.icon}</span><span style={{ color: "white", fontWeight: 700, fontSize: 14 }}>{beatStyle.label}</span></div>}
          {beat.turnLabel && <p style={{ color: C.gold, fontWeight: 800, fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase", margin: 0 }}>{beat.turnLabel}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{paras.map((p, i) => (showAllText || i < visibleParas) && <p key={i} style={{ color: C.cream, fontSize: 15, lineHeight: 1.7, margin: 0, animation: !showAllText ? "fadeUp 0.4s ease-out" : "none" }}>{p}</p>)}</div>
          {!allRevealed && <button onClick={() => { setShowAllText(true); setVisibleParas(paras.length); clearInterval(typewriterRef.current); }} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12, alignSelf: "flex-start", fontFamily: "inherit" }}>Skip</button>}
          {allRevealed && beat.narration && <div style={{ display: "flex", gap: 8 }}><button onClick={() => speak(beat.narration)} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>🔊 Read aloud</button><button onClick={stopSpeak} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>⏹ Stop</button></div>}
          {allRevealed && beat.choices && beat.choices.length > 0 && !loading && <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {beat.choicePrompt && <p style={{ color: C.creamDim, fontSize: 14, margin: "0 0 4px", fontStyle: "italic" }}>{beat.choicePrompt}</p>}
            {beat.choices.map((c, i) => <ChoiceBtn key={i} label={c.label} text={c.text} color={C.gold} onClick={() => { SFX.click(); stopSpeak(); const who = beat.turnLabel ? beat.turnLabel.replace("'S TURN", "").trim() : (playerList.length === 1 ? playerList[0].name : "Player"); sendBeat(`${who} chose option ${c.label}: "${c.text}". Continue the story.`); }} />)}
          </div>}
          {allRevealed && (!beat.choices || beat.choices.length === 0) && !beat.isEnding && !loading && <div style={{ marginTop: 12 }}><p style={{ color: C.terraLight, fontSize: 13, marginBottom: 8 }}>The story forgot to offer choices.</p><button onClick={() => { SFX.click(); sendBeat("Continue the story and provide at least 2 choices."); }} style={{ background: `linear-gradient(135deg, ${C.green} 0%, #2a8f48 100%)`, color: C.cream, border: "none", borderRadius: 10, padding: "12px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", width: "100%" }}>Continue the Story</button></div>}
        </div>}
        <ErrorBox error={error} onRetry={() => { setError(null); sendBeat(retryPayload); }} />
      </div>
    ), false);
  }

  // CLOSING
  if (phase === "closing") {
    const ritual = beat?.closingRitual;
    return shell("The End", (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20, paddingTop: 20 }}>
        {beat?.narration && <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>{beat.narration.split(/\n+/).filter(Boolean).map((p, i) => <p key={i} style={{ color: C.cream, fontSize: 15, lineHeight: 1.7, margin: i === 0 ? 0 : "12px 0 0" }}>{p}</p>)}</div>}
        {ritual?.walkAways?.length > 0 && <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}><p style={{ color: C.gold, fontWeight: 700, fontSize: 14, margin: "0 0 12px", letterSpacing: 1, textTransform: "uppercase" }}>The Walk Away</p>{ritual.walkAways.map((w, i) => <p key={i} style={{ color: C.cream, fontSize: 15, lineHeight: 1.6, margin: i === 0 ? 0 : "8px 0 0" }}><span style={{ color: C.gold, fontWeight: 700 }}>{w.player}: </span>{w.text}</p>)}</div>}
        {ritual?.secretAchievements?.length > 0 && <div style={{ background: C.card, border: `1px solid ${C.gold}30`, borderRadius: 14, padding: 20 }}><p style={{ color: C.gold, fontWeight: 700, fontSize: 14, margin: "0 0 12px", textTransform: "uppercase" }}>🤫 Secret Achievement</p>{ritual.secretAchievements.map((a, i) => <div key={i} style={{ margin: i === 0 ? 0 : "12px 0 0" }}><p style={{ color: C.gold, fontSize: 16, fontWeight: 700, margin: "0 0 2px" }}>{a.name}</p><p style={{ color: C.creamDim, fontSize: 14, margin: 0 }}>{a.description}</p></div>)}</div>}
        {ritual?.traitsSummary?.length > 0 && <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}><p style={{ color: C.gold, fontWeight: 700, fontSize: 14, margin: "0 0 12px", textTransform: "uppercase" }}>Traits Earned</p><div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>{ritual.traitsSummary.map((t, i) => <div key={i} style={{ textAlign: "center" }}><TraitBadge traitId={t.trait} level={allTraits[t.player]?.[t.trait] || 1} size="sm" /><p style={{ color: C.creamDim, fontSize: 11, margin: "4px 0 0" }}>{t.player}</p></div>)}</div></div>}
        {ritual?.itemsSummary?.length > 0 && <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}><p style={{ color: C.gold, fontWeight: 700, fontSize: 14, margin: "0 0 12px", textTransform: "uppercase" }}>🎒 Items Collected</p>{ritual.itemsSummary.map((item, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><span style={{ fontSize: 18 }}>{item.icon || "📦"}</span><span style={{ color: C.cream, fontSize: 14 }}>{item.name}</span><span style={{ color: C.textDim, fontSize: 11 }}>({item.player})</span></div>)}</div>}
        {ritual?.thread && <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}><p style={{ color: C.textDim, fontSize: 14, fontStyle: "italic", margin: 0, lineHeight: 1.6 }}>{ritual.thread}</p></div>}
        {ritual?.villainPOV && !childMode && <div><button onClick={() => setShowVillainPOV(!showVillainPOV)} style={{ background: "none", border: "1px solid rgba(139,92,246,0.3)", color: "#a78bfa", borderRadius: 12, padding: "12px 18px", cursor: "pointer", width: "100%", fontSize: 14, fontFamily: "inherit", fontWeight: 600 }}>{showVillainPOV ? "Hide villain's perspective" : "🎭 See it from the villain's eyes..."}</button>{showVillainPOV && <div style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)", borderRadius: 14, padding: 20, marginTop: 8 }}><p style={{ color: "#c4b5fd", fontSize: 14, fontStyle: "italic", margin: 0, lineHeight: 1.7 }}>{ritual.villainPOV}</p></div>}</div>}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}><p style={{ color: C.gold, fontWeight: 700, fontSize: 14, margin: "0 0 12px", textTransform: "uppercase" }}>Rate this adventure</p><StarRating value={sessionRating} onChange={setSessionRating} /><div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>{TAG_OPTIONS.map(tag => { const on = sessionTags.includes(tag); return <button key={tag} onClick={() => setSessionTags(on ? sessionTags.filter(t => t !== tag) : [...sessionTags, tag])} style={{ background: on ? `${C.gold}20` : "transparent", border: `1px solid ${on ? C.gold : C.textDim}`, color: on ? C.gold : C.creamDim, borderRadius: 20, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>{tag}</button>; })}</div></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          <button onClick={() => { let text = `STORYVERSE AI ADVENTURE\nPlayers: ${playerList.map(p => p.name).join(", ")}\nWorld: ${worldText}\nTone: ${toneText}\nDate: ${new Date().toLocaleDateString()}\n\n`; messages.forEach(m => { if (m.role === "assistant") { try { const b = JSON.parse(m.content.replace(/\`\`\`json\n?/g,"").replace(/\`\`\`\n?/g,"").trim()); text += (b.narration || "") + "\n\n"; } catch { text += m.content + "\n\n"; } } }); if (ritual) { text += "--- THE END ---\n"; (ritual.walkAways || []).forEach(w => { text += `${w.player}: ${w.text}\n`; }); (ritual.secretAchievements || []).forEach(a => { text += `Achievement (${a.player}): ${a.name} - ${a.description}\n`; }); if (ritual.thread) text += `Thread: ${ritual.thread}\n`; if (ritual.villainPOV) text += `\nVillain: ${ritual.villainPOV}\n`; } navigator.clipboard.writeText(text).catch(() => {}); setToast({ name: "Copied!", description: "Story copied to clipboard" }); }} style={{ background: "none", border: `1px solid ${C.gold}40`, color: C.gold, borderRadius: 12, padding: "14px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>📋 Copy Story to Clipboard</button>
          <button onClick={() => { let text = `STORYVERSE AI ADVENTURE\nPlayers: ${playerList.map(p => p.name).join(", ")}\nWorld: ${worldText}\nTone: ${toneText}\nDate: ${new Date().toLocaleDateString()}\n\n`; messages.forEach(m => { if (m.role === "assistant") { try { const b = parseAIJson(m.content); text += (b.narration || "") + "\n\n"; } catch { text += m.content + "\n\n"; } } }); if (ritual) { text += "--- THE END ---\n"; (ritual.walkAways || []).forEach(w => { text += `${w.player}: ${w.text}\n`; }); (ritual.secretAchievements || []).forEach(a => { text += `Achievement (${a.player}): ${a.name} - ${a.description}\n`; }); if (ritual.thread) text += `Thread: ${ritual.thread}\n`; if (ritual.villainPOV) text += `\nVillain: ${ritual.villainPOV}\n`; } const blob = new Blob([text], { type: "text/plain" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `Storyverse_${new Date().toLocaleDateString().replace(/\//g, "-")}.txt`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }} style={{ background: "none", border: `1px solid ${C.green}40`, color: C.greenLight, borderRadius: 12, padding: "14px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>💾 Download Story</button>
          <PrimaryBtn onClick={continueThisStory} style={{ background: `linear-gradient(135deg, ${C.gold} 0%, ${C.goldDark} 100%)` }}>📖 Continue This Story</PrimaryBtn>
          <button onClick={continueNewSaga} style={{ background: `linear-gradient(135deg, ${C.green} 0%, #2a8f48 100%)`, color: C.cream, border: "none", borderRadius: 12, padding: "14px", cursor: "pointer", fontSize: 15, fontWeight: 600, fontFamily: "inherit" }}>🌍 Continue Your Saga</button>
          <button onClick={() => { saveRating(); resetToStart(); }} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 12, padding: "14px", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>✨ New Adventure</button>
          <button onClick={() => { saveRating(); onBack(); }} style={{ background: "none", border: `1px solid ${C.textDim}30`, color: C.textDim, borderRadius: 12, padding: "12px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Main Menu</button>
        </div>
      </div>
    ), false);
  }

  return shell("", <p style={{ color: C.textDim }}>Loading...</p>);
}

// ═══════════════════════════════════════════════════════════════
// WORLD SEEDS (remix/derivative system)
// ═══════════════════════════════════════════════════════════════
function saveWorldSeed(seed) {
  const seeds = getLS("momah_world_seeds") || [];
  seeds.unshift(seed);
  setLS("momah_world_seeds", seeds.slice(0, 20));
}
function getWorldSeeds() { return getLS("momah_world_seeds") || []; }

// ═══════════════════════════════════════════════════════════════
// STORYTIME MODE
// ═══════════════════════════════════════════════════════════════
const STORYTIME_GENRES = [
  { id: "bedtime", label: "Bedtime Story", emoji: "🌙", desc: "Calm, warm, settling. Perfect for winding down." },
  { id: "fairy", label: "Fairy Tale", emoji: "🧚", desc: "Magic, wonder, and a lesson wrapped in beauty." },
  { id: "adventure", label: "Adventure", emoji: "🗺️", desc: "A journey with a beginning, middle, and end." },
  { id: "funny", label: "Silly Story", emoji: "🤪", desc: "Goofy characters, unexpected twists, lots of laughs." },
  { id: "myth", label: "Myth or Legend", emoji: "🐉", desc: "Ancient heroes, gods, and the stories that shaped worlds." },
  { id: "real", label: "Inspired by Real Life", emoji: "🌍", desc: "Based on real places, people, or events. Made magical." },
  { id: "mystery", label: "Mystery", emoji: "🔍", desc: "Clues, suspects, and a puzzle to solve before the end." },
  { id: "superhero", label: "Superhero", emoji: "🦸", desc: "Powers awaken. A villain rises. Only one hero can stop them." },
  { id: "sports", label: "Sports", emoji: "🏆", desc: "The big game, the underdog, and the moment everything changes." },
  { id: "animals", label: "Animal Kingdom", emoji: "🦁", desc: "The wild has its own rules. Animals with voices and courage." },
  { id: "historical", label: "Historical", emoji: "🏛️", desc: "Real eras, real cultures. History brought to life with story." },
  { id: "custom", label: "Your Own Idea", emoji: "✨", desc: "Describe any genre or theme. The AI builds it for you." },
];

const STORYTIME_LENGTHS = [
  { id: "short", label: "Quick (3 min)", words: "400-500 words" },
  { id: "medium", label: "Standard (7 min)", words: "800-1000 words" },
  { id: "long", label: "Extended (12 min)", words: "1400-1800 words" },
];

function StorytimeMode({ provider, apiKey, muted, setMuted, childMode, onBack }) {
  const [phase, setPhase] = useState("setup");
  const [listenerName, setListenerName] = useState("");
  const [listenerAge, setListenerAge] = useState("");
  const [genre, setGenre] = useState(null);
  const [storyLength, setStoryLength] = useState("medium");
  const [customPrompt, setCustomPrompt] = useState("");
  const [worldSeed, setWorldSeed] = useState(null);
  const [story, setStory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [visibleParas, setVisibleParas] = useState(0);
  const [showAllText, setShowAllText] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [sessionRating, setSessionRating] = useState(0);
  const [sessionTags, setSessionTags] = useState([]);
  const [musicTrack, setMusicTrack] = useState("warm");
  const [musicActive, setMusicActive] = useState(false);
  const [showSeeds, setShowSeeds] = useState(false);
  const [sleepTimer, setSleepTimer] = useState(null); // null | 10 | 20 | 30 (minutes)
  const [soundscape, setSoundscape] = useState("none"); // none | rain | fire | forest | ocean
  const sleepTimerRef = useRef(null);
  const typewriterRef = useRef(null);
  const TAG_OPTIONS = ["Loved it", "Fell asleep to it", "Too short", "Perfect length", "Want a sequel", "Beautiful", "Funny", "Touching"];

  useAmbientMusic(musicActive ? musicTrack : "none", muted);
  useSoundscape(musicActive ? soundscape : "none", muted);
  useEffect(() => { if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current); if (!sleepTimer || !musicActive) return; const fadeStart = (sleepTimer * 60 - 10) * 1000; const fadeEnd = sleepTimer * 60 * 1000; sleepTimerRef.current = setTimeout(() => { /* Begin 10-second fade */ const fadeSteps = 10; let step = 0; const fadeIv = setInterval(() => { step++; if (step >= fadeSteps) { clearInterval(fadeIv); setMusicActive(false); window.speechSynthesis?.cancel(); setIsSpeaking(false); } }, 1000); }, Math.max(fadeStart, 0)); return () => clearTimeout(sleepTimerRef.current); }, [sleepTimer, musicActive]);
  // Wake lock for iOS TTS continuity
  useEffect(() => { let wl = null; async function req() { try { if ('wakeLock' in navigator) wl = await navigator.wakeLock.request('screen'); } catch {} } if (isSpeaking) req(); return () => { try { wl?.release(); } catch {} }; }, [isSpeaking]);
  useEffect(() => { if (!loading) { setLoadingSeconds(0); return; } const iv = setInterval(() => setLoadingSeconds(s => s + 1), 1000); return () => clearInterval(iv); }, [loading]);

  // Typewriter
  useEffect(() => {
    if (!story || showAllText) return;
    const paras = story.content.split(/\n+/).filter(Boolean);
    setVisibleParas(0); let i = 0;
    const iv = setInterval(() => { i++; if (i >= paras.length) { clearInterval(iv); } setVisibleParas(i + 1); }, 1400);
    typewriterRef.current = iv;
    return () => clearInterval(iv);
  }, [story, showAllText]);

  function speak(text) { if (!("speechSynthesis" in window)) return; window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/\n/g, " ")); u.rate = 0.85; u.pitch = 1.0; u.onstart = () => setIsSpeaking(true); u.onend = () => setIsSpeaking(false); u.onerror = () => setIsSpeaking(false); window.speechSynthesis.speak(u); }
  function stopSpeak() { window.speechSynthesis?.cancel(); setIsSpeaking(false); }

  async function generateStory() {
    setLoading(true); setError(null); setLoadingSeconds(0);
    const age = parseInt(listenerAge) || 7;
    const readLvl = age <= 7 ? "Simple words, short sentences, sound effects, humor. Early chapter book feel." : age <= 10 ? "Mixed sentence length, richer vocabulary, emotional depth. Middle-grade feel." : "Full vocabulary, moral complexity, layered prose. YA feel.";
    const lengthSpec = STORYTIME_LENGTHS.find(l => l.id === storyLength);
    const seedContext = worldSeed ? `\nWORLD CONTEXT (from a previous adventure): World: ${worldSeed.world}. Tone: ${worldSeed.tone}. Thread: ${worldSeed.thread || "none"}. Villain: ${worldSeed.villain || "unknown"}. Use this world as the setting. Honor the unresolved thread. The villain may appear. This is a new story in the same universe, not a continuation.\n` : "";

    const sysPrompt = `You are a master storyteller. Generate a complete, linear story for a child listener. No choices, no interactivity. Just a beautiful story meant to be read aloud.\n\nRespond with ONLY valid JSON, no markdown:\n{"title":"string","content":"the full story with \\n paragraph breaks","mood":"one word mood","worldSeed":{"world":"setting name","tone":"tone","thread":"one sentence unresolved thread for future stories","villain":"villain name or null"}}\n\nThe story must be ${lengthSpec?.words || "800-1000 words"}.\nListener: ${listenerName || "a child"}, age ${age}.\nReading level: ${readLvl}\nGenre: ${genre?.label || "bedtime story"}\n${customPrompt ? `Special request: ${customPrompt}\n` : ""}${seedContext}\nRules:\n- Write the full story. Beginning, middle, end.\n- Match the genre and tone perfectly.\n- Use sensory language. Sounds, textures, colors, smells.\n- For bedtime stories: end with settling, not excitement. The last paragraph should feel like closing your eyes.\n- For adventure/funny: end with satisfaction and a hint of what might come next.\n- Include at least one memorable character name and one vivid setting detail.\n- No violence beyond bumps and scrapes. No scary content for ages under 8.\n- PACING FOR READ-ALOUD: Use shorter sentences in the final third. Slow the rhythm progressively. The last three paragraphs should use longer pauses (ellipses), softer language, and settle toward stillness. End every bedtime story with a closing-your-eyes feeling. For all genres, the final paragraph should feel like exhaling.\n- worldSeed should capture the world you created so someone could start a new story there later.`;

    const provObj = PROVIDERS.find(p => p.id === provider);
    try {
      const raw = await callAI(provider, apiKey, provObj.model, [{ role: "user", content: "Generate the story now." }], sysPrompt);
      let parsed;
      try { parsed = parseAIJson(raw); } catch {
        // Fallback: extract story fields manually
        const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
        const title = (cleaned.match(/"title"\s*:\s*"([^"]*)"/) || [])[1] || "Untitled Story";
        const contentMatch = cleaned.match(/"content"\s*:\s*"([\s\S]*?)"\s*,\s*"mood"/);
        const content = contentMatch ? contentMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : cleaned.length > 100 ? cleaned : null;
        const mood = (cleaned.match(/"mood"\s*:\s*"([^"]*)"/) || [])[1] || "warm";
        if (content) { parsed = { title, content, mood, worldSeed: { world: title, tone: mood, thread: "", villain: null } }; }
        else { throw new Error("Could not extract story. Tap retry."); }
      }
      setStory(parsed);
      setShowAllText(false); setVisibleParas(0);
      setMusicActive(true);
      SFX.begin();
      // Save world seed
      if (parsed.worldSeed) {
        saveWorldSeed({ ...parsed.worldSeed, title: parsed.title, date: new Date().toLocaleDateString(), sourceMode: "storytime" });
      }
      setPhase("reading");
      completeChallenge("storytime", { soundscape, storyLength, genre: genre?.id, usedWorldSeed: !!worldSeed, continued: false });
    } catch (e) { setError(e.message || "Story generation failed."); }
    setLoading(false);
  }

  function continueStorytimeStory() {
    stopSpeak();
    const prevTitle = story?.title || "";
    const prevSeed = story?.worldSeed;
    const contSeed = prevSeed ? { ...prevSeed, title: prevTitle, date: new Date().toLocaleDateString(), sourceMode: "storytime" } : null;
    const contPrompt = `This is a sequel to "${prevTitle}." Continue from where the previous story ended. Same world, same characters. New conflict, new journey. Honor the unresolved thread.`;
    // Set state for UI display
    if (contSeed) setWorldSeed(contSeed);
    setCustomPrompt(contPrompt);
    setStory(null); setShowAllText(false); setVisibleParas(0); setSessionRating(0); setSessionTags([]);
    // Generate with explicit params since state is async
    (async () => {
      setLoading(true); setError(null); setLoadingSeconds(0);
      const age = parseInt(listenerAge) || 7;
      const readLvl = age <= 7 ? "Simple words, short sentences, sound effects, humor." : age <= 10 ? "Mixed sentence length, richer vocabulary, emotional depth." : "Full vocabulary, moral complexity, layered prose.";
      const lengthSpec = STORYTIME_LENGTHS.find(l => l.id === storyLength);
      const seedContext = contSeed ? `\nWORLD CONTEXT (sequel): World: ${contSeed.world}. Tone: ${contSeed.tone}. Thread: ${contSeed.thread || "none"}. Villain: ${contSeed.villain || "unknown"}. Continue in this world. Honor the unresolved thread. This is a direct sequel.\n` : "";
      const sysPrompt = `You are a master storyteller. Generate a complete, linear story for a child listener. No choices, no interactivity. Just a beautiful story meant to be read aloud.\n\nRespond with ONLY valid JSON, no markdown:\n{"title":"string","content":"the full story with \\n paragraph breaks","mood":"one word mood","worldSeed":{"world":"setting name","tone":"tone","thread":"one sentence unresolved thread for future stories","villain":"villain name or null"}}\n\nThe story must be ${lengthSpec?.words || "800-1000 words"}.\nListener: ${listenerName || "a child"}, age ${age}.\nReading level: ${readLvl}\nGenre: ${genre?.label || "bedtime story"}\nSpecial request: ${contPrompt}\n${seedContext}\nRules:\n- This is a SEQUEL. Same world, same characters, new story arc.\n- Write the full story. Beginning, middle, end.\n- Use sensory language.\n- PACING FOR READ-ALOUD: Shorter sentences in the final third. The final paragraph should feel like exhaling.\n- worldSeed should capture the updated world state for future stories.`;
      const provObj = PROVIDERS.find(p => p.id === provider);
      try {
        const raw = await callAI(provider, apiKey, provObj.model, [{ role: "user", content: "Generate the sequel story now." }], sysPrompt);
        let parsed;
        try { parsed = parseAIJson(raw); } catch {
          const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
          const title = (cleaned.match(/"title"\s*:\s*"([^"]*)"/) || [])[1] || "Untitled Story";
          const contentMatch = cleaned.match(/"content"\s*:\s*"([\s\S]*?)"\s*,\s*"mood"/);
          const content = contentMatch ? contentMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : cleaned.length > 100 ? cleaned : null;
          const mood = (cleaned.match(/"mood"\s*:\s*"([^"]*)"/) || [])[1] || "warm";
          if (content) parsed = { title, content, mood, worldSeed: { world: title, tone: mood, thread: "", villain: null } };
          else throw new Error("Could not extract story. Tap retry.");
        }
        setStory(parsed); setShowAllText(false); setVisibleParas(0); setMusicActive(true); SFX.begin();
        if (parsed.worldSeed) saveWorldSeed({ ...parsed.worldSeed, title: parsed.title, date: new Date().toLocaleDateString(), sourceMode: "storytime" });
        setPhase("reading"); completeChallenge("storytime", { soundscape, storyLength, genre: genre?.id, usedWorldSeed: true, continued: true });
      } catch (e) { setError(e.message || "Story generation failed."); setPhase("setup"); }
      setLoading(false);
    })();
  }

  const shell = (title, children, showBackBtn, onBackFn) => (
    <div style={{ minHeight: "100vh", background: C.ink, color: C.cream, fontFamily: "'Playfair Display', Georgia, serif" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 20px", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, minHeight: 40 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {showBackBtn && <button onClick={() => { SFX.back(); onBackFn?.(); }} style={{ background: "none", border: "none", color: C.creamDim, fontSize: 22, cursor: "pointer", padding: 4 }}>←</button>}
            <span style={{ color: C.textDim, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" }}>{title || "Storytime"}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {phase === "reading" && <button onClick={isSpeaking ? stopSpeak : () => speak(story?.content || "")} style={{ background: "none", border: `1px solid ${isSpeaking ? "#a78bfa" : C.textDim}`, color: isSpeaking ? "#a78bfa" : C.creamDim, borderRadius: 8, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>{isSpeaking ? "⏹ Stop" : "▶ Read Aloud"}</button>}
            <button onClick={() => setMuted(m => !m)} style={{ background: "none", border: "none", color: C.creamDim, fontSize: 18, cursor: "pointer", padding: 4 }}>{muted ? "🔇" : "🔊"}</button>
          </div>
        </div>
        {children}
      </div>
      <GlobalStyles />
    </div>
  );

  // SETUP
  if (phase === "setup") {
    const seeds = getWorldSeeds();
    return shell("Storytime", (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, paddingTop: 10 }}>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 36, marginBottom: 4 }}>🌙</div>
          <h2 style={{ color: "#a78bfa", fontSize: 24, margin: "0 0 4px", fontWeight: 800 }}>Storytime</h2>
          <p style={{ color: C.creamDim, fontSize: 14, margin: 0, fontStyle: "italic" }}>A story just for you. No choices, just listen.</p>
          <div style={{ width: 60, height: 2, background: "linear-gradient(90deg, transparent, #a78bfa, transparent)", margin: "10px auto 0" }} />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input value={listenerName} onChange={e => setListenerName(e.target.value)} placeholder="Listener's name" style={{ flex: 2, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", color: C.cream, fontSize: 14, fontFamily: "inherit" }} />
          <input value={listenerAge} onChange={e => setListenerAge(e.target.value)} placeholder="Age" type="number" style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", color: C.cream, fontSize: 14, fontFamily: "inherit" }} />
        </div>

        <p style={{ color: C.textDim, fontSize: 11, margin: "8px 0 2px", textTransform: "uppercase", letterSpacing: 1 }}>Genre</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {STORYTIME_GENRES.map(g => (
            <button key={g.id} onClick={() => { SFX.select(); setGenre(g); }} style={{ background: genre?.id === g.id ? "rgba(139,92,246,0.12)" : C.card, border: `1px solid ${genre?.id === g.id ? "#a78bfa" : C.border}`, borderRadius: 10, padding: "10px 10px", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
              <span style={{ fontSize: 18 }}>{g.emoji}</span>
              <p style={{ color: genre?.id === g.id ? "#a78bfa" : C.cream, fontWeight: 600, margin: "4px 0 2px", fontSize: 12 }}>{g.label}</p>
              <p style={{ color: C.textDim, margin: 0, fontSize: 10, lineHeight: 1.4 }}>{g.desc}</p>
            </button>
          ))}
        </div>

        <p style={{ color: "#a78bfa", fontSize: 11, margin: "8px 0 2px", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700 }}>Length</p>
        <div style={{ display: "flex", gap: 8 }}>
          {STORYTIME_LENGTHS.map(l => (
            <button key={l.id} onClick={() => { SFX.select(); setStoryLength(l.id); }} style={{ flex: 1, background: storyLength === l.id ? "rgba(139,92,246,0.15)" : C.card, border: `1px solid ${storyLength === l.id ? "#a78bfa" : C.border}`, borderRadius: 24, padding: "10px 8px", cursor: "pointer", textAlign: "center", fontFamily: "inherit", transition: "all 0.2s" }}>
              <p style={{ color: storyLength === l.id ? "#a78bfa" : C.cream, margin: 0, fontSize: 13, fontWeight: 700 }}>{l.label}</p>
            </button>
          ))}
        </div>

        <input value={customPrompt} onChange={e => setCustomPrompt(e.target.value)} placeholder="Special request? (e.g. 'a story about a brave fox who lives in the clouds')" style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 14px", minHeight: 52, color: C.cream, fontSize: 14, boxSizing: "border-box", fontFamily: "inherit", fontStyle: customPrompt ? "normal" : "italic" }} />

        {/* World Seeds */}
        {seeds.length > 0 && (
          <div>
            <button onClick={() => setShowSeeds(!showSeeds)} style={{ background: "none", border: `1px solid rgba(139,92,246,0.3)`, color: "#a78bfa", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", width: "100%" }}>
              {showSeeds ? "Hide saved worlds" : `🌍 Enter a world from a past adventure (${seeds.length})`}
            </button>
            {showSeeds && <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {worldSeed && <button onClick={() => setWorldSeed(null)} style={{ background: "rgba(212,92,26,0.1)", border: `1px solid ${C.terra}`, color: C.terraLight, borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>✕ Clear world selection</button>}
              {seeds.map((s, i) => (
                <button key={i} onClick={() => { SFX.select(); setWorldSeed(s); setShowSeeds(false); }} style={{ background: worldSeed === s ? "rgba(139,92,246,0.15)" : C.card, border: `1px solid ${worldSeed === s ? "#a78bfa" : C.border}`, borderRadius: 8, padding: "10px 12px", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                  <p style={{ color: "#a78bfa", fontWeight: 600, margin: 0, fontSize: 13 }}>{s.title || s.world}</p>
                  <p style={{ color: C.textDim, margin: "2px 0 0", fontSize: 11 }}>{s.date} · {s.sourceMode || "adventure"} · {s.tone}</p>
                  {s.thread && <p style={{ color: C.creamDim, margin: "4px 0 0", fontSize: 11, fontStyle: "italic" }}>{s.thread}</p>}
                </button>
              ))}
            </div>}
          </div>
        )}

        {/* Music */}
        <p style={{ color: "#a78bfa", fontSize: 11, margin: "4px 0 2px", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700 }}>Music</p>
        <div style={{ display: "flex", gap: 6 }}>
          {[{ id: "none", e: "🔇" }, { id: "warm", e: "🌅" }, { id: "spooky", e: "🌲" }, { id: "african", e: "🪘" }, { id: "playful", e: "🔔" }, { id: "scifi", e: "🪐" }].map(m => (
            <button key={m.id} onClick={() => setMusicTrack(m.id)} style={{ flex: 1, background: musicTrack === m.id ? "rgba(139,92,246,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${musicTrack === m.id ? "#a78bfa" : C.border}`, borderRadius: 8, padding: "8px 4px", cursor: "pointer", textAlign: "center", fontSize: 18, fontFamily: "inherit" }}>{m.e}</button>
          ))}
        </div>

        {/* Soundscape */}
        <p style={{ color: "#a78bfa", fontSize: 11, margin: "8px 0 2px", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700 }}>Ambient Soundscape</p>
        <div style={{ display: "flex", gap: 6 }}>
          {[{ id: "none", l: "None" }, { id: "rain", l: "🌧 Rain" }, { id: "fire", l: "🔥 Fire" }, { id: "forest", l: "🌿 Forest" }, { id: "ocean", l: "🌊 Ocean" }].map(s => (
            <button key={s.id} onClick={() => setSoundscape(s.id)} style={{ flex: 1, background: soundscape === s.id ? "rgba(139,92,246,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${soundscape === s.id ? "#a78bfa" : C.border}`, borderRadius: 8, padding: "6px 2px", cursor: "pointer", textAlign: "center", fontSize: 11, fontFamily: "inherit", color: soundscape === s.id ? "#a78bfa" : C.creamDim }}>{s.l}</button>
          ))}
        </div>

        {/* Sleep Timer */}
        <p style={{ color: "#a78bfa", fontSize: 11, margin: "8px 0 2px", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700 }}>Sleep Timer</p>
        <div style={{ display: "flex", gap: 6 }}>
          {[{ id: null, l: "Off" }, { id: 10, l: "10 min" }, { id: 20, l: "20 min" }, { id: 30, l: "30 min" }].map(t => (
            <button key={t.id || "off"} onClick={() => setSleepTimer(t.id)} style={{ flex: 1, background: sleepTimer === t.id ? "rgba(139,92,246,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${sleepTimer === t.id ? "#a78bfa" : C.border}`, borderRadius: 8, padding: "8px 4px", cursor: "pointer", textAlign: "center", fontSize: 12, fontFamily: "inherit", color: sleepTimer === t.id ? "#a78bfa" : C.creamDim }}>{t.l}</button>
          ))}
        </div>

        {/* iOS advisory */}
        {/iPad|iPhone|iPod/.test(navigator.userAgent) && <p style={{ color: C.textDim, fontSize: 11, margin: "4px 0 0", fontStyle: "italic" }}>Note: On iPhone/iPad, the screen must stay on for Read Aloud to continue.</p>}

        {error && <ErrorBox error={error} onRetry={generateStory} />}
        <PrimaryBtn disabled={!genre || !listenerAge || loading} onClick={generateStory} style={{ marginTop: 8, background: loading ? C.textDim : "linear-gradient(135deg, #6d28d9 0%, #a78bfa 100%)" }}>
          {loading ? `Creating${".".repeat((loadingSeconds % 3) + 1)} (${loadingSeconds}s)` : worldSeed ? `Generate Story in ${worldSeed.title || worldSeed.world}` : "Generate Story"}
        </PrimaryBtn>
      </div>
    ), true, onBack);
  }

  // READING
  if (phase === "reading" && story) {
    const paras = story.content.split(/\n+/).filter(Boolean);
    const allRevealed = showAllText || visibleParas >= paras.length;
    return shell(story.title || "Storytime", (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ height: 5, borderRadius: 3, background: "linear-gradient(90deg, #6d28d9 0%, #a78bfa 50%, #6d28d9 100%)", opacity: 0.7 }} />
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <span style={{ color: "#a78bfa", fontSize: 12, opacity: 0.5 }}>✦</span>
          <h2 style={{ color: "#c4b5fd", fontSize: 28, margin: "6px 0 0", fontWeight: 800, lineHeight: 1.3 }}>{story.title}</h2>
          {story.mood && <span style={{ display: "inline-block", marginTop: 8, background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 20, padding: "3px 12px", color: "#a78bfa", fontSize: 12, fontStyle: "italic" }}>{story.mood}</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {paras.map((p, i) => (showAllText || i < visibleParas) && (
            <p key={i} style={{ color: C.cream, fontSize: 17, lineHeight: 2.0, margin: 0, animation: !showAllText ? "fadeUp 0.5s ease-out" : "none" }}>{p}</p>
          ))}
        </div>
        {!allRevealed && <button onClick={() => { setShowAllText(true); setVisibleParas(paras.length); clearInterval(typewriterRef.current); }} style={{ background: "none", border: `1px solid ${C.textDim}`, color: C.creamDim, borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12, alignSelf: "flex-start", fontFamily: "inherit" }}>Show all</button>}
        {allRevealed && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center" }}>
              <div style={{ flex: 1, height: 1, background: "rgba(139,92,246,0.2)" }} />
              <span style={{ color: "#a78bfa", fontSize: 11, letterSpacing: 2, opacity: 0.6 }}>✦ THE END ✦</span>
              <div style={{ flex: 1, height: 1, background: "rgba(139,92,246,0.2)" }} />
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
              <p style={{ color: "#a78bfa", fontWeight: 700, fontSize: 14, margin: "0 0 12px", textTransform: "uppercase" }}>How was it?</p>
              <StarRating value={sessionRating} onChange={setSessionRating} size={32} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                {TAG_OPTIONS.map(tag => { const on = sessionTags.includes(tag); return <button key={tag} onClick={() => setSessionTags(on ? sessionTags.filter(t => t !== tag) : [...sessionTags, tag])} style={{ background: on ? "rgba(139,92,246,0.2)" : "transparent", border: `1px solid ${on ? "#a78bfa" : C.textDim}`, color: on ? "#a78bfa" : C.creamDim, borderRadius: 20, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>{tag}</button>; })}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <PrimaryBtn onClick={continueStorytimeStory} style={{ background: "linear-gradient(135deg, #6d28d9 0%, #a78bfa 100%)" }}>📖 Continue This Story</PrimaryBtn>
              <button onClick={() => { stopSpeak(); setPhase("setup"); setStory(null); setMusicActive(false); setSessionRating(0); setSessionTags([]); setWorldSeed(null); setCustomPrompt(""); }} style={{ background: "none", border: "1px solid rgba(139,92,246,0.4)", color: "#a78bfa", borderRadius: 12, padding: "14px", cursor: "pointer", fontSize: 15, fontFamily: "inherit" }}>✨ New Story</button>
              <button onClick={() => { stopSpeak(); onBack(); }} style={{ background: "none", border: `1px solid ${C.textDim}30`, color: C.textDim, borderRadius: 12, padding: "12px", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Main Menu</button>
            </div>
          </div>
        )}
      </div>
    ), false);
  }

  return shell("", <p style={{ color: C.textDim }}>Loading...</p>);
}
