# Voice-Conversation AI Web App — Requirements (Draft v0.2)

> **Goal:** Next.js (TypeScript) app on Vercel for (A) real-time English conversation practice and (B) lecture assist, with a read‑only student portal. **OpenAI Realtime API + WebRTC**. All AI features exposed both as **Agent tools** and **UI actions**.

---

## 0. Product Overview

**Users**
- **Owner/Instructor (you)**: uses Practice and Lecture consoles.
- **Student**: views published lectures; can ask questions and vote (no edit).

**Features**
1. **Practice**: AI proposes topics; real-time voice conversation; per‑utterance replay / translation (toggle) / optional grammar feedback.
2. **Lecture Assist**: live ASR → minimal correction → supplemental info search with citations → periodic and end summaries; instructor approves/publishes.
3. **Student Portal**: read‑only published lectures (transcript, corrections, summaries, citations) + Q&A + polls.

---

## 1. Functional Requirements

### 1.1 Practice (low latency voice)
- Topic suggestions (3 choices + “another”).
- Bi‑directional audio via WebRTC to OpenAI Realtime; stream partial/final text.
- Utterance card actions: **Replay**, **Translate (show/hide)**, **Grammar tip** (async; does not block reply).
- Session log export (MD/JSON).

### 1.2 Lecture Assist
- Start/Stop a **Lecture**; capture live ASR (EN).
- Minimal corrections; highlight key terms.
- Supplemental info search with citations; periodic summaries (e.g., every 3 min) + end summary.
- Instructor marks chapters; post‑review → **Publish** to Student Portal.
- Export bundle (MD/JSON + optional audio, with consent).

### 1.3 Student Portal
- List **Published Lectures**; read‑only view.
- **Q&A** submission + upvotes; optional polls.

---

## 2. Non‑Functional
- **Latency**: TTFT audio < 500ms (Practice); transcript update < 1s.
- **Auth/Roles**: Owner‑only for `/practice` and `/lecture`. Student portal read‑only.
- **Privacy/Consent**: explicit consent banners; retention policy.
- **Accessibility**: WCAG 2.2 AA; captions; keyboard nav.
- **Observability**: structured logs, latency, token usage; redact PII.

---

## 3. Architecture

### 3.0 Routing & Component Strategy (updated)
- **Routes** (split by domain):
  - `/practice` (auth) – practice console.
  - `/lecture` (auth) – instructor console.
  - `/lectures/[id]` (public or share‑code) – student viewer.
- **Shared core**: `RealTimeRTC` component encapsulates WebRTC + Realtime wiring (tracks, data channel, event bus).
  - Props: `mode: "practice" | "lecture"`, `agentConfigId`.
- **Per‑route Agent Configs** (no monolithic Practice/Lecture/Student trio):
  - `PracticeAgentConfig`: topic proposal, role‑play, async grammar hints.
  - `LectureAgentConfig`: ASR → correction → retrieval → summary; chapter markers.
  - Student route has **no realtime agent**; optional `StudentQAAgent` (text) answers using only published content.
- **Dual invocation of AI features**:
  - As **Agent tools** callable from models.
  - As **UI actions** hitting `/api/agent/tools/*` (e.g., `summarize`, `translate`, `correct`).

### 3.1 Data Flow
- Client ↔ **/api/session** → gets **ephemeral** token → WebRTC with OpenAI Realtime.
- Realtime events (asrPartial/final, response.*) → UI + persistence save queue.
- Background tasks produce translations/grammar/summaries; update rows when ready.

### 3.2 Agents (updated)
- **PracticeAgentConfig**: concise tutor; proposes topics; keeps replies <8s; grammar tips delivered after‑the‑fact.
- **LectureAgentConfig**: high‑fidelity ASR; conservative correction; emits summaries + citations on schedule.
- **StudentQAAgent** (optional): constrained to published content (retrieval only; no external web unless allowed).

---

## 4. API Surface (Edge/Server)

- `POST /api/session` → mint **ephemeral** Realtime session (scoped; 1‑min) and return token.
- `POST /api/agent/tools/summarize|translate|correct` → run text tools on selected span.
- `POST /api/lecture/start|stop|publish`
- `GET /api/lectures/:id` (student read‑only)
- `POST /api/qa/:lectureId` (ask), `POST /api/qa/:id/answer`
- `POST /api/polls/:lectureId`, `POST /api/polls/:id/vote`

### 4.0 Auth (minimal for solo use)
- **Basic Auth** middleware (`APP_PASSWORD`) for `/practice` and `/lecture`.
- Future: NextAuth Credentials or OAuth; RBAC for multi‑user.

---

## 5. Persistence & “Resume”

### 5.1 Source of Truth
- **Postgres** (Supabase): durable storage for sessions/messages/lectures.
- **Objects**: audio snippets/exports in S3‑compatible storage (Supabase Storage or Vercel Blob).

### 5.2 Optional fan‑out for live student viewers
- If you want near‑real‑time audience view while lecturing: **Redis/Upstash** pub/sub (or Supabase Realtime) to broadcast transcript chunks; viewers hydrate from Postgres on refresh/reconnect.
- If publish‑after‑review only: **Redis不要**。

### 5.3 Tables (initial)
- `Session { id, type 'practice'|'lecture', userId, status, startedAt, endedAt }`
- `Message { id, sessionId, idx, role, text, audioUrl, translation, grammar, timestamps, isFinal }`
- `Lecture { id, sessionId, title, status 'draft'|'published', createdBy, publishedAt }`
- `Summary { id, lectureId, windowMs, content, citations[] }`
- `QA { id, lectureId, authorId, question, answer, upvotes, createdAt }`
- `Poll { id, lectureId, question, options[], multi, closesAt }`
- `PollVote { id, pollId, userId, optionIdx }`

### 5.4 Resume semantics
- Realtime sessions are **not persisted** server‑side; on reconnect/new session:
  1) Load last open `Session` + tail **N** messages (or last summary) from Postgres;  
  2) Seed the new session via `instructions` or initial messages;  
  3) Continue appending new `Message` rows.

---

## 6. UI (key screens)
- **Practice**: mic status, topic picker, timeline with utterance cards (Replay / Translate toggle / Hide / Grammar), latency meter.
- **Lecture**: Start/Stop, consent indicator, chapter markers; panels for Transcript, Corrections, Findings (citations), Summaries; Publish flow.
- **Student**: read‑only transcript + summaries + citations; Q&A + polls.

---

## 7. Observability & QA
- Metrics: TTFT, E2E latency, ASR WER, token cost; error rates.
- Logs: JSON, correlation IDs; redact PII.
- Tests: unit (Vitest/Jest), E2E (Playwright), synthetic load for signaling + Realtime.
- Quality review for grammar tips on sampled turns.

---

## 8. Deployment & Config
- Vercel Edge where possible; Node for DB routes.
- Env: `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`, `APP_PASSWORD`, `DATABASE_URL`, `STORAGE_BUCKET`, `WEBHOOK_SECRET`.
- Cost controls: per‑session ceilings; downshift models out of peak; windowed summarization.

---

## 9. Risks & Mitigations
- Latency/jitter → edge token minting; async heavy tools; summary windows.
- Browser/mic issues → preflight checks & fallbacks.
- Cost spikes → quotas + model downshift; nightly reports.
- Privacy → default short retention; manual redaction for publish.

---

## 10. MVP Scope
- Practice: topic suggestion + live voice + replay/translation toggle + optional grammar tip.
- Lecture: live transcript + 3‑min summaries + publish.
- Student: read‑only published lecture + Q&A + upvotes.
- Basic Auth + minimal analytics.

---

## 11. Notes on the reference repo
- The **`openai/openai-realtime-agents`** repo demonstrates patterns and **does not include a persistent DB**. It mints an **ephemeral session** on `/api/session` and streams via WebRTC; conversation state is held in memory/UI while connected. Plan your own Postgres persistence and (optionally) Redis fan‑out for multi‑viewer scenarios.
