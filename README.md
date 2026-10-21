# Dots local evidence suite · Cloud milestone

ChangeProof、BugCapsule、RepoVault のローカル実装です。合成データだけで検証しました。試用向けのローカル実装で、全3製品のP0完成・本番利用可能とは主張しません。実Chromeは起動時の環境制約でBLOCKED、実GitHubは未接続です。

## 検証環境

Cloud Linux x86_64、Node 24.19.0、pnpm 10.28.2、age 1.3.2。固定依存は package.json / pnpm-lock.yaml。Windows未対応。macOSの過去証拠は今回の証拠とは別です。

## 初回準備

専用ディレクトリで実行。グローバル設定変更やinstall scriptsは不要です。

```sh
npm install --prefix .tooling --ignore-scripts --no-audit --no-fund pnpm@10.28.2
node .tooling/node_modules/pnpm/bin/pnpm.cjs install --frozen-lockfile --ignore-scripts
python3 scripts/install-age.py
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism
```

age installer は公式 v1.3.2 の macOS arm64 / Linux x86_64 の固定SHA256を照合し、`.tooling/age-v1.3.2` のみに配置します。既存フォルダは上書きしません。ダウンロードには外部接続が必要です。実GitHubリポジトリ接続や認証は行いません。

## 3つのデモと受け入れ試験

```sh
node scripts/acceptance.ts
node scripts/acceptance-bugcapsule.ts
node scripts/acceptance-repovault.ts
node scripts/security-repovault.ts
AGE_BIN="$PWD/.tooling/age-v1.3.2/age/age" AGE_KEYGEN_BIN="$PWD/.tooling/age-v1.3.2/age/age-keygen" node scripts/acceptance-repovault-http.ts
node scripts/demo.ts
node scripts/build-extension.ts
```

公開ソースには生成済みデモや鍵を含めません。デモは上記コマンドで合成データから生成します。新しくデモを実行した場合は標準出力に新しいレポート場所が表示されます。`scripts/finalize-cloud.ts` はクリーンインストール結果を含む全結果がある場合に集計します。

- ChangeProof: 保存故障 FAIL → skip検査弱化 FAIL → 修正 PASS。型検査と保存再読込の意味を分離。
- BugCapsule: DOM模擬記録から実ZIP出力・安全取込・ローカル閲覧。実拡張記録の成功とは別。
- RepoVault: 合成GitとAPIメタデータを実age暗号化、復号、Git fsck、refs照合、空ディレクトリへ実復旧。HTTPはlocalhostのGitHub形式モックであり、実GitHubではありません。

## ChangeProof

```sh
node apps/changeproof/cli.ts compare --repo /trusted/local/repo --base BASE --head HEAD \
  --policy /outside/repo/trusted-policy.json --dependencies /trusted/node_modules \
  --out artifacts/changeproof --trust-local
```

検査定義はrepo外の信頼済みpolicy。baseの検査ファイルをheadでも使い、PR変更を実行権限の根拠にしません。OS sandboxではなく、信頼済みコード専用です。

dirty repoは既定で拒否。`--dirty-snapshot` の明示指定時のみ、現在のHEADに対するファイルを1回凍結し、snapshot IDと各ファイルhashを `snapshot.json` に保存します。元repoのindex/refs/ファイルは変更しません。秘密ファイル名・symlinkは拒否。head SHAだけでdirty対象を識別しません。BugCapsuleとのリンクにもsnapshot IDが必要です。

比較UI/APIは登録済みパスだけを扱います。

```sh
node scripts/serve-changeproof.ts --repo /trusted/local/repo --policy /outside/repo/trusted-policy.json \
  --dependencies /trusted/node_modules --out artifacts/changeproof --trust-local --port 47831
```

表示URLを開き、base/head、信頼済み検査計画を確認して実行します。同一サーバー内2run制限・待ち行列・取消・冪等キー・自動状態更新があります。CLIを別々に複数起動する場合は独立したプロセスです。HTTPは127.0.0.1限定、Host/Origin/tokenを検証。外部コード・任意pathをブラウザー要求から登録できません。URLのtokenを共有しないでください。実画面のキーボード/200%拡大はBLOCKEDです。

### 抑制と表示言語

信頼済みpolicyの任意 `suppressions` 配列で `findingKey`、`diffDigest`、空でない `reason` / `owner`、UTC `expiresAt` を指定します。対象IDはレポートに表示。対象差分・指摘が一致し期限内の場合だけ適用し、監査記録を残します。期限切れは再表示し、サービスの状態と報告を再計算します。保存HTMLは生成時点の表示なので期限後はサービスを開くか再実行してください。bare `suppressed: true` は拒否します。

各製品の報告に日本語 `report.html` と英語 `report.en.html` を出力。比較UIは `?lang=en`、拡張popupは言語選択を利用します。ユーザー記述や原文の検査出力は翻訳・改変しません。

## BugCapsule

```sh
node scripts/build-extension.ts
node scripts/synthetic-server.ts
```

`artifacts/bugcapsule-extension` を専用Chrome profileへ読み込み、既定では同梱 `127.0.0.1:47832` の合成ページだけを記録できます。設定は完全一致originの明示登録と確認、別途開始操作を必要とします。この検証では合成originだけを使用し、実顧客サイトへの許可は得ていません。別originへの移動で停止し、登録済みoriginでも自動継続しません。開始/pause/resume/stop/discard、説明編集、イベント削除、持ち出し確認、ZIP出力を実装。

本文・属性・入力値・Cookie・storage・通信内容・外部画像を収集しません。構造snapshotは2000ノード/40階層上限の許可tagのみ。再生はscriptなしsandbox内の不活性な構造で、元ページの外観完全再現やサーバー状態の再現ではありません。記録だけでreproducedへ変更しません。

```sh
node apps/bugcapsule-viewer/cli.ts import --input report.zip --out artifacts/bugcapsule
node apps/bugcapsule-viewer/cli.ts link --input /bug/evidence.json --run /run/evidence.json \
  --head EXPECTED_SHA --out report-run-link.json
```

dirty runへ関連付ける場合だけ `--snapshot EXPECTED_SNAPSHOT_ID` も必要。異なるSHA/未指定snapshotはSTALE・INCOMPLETEです。ZIPはパス、symlink、重複、展開量、hash、イベント順を確認。由来はimport後unverified。Issue下書きはTXTだけで外部投稿しません。

実Chromeでの5分記録、worker休止、再読込、ネットワーク遮断、画面・操作確認は未完了。準備済み `node scripts/browser-bugcapsule-cloud.ts` は環境修復後の実行用です。未実行箇所をPASSへ変更してはいけません。

## RepoVault

```sh
node apps/repovault/cli.ts doctor --age "$PWD/.tooling/age-v1.3.2/age/age"
node apps/repovault/cli.ts capture --repo /synthetic/repo --repo-id synthetic-demo \
  --metadata metadata.json --recipient AGE_PUBLIC_RECIPIENT --out snapshots \
  --age /absolute/path/age --trust-synthetic
node apps/repovault/cli.ts verify --snapshot /snapshot --identity /separate/identity.txt --age /path/age
node apps/repovault/cli.ts restore-plan --snapshot /snapshot --identity /separate/identity.txt \
  --target /new/empty/target --out plan.json --age /path/age
node apps/repovault/cli.ts restore --plan plan.json --identity /separate/identity.txt --age /path/age
```

`capture-api` / `resume` はlocalhost合成HTTP限定です。`DOTS_SYNTHETIC_HTTP_TOKEN` は環境変数で渡し、CLI引数・保存物には含めません。通常アカウントのtokenを使わないでください。

```sh
node apps/repovault/cli.ts capture-api --repo /synthetic/repo --repo-id synthetic-demo \
  --api-origin http://127.0.0.1:PORT --owner synthetic --name demo \
  --recipient AGE_PUBLIC_RECIPIENT --out snapshots --checkpoint-out checkpoints \
  --age /path/age --trust-synthetic
node apps/repovault/cli.ts resume --repo /synthetic/repo --repo-id synthetic-demo \
  --checkpoint /encrypted/checkpoint --identity /separate/identity.txt \
  --recipient AGE_PUBLIC_RECIPIENT --out snapshots --checkpoint-out checkpoints \
  --age /path/age --trust-synthetic
```

resumeは `--checkpoint` または `--snapshot` の一方を選びます。再開元source照合・snapshot repoId照合、ページID upsert、先頭からの重複範囲再走査、per-PR reviews、Retry-After、checkpoint暗号化と失敗cleanupを検証。外部originのページリンクを拒否します。

暗号snapshotは最小indexとpayloadのみ。鍵は別置き。一時平文はowner-onlyで成功/失敗後cleanup。暗号VERIFIEDと復旧PASS/PARTIALは独立。元著者・権限としての再投稿はしません。LFS実体/submodule内容/release assets/Actions/Secrets等は未対応を明示。既定のZIP v1は50MiB上限を維持します。大容量のローカルcaptureは `--archive-format stream-v2` を明示し、1MiB単位のディスク処理、4GiB payload・16MiB manifest/metadata・10万file上限を使います。verify/restore-plan/restoreは形式を自動判別します。capture-api/resumeにも `--archive-format stream-v2` を指定できます。再開元snapshotの形式は自動判別。復旧作業領域とtargetは同一filesystemが必要です。容量目標は実測結果 `artifacts/repovault-stream-benchmark/result.json` を参照し、未作成なら未検証です。

## 制限と運用

`BLOCKERS.md`、`OPERATIONS.md`、`VALIDATION.json` を参照。外部GitHub資格情報、公開、課金、拡張ストア、本番/顧客データ、リモート書込みは対象外です。新規age鍵は合成試験専用で配布物へ含めません。

## License

First-party implementation and associated documentation are MIT licensed; see `LICENSE`. Third-party dependencies retain their own licenses listed in `DEPENDENCY_LICENSES.txt`. The license grants reuse rights, not a production-readiness or security guarantee.

## Preview licensing

First-party code and associated documentation are licensed under MIT. Third-party dependencies retain their respective licenses. The package remains private in package.json to prevent accidental npm publishing; this does not restrict MIT reuse rights.

No real service account, secrets, customer data or personal contact information is included. All fixture emails use reserved .invalid domains.
