"""Read this app's embedded JPEG metadata without AI or external packages.

Usage: python tools/read_photo_metadata.py photo.jpg [--json]
"""
import argparse
import json
import struct
import sys


def read_metadata(path):
    with open(path, 'rb') as image:
        if image.read(2) != b'\xff\xd8':
            raise ValueError('JPEGではありません')
        while True:
            marker = image.read(2)
            if len(marker) != 2 or marker[0] != 255:
                raise ValueError('JPEGの構造が不正です')
            if marker[1] == 255:
                image.seek(-1, 1)
                continue
            if marker[1] in (0xDA, 0xD9):
                break
            raw_length = image.read(2)
            if len(raw_length) != 2:
                raise ValueError('JPEGが途中で切れています')
            length = struct.unpack('>H', raw_length)[0]
            if length < 2:
                raise ValueError('JPEGの長さが不正です')
            segment = image.read(length - 2)
            if len(segment) != length - 2:
                raise ValueError('JPEGが途中で切れています')
            if marker[1] != 0xE1 or not segment.startswith(b'Exif\0\0'):
                continue
            data = segment[6:]
            endian = '<' if data[:2] == b'II' else '>' if data[:2] == b'MM' else None
            if not endian or len(data) < 8:
                continue

            def number(offset, kind):
                size = struct.calcsize(kind)
                if offset < 0 or offset + size > len(data):
                    raise ValueError('EXIFの範囲が不正です')
                return struct.unpack_from(endian + kind, data, offset)[0]

            def find_ifd(offset, tag):
                count = number(offset, 'H')
                if count > 1000 or offset + 2 + count * 12 + 4 > len(data):
                    raise ValueError('EXIF項目数が不正です')
                for i in range(count):
                    position = offset + 2 + i * 12
                    if number(position, 'H') == tag:
                        return position
                return None

            if number(2, 'H') != 42:
                continue
            pointer = find_ifd(number(4, 'I'), 0x8769)
            if pointer is None:
                continue
            entry = find_ifd(number(pointer + 8, 'I'), 0x9286)
            if entry is None:
                continue
            count = number(entry + 4, 'I')
            offset = entry + 8 if count <= 4 else number(entry + 8, 'I')
            if offset + count > len(data):
                raise ValueError('EXIFコメントの範囲が不正です')
            comment = data[offset:offset + count]
            if not comment.startswith(b'ASCII\0\0\0'):
                continue
            try:
                value = json.loads(comment[8:].decode('ascii'))
            except (ValueError, UnicodeError):
                continue
            if isinstance(value, dict) and value.get('application') == 'genba-photo' and value.get('embeddedSchemaVersion') == 1 and isinstance(value.get('metadata'), dict):
                return value['metadata']
    raise ValueError('このアプリの埋め込み情報がありません。アプリの最新版からJPEGを書き出してください')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('photo')
    parser.add_argument('--json', action='store_true', help='管理情報の全項目を標準出力へ表示')
    args = parser.parse_args()
    try:
        metadata = read_metadata(args.photo)
        if args.json:
            print(json.dumps(metadata, ensure_ascii=False, indent=2))
        else:
            for label, key in [('地点', 'site'), ('工種', 'work'), ('写真項目', 'item'), ('撮影日時', 'capturedAt'), ('取込日時', 'importedAt'), ('黒板表示日時', 'boardDate')]:
                print(f'{label}: {metadata.get(key) or "未取得"}')
            gps = metadata.get('gps')
            print(f'GPS: {gps["latitude"]}, {gps["longitude"]}（精度 {gps["accuracy"]}m）' if isinstance(gps, dict) and all(key in gps for key in ('latitude', 'longitude', 'accuracy')) else 'GPS: 未記録')
    except (OSError, ValueError, struct.error) as error:
        print(f'読み取り失敗: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
