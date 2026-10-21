# ローカル運用

## 起動・停止

`README.md` の CLI で起動します。専用ポートは ChangeProof 47831、合成デモ 47832、BugCapsule 47833、RepoVault 47834 です。競合時は停止して別ポートを明示します。他案件のプロセスを kill しません。この作業の最終時点では常駐サーバーを残しません。

ChangeProof の Ctrl-C は AbortController 経由で対象のプロセスグループを終了します。実行中の元 repo は変更しません。途中結果・CANCELLED を残し、一時コピーを削除します。ログは10MiB/check、5分/check、15分/run が上限（policy 内で明示）。比較サービスはプロセス内2runキューと取消を実装。別々のCLI起動間を調停する常駐schedulerではありません。

## データ保存と期限

- ChangeProof: `--out` 以下に run ごとの evidence.json、details.json、HTML、秘匿ログ。CLI の index.sqlite は同じ出力先です。
- BugCapsule: 拡張のローカル session。初期保持7日、明示設定で7〜365日。読込・export時の固定期限検査で削除し（ブラウザー停止中の即時削除はできません）、書出し ZIP は独立コピーとして残ります。
- RepoVault: 暗号 snapshot と最小 index.json。既定30日は運用上の目安で、自動削除は無効。過去 snapshot を同期元の削除へ追従させません。
- `.runtime/repovault` の平文作業領域は owner-only。成功・失敗時 cleanup。異常終了や電源断後は起動前にこの専用領域だけを確認し、必要な暗号 snapshot が残ることを確認後に手動で除去します。暗号化ボリュームの利用を推奨します。

## 削除

1. このプロジェクトが起動したサーバー／CLI を終了します。
2. 残したいレポート、暗号 snapshot、復号鍵を別々に退避し、復号試験を実施します。鍵紛失時の復旧は保証できません。
3. 該当の run または snapshot ディレクトリをファイル管理ツールで選択して削除します。SQLite index の再構築・期限一括削除UIは未実装です。
4. アンインストールは Chrome 拡張の削除後に**この専用ディレクトリだけ**を削除します。グローバルな node、npm、他案件のファイルは対象外です。

この実装作業ではユーザーの既存データの削除は行っていません。デモコードが削除するのは自身で生成した一時コピーだけです。

## 更新と戻し方

変更前にソースと pnpm-lock.yaml、保存済み artifacts を退避します。別ディレクトリで `--frozen-lockfile --ignore-scripts` を使い、型検査と受け入れ試験を実行します。schemaVersion は1.0のみ。未知 major・追加フィールドを拒否し、元の証拠を書換えません。

更新失敗時は保存したソースと lockfile を別ディレクトリに戻してインストールし、既存 evidence を読み込みます。SQLite は schema version 1 のみで、上位 schema からの自動ロールバックはありません。実アップグレード／ロールバック試験は `COM-P104 NOT_RUN` です。

## RepoVault 復旧

`restore-plan` は暗号・内部 hash・構造を確認し、snapshot digest、空の対象、必要容量、除外 scope、30分の期限を記録します。`restore` は全条件を再検査し、隣接する一時ディレクトリへ展開して Git fsck と refs 一致を実行します。正常確認後に空の対象へ移動します。元 repo の checkout・設定・履歴を変更しません。

復旧物の `report.html` と `restore-result.json` が実結果です。選択 scope が欠けていれば `PARTIAL` です。サーバーは自動起動せず、復旧したソースの install/build/script も実行しません。

## 承認が必要な次の段階

実顧客データ・本番 repo、外部資格情報、永続アクセス、GitHub 実接続、公開、課金、拡張ストア申請、リモートへの書込み／送信は、この成果物と対象権限を提示してから別途承認が必要です。現在のコードにそれらの成功実績はありません。

# Cloud continuation updates (current precedence)

The original sections above describe the earlier milestone. Current behavior:

- The comparison service has a two-run queue, registered trusted project, idempotency keys and cancellation. Closing awaits job cleanup; do not kill unrelated processes. `scripts/serve-changeproof.ts` is the UI/API entrypoint.
- `--dirty-snapshot` is now supported explicitly. Frozen bytes and manifest identify the working tree independently of headSha. Never substitute a committed run for a dirty snapshot.
- RepoVault `capture-api`/`resume` now support synthetic loopback transport and encrypted checkpoints. Every checkpoint is immutable and can remain for explicit recovery. Old checkpoints are not silently deleted. Keep identity separate from snapshot/checkpoint storage.
- To recover from transport failure, inspect partial coverage, fix the synthetic source, then resume using the latest confirmed encrypted checkpoint or snapshot. A checkpoint write failure aborts the operation; it is not reported as a network failure.
- On source/destination/identity mismatch, stop and choose the correct original source, key and empty destination. Do not bypass integrity/plan checks.
- age installer supports Linux x86_64 and macOS arm64 at fixed v1.3.2 checksums. No global installation. Runtime age keys and browser profiles are excluded from delivery.
- Cloud runtime can serve HTTP loopback, but actual Chromium launch is BLOCKED. Run browser QA only after environment repair; do not weaken its assertions or reuse previous OS screenshots.
- Current result files are artifacts/acceptance-results.json, artifacts/unit-results.json, artifacts/clean-install-validation.json and the latest-repovault-http.txt target. Source/demo/evidence bundle contains only current-cloud evidence.
