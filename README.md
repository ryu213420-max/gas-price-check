# ガソスタ価格チェック

現在地周辺のガソリンスタンド価格を、スマートフォンで開いた瞬間に一目で確認するためのアプリです。

- 現在地を取得し、その市区町村の価格を表示します（対象は日本全国）
- 油種は レギュラー / ハイオク / 軽油 / 灯油（灯油は18Lあたりの価格で、単位を明記します）
- 価格は gogo.gs の投稿価格をもとにし、各価格に確認日を必ず併記します
- 画面内の文言は、スタンド名・価格・確認日などの事実情報のみです

## 技術選定と理由

| 領域 | 技術 | 理由 |
| --- | --- | --- |
| フロントエンド | React + TypeScript（Vite） | 画面がほぼ1枚のアプリなので軽く作れる。価格データに型があると表示ミスを減らせる |
| バックエンド | Cloudflare Workers + Hono | Workers 上でそのまま動く軽量フレームワークで、サーバーの運用管理が不要 |
| データ保存 | Cloudflare D1 | 価格履歴を SQL で扱える。無料枠（1日500万行読み取り等）に対して本アプリの規模は十分小さい |
| キャッシュ | Cloudflare KV | 開くたびの表示を速くするため、地域ごとの最新価格をキャッシュする |
| 定期更新 | Workers Cron Triggers | 価格は毎日変わるため、定期的に価格を取り直す |
| AI | Workers AI | 価格データから「最安値と地域平均の差」など、事実だけの一言要約を生成する。外部 AI の API キーや追加料金が不要 |
| ログイン | Google 認証のみ（OAuth 2.0） | お気に入りスタンドの保存用。パスワードを自前で保持しないため安全で運用も楽 |
| 公開 | GitHub（公開リポジトリ）+ GitHub Actions → Cloudflare | push をきっかけに型チェックとデプロイを自動化する |

想定コスト: Cloudflare の無料枠（Workers 1日100,000リクエスト、Workers AI 1日10,000ニューロン、D1・KV の無料枠）の範囲で運用でき、workers.dev / pages.dev の無料ドメインを使えば固定費はかかりません。

## 構成

```
apps/
  web/     フロントエンド（Vite + React + TypeScript）
  worker/  API（Cloudflare Workers + Hono）
    schema.sql  D1 のテーブル定義
.github/workflows/deploy.yml  デプロイ用 GitHub Actions
```

## 動作の流れ

1. アプリを開くと位置情報を取得し、市区町村を特定します
2. 保存済みの価格があれば即座に表示し、裏側で最新価格を取り直して差し替えます（stale-while-revalidate）
3. その市区町村の価格がまだ無い場合は、取得処理を呼んでから返します
4. 油種タブを切り替えると、最安値の表示と価格順リストがアニメーション付きで並び替わります

## セットアップ手順（残り作業）

コードはこのリポジトリに揃っています。実デプロイには、以下のアカウント側の手順が必要です。

### 1. Cloudflare アカウントと D1 / KV の作成

1. Cloudflare に無料登録する
2. D1 データベースを作成し、`apps/worker/schema.sql` を適用する
   - `npx wrangler d1 create gas-price-check`
   - `npx wrangler d1 execute gas-price-check --file apps/worker/schema.sql`
3. KV 名前空間を作成する
   - `npx wrangler kv namespace create CACHE`
4. 発行された ID を `apps/worker/wrangler.toml` のプレースホルダと差し替える

### 2. Google OAuth クライアントの作成

1. Google Cloud コンソールでプロジェクトを作成する
2. 「API とサービス」→「認証情報」で OAuth クライアント ID（ウェブアプリケーション）を作成する
3. 承認済みのリダイレクト URI に、デプロイ先の Worker の URL で
   `https://<worker のドメイン>/auth/google/callback` を登録する
4. クライアント ID とクライアント シークレットを取得する（このリポジトリには保存しない）

### 3. シークレットの設定

Worker 側（`apps/worker` で実行）:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

GitHub 側（リポジトリの Settings → Secrets and variables → Actions）:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### 4. デプロイ

main ブランチへの push で GitHub Actions が型チェックとデプロイを実行します。
手動実行も可能です:

```bash
npm ci
npm run build
cd apps/worker && npx wrangler deploy
```

## 開発

```bash
npm ci
npm run dev:web      # フロントエンド
npm run dev:worker   # Worker（wrangler dev）
npm run typecheck
```

API が未接続の環境では、アプリは価格データを表示せず空状態を表示します（モックデータを実データらしく見せることはしません）。

## 価格データについて

- 価格の出所は gogo.gs のユーザー投稿価格です。公式 API は提供されていません
- そのため取得処理は `apps/worker/src/prices.ts` の `fetchAreaPricesFromSource` に分離してあり、実装差し替えが可能な構造にしています
- 投稿価格は実際の店頭価格と異なる場合があるため、各価格に確認日を併記しています
