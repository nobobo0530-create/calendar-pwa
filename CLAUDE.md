# calendar-pwa

iPhone PWA。シンプルなカレンダーアプリ。月表示メインで、日付タップで詳細表示。

## ユーザー
日本語。非エンジニア。NBAチーム名は必ずカタカナのフル表記（略称LAL/OKC等は使わない）。

## 構成
- 素のHTML/CSS/JS（フレームワークなし）
- Vercel自動デプロイ
- データ: localStorage
- ローカル開発: `python3 -m http.server 3336 --directory public`

## ファイル
- `public/index.html`
- `public/js/app.js` - 全機能
- `public/css/style.css`
- `public/sw.js` - Service Worker
- `public/manifest.json`

## 主要機能
- 月カレンダー + 日付選択
- 予定登録: タイトル/時間/カテゴリ
- 選択した日の予定一覧表示
- URL `?import=base64data` で予定一括インポート（Unicode-safe via encodeURIComponent/escape）

## デプロイ
git push origin main → Vercel自動公開

## UI方針
- iOS風ライトテーマ
- 選択日セルは黒背景 + 白文字（イベント文字は半透明白で可読性確保）
- 土曜=青 / 日曜=赤

## 既知の注意点
- toISOString() はUTC変換ズレあり → ローカル日付で組立
- iOS PWAプライベートブラウジングではlocalStorage不可
- URL importはBase64+encodeURIComponentでマルチバイト対応
