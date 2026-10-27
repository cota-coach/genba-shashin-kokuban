# PC連携用データ仕様 v1

1回の保存で、写真IDをキーとして原本・合成画像・管理情報を同じIndexedDBトランザクションに記録します。保存済みの地点・項目は後から設定を変えても変化しません。

## ファイル名

```text
YYYYMMDD__地点名__写真項目__端末ID__写真UUID__board.jpg
YYYYMMDD__地点名__写真項目__端末ID__写真UUID__original.元の拡張子
YYYYMMDD__地点名__写真項目__端末ID__写真UUID.json
```

日付は取り込み操作時の端末のローカル日付です。端末IDは初回起動時に生成する8文字、写真UUIDは保存ごとに生成します。UUIDによって端末間・同日・同項目の衝突を避けます。

地点・項目のファイル名用表記では空白を除去し、Windows禁止文字とアンダースコアをハイフンに置換し、各48文字・UTF-8で60バイトまでとします。入力の全文はJSONに残します。地点名が似ていたり正規化後の表記が同じになったりするため、厳密な振り分けにはJSONの地点名も使用してください。端末内のsiteIdは端末ごとの値で、複数端末の共通地点IDではありません。

## JSON

`schemaVersion: 1`。`id` は写真UUID。`siteId`, `site`, `work`, `item`, `deviceId` を記録します。`theme`, `position`, `size`, `dateMode`, `boardDate` は合成時の黒板設定です。

`importedAt` と `savedAt` はUTCのISO8601文字列。`boardDate` はタイムゾーンを含まない黒板表示用のローカル日時文字列です。日時修正は `boardDate` のみを変えます。`capturedAt` は未取得なので `null`、`dateSource` は `device-import-time`。撮影日時が検証済みだと解釈しないでください。

`width`, `height` はブラウザでデコードした画像の向きに対応するピクセル寸法。`originalName`, `originalType`, `originalFile`, `composedFile`, `metadataFile` を持ちます。

## 将来のPython仕分け

画像認識や黒板OCRは不要です。JSONまたはファイル名から分類し、まずコピーと事前確認一覧の方式で実装します。未知の仕様、不正なパス、欠損、重複、名前衝突は確認待ちへ分け、元写真を削除しません。写真アプリを経由するとファイル名が変わる場合があるため、PCへの受け渡しはファイル書き出しを基本とします。

Excel側は、実帳票の写真枠・シート名・既存VBAを調査してから対応表を決めます。この試作ではExcelを変更しません。
