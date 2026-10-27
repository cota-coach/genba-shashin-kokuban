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

v0.3.0では `boardX`, `boardY` を追加します。値が `null` または存在しない場合は従来の `position` の四隅を使用します。値がある場合は0〜1で、黒板の移動可能範囲に対する横・縦の相対位置です（0が左／上、1が右／下）。画像外へはみ出さず、映像の縦横比・保存サイズが変わっても同じ相対位置になります。`size` は画像幅に対する黒板幅の指定割合で、縦長さには画像内へ収まる上限を設けています。これらは画像の中の黒板位置であり、GPS位置ではありません。

v0.4.0では `recordedDate`（`YYYYMMDD`）を追加し、撮影／取込操作時の端末ローカル日付を保存します。旧データの日別グループは `composedFile` の日付部分を使用し、判定できなければ「日付不明」とします。黒板の表示日時を手動変更しても、このグループの日付は変えません。

`importedAt` と `savedAt` はUTCのISO8601文字列。`boardDate` はタイムゾーンを含まない黒板表示用のローカル日時文字列です。日時修正は `boardDate` のみを変えます。標準カメラ／画像取り込み時は `capturedAt: null`、`dateSource: device-import-time` です。

v0.2.0では後方互換の追加フィールドとして `source`（`file-import` または `live-camera`）と `originalIsBrowserFrame` を記録します。旧記録では両フィールドがありません。ライブ撮影では `capturedAt` にシャッター操作時の端末時計をUTCで記録し、`dateSource: device-capture-time`、`originalIsBrowserFrame: true` です。ライブ撮影の原本は黒板合成前の動画フレームJPEGです。標準カメラのセンサー原本、EXIF由来の撮影時刻とは異なります。日時は第三者が検証済みだと解釈しないでください。

v0.4.0までは管理情報をアプリ内IndexedDBと別ファイルのJSONに保持していました。v0.5.0以降は書き出す合成JPEGのEXIFにも埋め込み、画像単体から読み取れます。旧保存写真は書き出すコピーで対応します。「保存写真」→「仕分け用データを確認」で既存保存写真も含めて確認できます。

`width`, `height` はブラウザでデコードした画像の向きに対応するピクセル寸法。`originalName`, `originalType`, `originalFile`, `composedFile`, `metadataFile` を持ちます。

## ZIP書き出し

v0.4.0以降は日付／地点単位のZIPを生成できます。ZIP STORE形式（非再圧縮）、UTF-8ファイル名、各ファイルのCRC32を使用します。サーバー送信はありません。出力上限は250MiBです。

`日付/地点名_識別用ID/` の直下に合成JPEG、`原本/` に原本、`管理情報/` に管理JSONを配置します。管理JSON内のファイル名は元のベース名のまま維持します。ZIPのルートに `書き出し一覧.json` を置き、`schemaVersion: 1`, `exportedAt`, `photoCount`, `photos` を記録します。各 `photos` 要素には `id`, `day`, `site`, `work`, `item`, `composedPath`, `originalPath`, `metadataPath`（ZIPルートからの相対パス）を持たせます。Python連携ではこの対応表も利用できます。

写真のUUID・端末ID付きファイル名を維持するため、複数端末のZIPを同じ日付フォルダへ展開して統合できます。ただしWindowsの上書き確認が出たら自動上書きせず確認します。書き出し処理はアプリ内の写真を削除しません。書き出しの途中失敗でも、完全なZIPを作成できるまで保存ボタンを有効にしません。

## 将来のPython仕分け

画像認識や黒板OCRは不要です。JSONまたはファイル名から分類し、まずコピーと事前確認一覧の方式で実装します。未知の仕様、不正なパス、欠損、重複、名前衝突は確認待ちへ分け、元写真を削除しません。写真アプリを経由するとファイル名が変わる場合があるため、PCへの受け渡しはファイル書き出しを基本とします。

Excel側は、実帳票の写真枠・シート名・既存VBAを調査してから対応表を決めます。この試作ではExcelを変更しません。

## EXIF埋め込み v1（アプリv0.5.0以降）

`embeddedExifVersion: 1` を持ちます。Exif IFDのUserComment（0x9286、UNDEFINED型）へ8バイトの `ASCII\0\0\0` に続けて、ASCIIへUnicodeエスケープしたJSONを格納します。構造は `{application: "genba-photo", embeddedSchemaVersion: 1, metadata: {...}}` です。管理情報はJSONサイドカーと同じ意味を持ちます。

IFD0のXPTitle（0x9c9b）、XPSubject（0x9c9f）、XPComment（0x9c9c）、XPKeywords（0x9c9e）はUTF-16LE・末尾NULのBYTE列で、日本語に対応します。IFD0のDateTimeは合成写真の保存日時、DateTimeOriginal（0x9003）は取得済みのライブ撮影日時のみ、OffsetTimeOriginal（0x9011）とSubSecTimeOriginal（0x9291）を併記します。元の撮影日時を取得していない取込写真にDateTimeOriginalを捏造しません。`timeZoneOffsetMinutes` と `captureTimeZoneOffsetMinutes` はJavaScriptのgetTimezoneOffset形式（日本は-540）です。

`gps` は未取得時null、取得時は `latitude`, `longitude`, `accuracy`（m）, `recordedAt`（UTC ISO8601）、任意の `altitude`（m）です。`gpsStatus` は `off`, `recorded`, `denied`, `timeout`, `unsupported`, `unavailable`, `invalid`, `not-collected-import`。撮影直後に最大8秒取得を試みるため、座標の取得時刻とシャッター時刻は異なる場合があります。過去写真の地点座標だと解釈しません。

GPS IFDは取得できた場合のみ作成し、Latitude/Longitudeと参照方位、任意のAltitude、測位精度（GPSHPositioningError）、取得UTC時刻を標準タグへ記録します。GPSオフの新規合成JPEGにGPS IFDは作りません。地点名はGPSとは別項目で常に記録します。

JPEGへはAPP1 Exifセグメントを挿入・置換し、画像の圧縮データや他のAPPセグメントは保持します。原本には実行しません。`tools/read_photo_metadata.py` でJPEG単体から管理情報を読み出せます。

## ZIPの内容選択（v0.5.0）

黒板付きJPEG、原本、管理JSONを独立して選びます。JSONを選んだ場合だけサイドカーと書き出し一覧を格納します。全部オフはエラーです。書き出し一覧には `included: {composed, original, json}` を加え、入れない種類のパスはnullとします。JSONなしの場合、ZIPにはJSONファイルが一切入りません。ZIP内のJPEGにも管理情報が埋め込まれます。
