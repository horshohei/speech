# WebRTC Realtime App — Development Stages & Tests (for Codex)

> Scope: Next.js (TS) + Vercel, WebRTC to OpenAI Realtime. Routes: `/practice`, `/lecture`, `/lectures/[id]`. DB: Postgres (Supabase). Optional Redis for live fan-out.

---

## Stage 0 — Project Bootstrap
**Goal:** Repo scaffolding, CI, lint/typecheck green.

**Build Tasks**
- `npx create-next-app` (App Router, TS, ESLint)
- Add Tailwind + shadcn/ui, Zustand, Zod, React Hook Form.
- Configure Vitest/Jest, Playwright, ESLint, Prettier, Husky + lint-staged.

**Tests**
- *Unit*: `tsc` passes; sample util (`formatLatency`) with Vitest.
- *CI*: GitHub Actions workflow runs `pnpm lint && pnpm typecheck && pnpm test`.
- *Acceptance*: Page `/` returns 200 on `pnpm dev` and in Playwright smoke test.

---

## Stage 1 — Minimal Auth (Solo Use)
**Goal:** `/practice` `/lecture` を Basic Auth で保護。

**Build Tasks**
- `/middleware.ts` で `APP_PASSWORD` を検証（cookie or header ベース）。
- `.env` で `APP_PASSWORD` を管理。

**Tests**
- *Integration*: Playwright → 未ログインで `/practice` に 401 → 正しいパスワードで 200。
- *Security*: パスワードがレスポンスに含まれないことを確認。

**DoD**
- 認証失敗時に汎用的なメッセージ（情報漏えいなし）。

---

## Stage 2 — `/api/session`（エフェメラルトークン）
**Goal:** Realtime 接続用トークンを発行。

**Build Tasks**
- `POST /api/session`（Edge で可）: user 認証→OpenAI Realtime 用の ephemeral key/SDP 設定を発行。
- 期限（例：60s）とスコープ（権限）を付与。

**Tests**
- *Unit*: 期限計算・署名のユニットテスト。
- *Integration*: 期限切れ後は 401/403、認証なしは 401。
- *Contract*: レスポンス shape `{ token, expiresAt }` を Zod で検証。

---

## Stage 3 — `RealTimeRTC` コンポーネント（WebRTC 基盤）
**Goal:** WebRTC offer/answer、音声入出力、イベントバス。

**Build Tasks**
- `RealTimeRTC`（props: `{ mode: 'practice'|'lecture', agentConfigId?: string }`）。
- MediaDevices 取得、音声トラック attach、DataChannel でイベント受送信。
- イベント: `asrPartial`, `asrFinal`, `assistantSpeechStart/End` などを `EventEmitter` 風に発火。

**Tests**
- *Unit*: hook の状態遷移（`useRtc`）を Jest の fake timers で確認。
- *Manual*: ループバックデバイスでの音声往復、ミュート/デバイス切替、切断-再接続。
- *E2E (Playwright)*: 接続確立→`asrPartial` テキスト行が UI に 1s 以内に出る。

**DoD**
- 接続失敗時に UI がエラーバナー + 再試行を提示。

---

## Stage 4 — Practice ページ（低遅延会話）
**Goal:** トピック提案→会話→再生/翻訳/隠す/文法メモ（非同期）。

**Build Tasks**
- `/practice`：TopicPicker、UtteranceCard（Replay/Translate/Hide/Grammar）。
- `PracticeAgentConfig` を適用（短め応答・8s以内・文法メモは遅延実行）。
- セッションログ（MD/JSON）生成ボタン。

**Tests**
- *E2E*: 最初の音声トークンまで < 500ms（メトリクスを devtools から収集）※許容幅あり。
- *Functional*: 翻訳トグルの状態保持、再生が前回の音声を再生すること。
- *Contract*: Agent からの grammar payload の schema を Zod で検証。

**DoD**
- 文法メモはライブ応答をブロックしない（別イベントで遅れて到着）。

---

## Stage 5 — Lecture Console（ASR→補足検索→要約）
**Goal:** ライブ書き起こし/軽微修正/定期要約（3min）/公開フロー。

**Build Tasks**
- `/lecture`：Start/Stop、同意表示、Chapter マーカー、Transcript/Summary/Findings パネル。
- `LectureAgentConfig`（忠実 ASR、控えめ修正、定期要約+引用）。
- `/api/agent/tools/summarize|translate|correct`（UI ボタンからも呼べる）。

**Tests**
- *Integration*: 3分相当（テストではショート）で periodic summary が蓄積される。
- *E2E*: Start→話す→Transcript に partial→final→Summary が表示→Publish で `/lectures/[id]` 生成。
- *Quality*: ノイズ環境での WER がベースライン以内（スモーク）。

**DoD**
- Publish 前後で Student ページの状態が「ドラフト→公開」に切り替わる。

---

## Stage 6 — 永続化（Postgres）と“続きから”
**Goal:** Durable 保存とリジューム。

**Build Tasks**
- テーブル: `Session, Message, Lecture, Summary, QA, Poll, PollVote`。
- final メッセージ確定時に insert/upsert。翻訳/訂正/要約は後追い更新。
- 再入室時に「直近サマリ＋Nターン」を seed として新セッションへ投入。

**Tests**
- *Unit*: Repository 層の CRUD テスト（DB を Docker で立てる or Supabase Test）。
- *E2E*: セッションAで会話→再読み込み→セッションBで直近コンテキストが表示／続行できる。
- *Migration*: Prisma/Drizzle のマイグレーションが idempotent。

**DoD**
- データは PII レダクション設定に従い保存。

---

## Stage 7 — Student ポータル
**Goal:** 公開済み講義の閲覧（読み取り専用）、Q&A/投票。

**Build Tasks**
- `/lectures/[id]`：Transcript/Corrections/Summaries/References の表示。
- Q&A 投稿と upvote、Poll 作成/投票（Instructor から作成）。
- （任意）ライブ字幕：Redis Pub/Sub → クライアントは SSE/WS で受信。

**Tests**
- *Access*: Basic Auth 不要（もしくは共有コード）。編集操作は 403。
- *E2E*: Q&A 投稿→Instructor が回答→Student 側で反映。
- *Realtime (任意)*: ライブ字幕受信→途切れたら DB で水和。

**DoD**
- 公開/非公開・シェアコードのポリシーが守られる。

---

## Stage 8 — 観測性・コスト管理
**Goal:** 遅延・使用量を可視化、上限制御。

**Build Tasks**
- 主要イベントに `correlationId`、structured logs（PII レダクション）。
- メトリクス：TTFT、ASR レイテンシ、トークン消費、エラー率。
- コスト上限：セッション or 日次で打ち切り（UI 通知）。

**Tests**
- *Load*: Playwright + k6 で同時接続のスモーク。
- *Budget*: 上限到達時に graceful stop、UI に警告表示。

**DoD**
- ダッシュボード（簡易でも）で主要KPIを確認可能。

---

## Stage 9 — リリース準備
**Goal:** 本番デプロイ/ランブック/権限チェック。

**Build Tasks**
- Vercel 環境分離（Preview/Prod）、環境変数の整理。
- 事故対応ランブック（WebRTC 接続失敗時の手順、レイテンシ悪化時の確認項目）。
- プライバシーポリシー & 同意 UI。

**Tests**
- *E2E*: ハッピーパスを全部通す回帰スイート。
- *Security*: .env が露出していない、ヘッダーのセキュリティ設定。
- *Manual*: 複数ブラウザ（Safari/Chrome/Edge/モバイル）で音声入出力。

---

## 付録 — 推奨テストユーティリティ
- **Playwright**: 音声入力はプリ録音 WAV/OGG を `MediaStream` に差し込むモックを用意。
- **Vitest**: WebRTC 部分は抽象化した `useRtc`/`rtcClient` を DI して状態遷移をテスト。
- **Zod**: Agent ツールの I/O スキーマ（summary/translation/grammar）を厳格化。
- **k6**: `/api/session` と Redis fan-out の負荷スモーク。
