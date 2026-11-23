"""Build the independent image-based book from reviewed, page-traceable crops.

No OCR transcription is shown in the published book. Original PDFs and OCR
working files are archived locally, not copied into the public site.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse
import hashlib
import json
from PIL import Image, ImageDraw


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def question_placements(coordinates):
    # Facing source pages differ by 70 px. Retain each crop's indentation
    # relative to that page's text column, including option-only continuations.
    normalized = [item['bbox'][0] - (293 if item['page'] % 2 == 0 else 363) for item in coordinates]
    left = min(normalized)
    return [x - left for x in normalized]


def remove_advertising(image, entries, crop_box, page_size):
    applied = []
    draw = ImageDraw.Draw(image)
    for entry in entries:
        rect = entry['rectPx']
        assert len(rect) == 4 and all(isinstance(n, int) for n in rect)
        assert 0 <= rect[0] < rect[2] <= page_size[0] and 0 <= rect[1] < rect[3] <= page_size[1]
        clipped = [max(rect[0], crop_box[0]), max(rect[1], crop_box[1]), min(rect[2], crop_box[2]), min(rect[3], crop_box[3])]
        if clipped[0] >= clipped[2] or clipped[1] >= clipped[3]:
            continue
        local = [clipped[0]-crop_box[0], clipped[1]-crop_box[1], clipped[2]-crop_box[0], clipped[3]-crop_box[1]]
        draw.rectangle((local[0], local[1], local[2]-1, local[3]-1), fill='white')
        applied.append({'rectPx': rect, 'cropRectPx': local, 'kind': entry['kind']})
    return applied


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'data' / 'zhanggong')
    parser.add_argument('--reuse-question-images', action='store_true', help='Reuse already rendered clean images; run the full pixel verifier after rebuilding.')
    parser.add_argument('--reuse-answer-images', action='store_true', help='Reuse an answer image only when its decoded RGB pixels match the source crop exactly.')
    parser.add_argument('--ad-plan', type=Path)
    args = parser.parse_args()
    clean = read_json(args.work / 'questions-candidate.json')['questions']
    answers = {item['id']: item for item in read_json(args.work / 'answers-candidate.json')['questions']}
    independent = read_json(args.work / 'root-answer-key.json')
    ad_plan = read_json(args.ad_plan or args.work / 'ads-removal-plan.json')
    assert ad_plan['coordinateSystem'] == 'source-page-pixels'
    assert len(clean) == len(answers) == 304
    assert len({item['id'] for item in clean}) == 304
    for year, count in [(2026, 115), (2025, 189)]:
        rows = [item for item in clean if item['year'] == year]
        assert [item['originalNumber'] for item in rows] == list(range(1, count + 1))
        assert len(''.join(independent[str(year)])) == count
    for folder in ['questions', 'answers']:
        (args.output / folder).mkdir(parents=True, exist_ok=True)

    def build(row):
        qid = row['id']
        year, original = row['year'], row['originalNumber']
        answer = answers[qid]
        assert answer.get('cropVerification') == 'boundary-and-marginal-annotation-visually-reviewed', qid
        assert answer['correctOption'] == ''.join(independent[str(year)])[original - 1], qid
        assert answer['images'], qid
        assert not answer['flags'] or answer.get('sourceNotice'), qid
        parts, question_ads = [], []
        for index, item in enumerate(row['source']['pageCoordinates'], 1):
            with Image.open(args.work / item['relativeImage']) as image:
                image = image.convert('RGB')
                entries = [entry for entry in ad_plan['questionEntries'] if entry['qid'] == qid and entry['part'] == index]
                applied = remove_advertising(image, entries, item['bbox'], item['imageSize'])
                parts.append(image)
                question_ads.append(applied)
        assert parts, qid
        # Preserve source pixel scale, even when a continuation contains only options.
        offsets = question_placements(row['source']['pageCoordinates'])
        width = max(offset + image.width for offset, image in zip(offsets, parts))
        height = sum(image.height for image in parts) + 16 * (len(parts) - 1)
        merged = Image.new('RGB', (width, height), 'white')
        top = 0
        placements = []
        for offset, image in zip(offsets, parts):
            merged.paste(image, (offset, top))
            placements.append({'pasteX': offset, 'pasteY': top})
            top += image.height + 16
        filename = qid + '.webp'
        question_destination = args.output / 'questions' / filename
        reuse_question = False
        if args.reuse_question_images and question_destination.exists():
            with Image.open(question_destination) as existing:
                reuse_question = existing.size == merged.size and existing.convert('RGB').tobytes() == merged.tobytes()
        if not reuse_question:
            merged.save(args.output / 'questions' / filename, 'WEBP', lossless=True, method=6)
        references, answer_audit = [], []
        for index, item in enumerate(answer['images'], 1):
            filename_answer = f'{qid}-{index}.webp'
            archived_crop = args.work / 'answers-crops' / Path(item['file']).name
            with Image.open(archived_crop if archived_crop.exists() else item['file']) as image:
                image = image.convert('RGB')
                entries = [entry for entry in ad_plan['answerEntries'] if entry['qid'] == qid and entry['part'] == index]
                applied_ads = remove_advertising(image, entries, item['rectPx'], [item['pageWidthPx'], item['pageHeightPx']])
                destination = args.output / 'answers' / filename_answer
                reuse = False
                if args.reuse_answer_images and destination.exists():
                    with Image.open(destination) as existing:
                        reuse = existing.size == image.size and existing.convert('RGB').tobytes() == image.tobytes()
                if not reuse:
                    image.save(destination, 'WEBP', lossless=True, method=6)
                references.append({'file': filename_answer, 'width': image.width, 'height': image.height, 'page': item['pdfPage'], 'caption': f"笔记{item['note']} · {year}年原书第{original}题"})
            answer_audit.append({key: value for key, value in item.items() if key != 'file'} | {'file': filename_answer, 'advertisingRemoved': applied_ads})
        ordinal = row['ordinal']
        question = {
            'id': qid, 'source': '张弓', 'album': '张弓选词大典',
            'paper': f'第{(ordinal - 1) // 20 + 1:02d}套', 'number': ordinal,
            'stem': f'{year}年选词填空 · 原书第{original}题',
            'options': ['A', 'B', 'C', 'D'],
            'answer': 'ABCD'.index(answer['correctOption']), 'answerLetter': answer['correctOption'],
            'explanation': '', 'referenceMode': 'original-annotated', 'questionRenderMode': 'image',
            'questionImage': {'file': filename, 'width': width, 'height': height, 'page': row['source']['pages'][0], 'caption': f"{year}年原书第{original}题 · 讲义第{'、'.join(map(str, row['source']['pages']))}页"},
            'referenceImages': references,
            'sourceQuestion': {'year': year, 'number': original, 'pages': row['source']['pages']}
        }
        if answer.get('sourceNotice'):
            question['sourceNotice'] = answer['sourceNotice']
        audit = {
            'id': qid, 'year': year, 'number': original,
            'answerLetter': question['answerLetter'], 'answerSource': answer['answerSource'],
            'questionCrops': [{key: value for key, value in item.items() if key != 'sourceRows'} | {'advertisingRemoved': question_ads[index], 'columnLeft': 293 if item['page'] % 2 == 0 else 363, **placements[index]} for index, item in enumerate(row['source']['pageCoordinates'])],
            'answerCrops': answer_audit,
            'sourceNotice': answer.get('sourceNotice', '')
        }
        return question, audit

    with ThreadPoolExecutor(max_workers=3) as pool:
        built = list(pool.map(build, clean))
    questions = [item[0] for item in built]
    assert [item['number'] for item in questions] == list(range(1, 305))
    papers = [{'id': f'zg-{i:02d}', 'name': f'第{i:02d}套', 'count': sum(q['paper'] == f'第{i:02d}套' for q in questions)} for i in range(1, 17)]
    album = {'id': 'zhanggong', 'source': '张弓', 'title': '张弓选词大典', 'subtitle': '2026年115题＋2025年189题；每套20题，末套4题', 'accent': '#2878e8', 'referenceMode': 'original-annotated', 'papers': papers, 'count': 304}
    bank = {'appName': '小天爱刷题', 'version': '20261123-10', 'albums': [album], 'questions': questions, 'stats': {'questionCount': 304, 'paperCount': 16, 'albumCount': 1}}
    (args.output / 'questions.json').write_text(json.dumps(bank, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    sources = [{'file': file.name, 'bytes': file.stat().st_size, 'sha256': digest(file)} for file in sorted(args.source_root.glob('*.pdf'))]
    assert len(sources) == 14
    assets = [{'file': file.relative_to(args.output).as_posix(), 'bytes': file.stat().st_size, 'sha256': digest(file)} for folder in ['questions', 'answers'] for file in sorted((args.output / folder).glob('*.webp'))]
    manifest = {'book': album['title'], 'sourceFiles': sources, 'answerKey': {str(year): ''.join(independent[str(year)]) for year in [2026, 2025]}, 'policy': 'Original question and annotated answer images, with reviewed promotional QR codes and branding removed from published copies. Source PDFs and crops remain intact. OCR is excluded from production content. Printed answer tables were independently transcribed twice; a source discrepancy is disclosed on the affected question.', 'questions': [item[1] for item in built], 'assets': assets}
    (args.output / 'ad-removal.json').write_text(json.dumps(ad_plan, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (args.output / 'source-audit.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    alignment_audit = read_json(args.work / 'alignment-audit.json')
    (args.output / 'alignment-audit.json').write_text(json.dumps(alignment_audit, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'questions': len(questions), 'papers': len(papers), 'questionImages': len(questions), 'answerImages': sum(len(q['referenceImages']) for q in questions), 'assetBytes': sum(item['bytes'] for item in assets), 'sourceFiles': len(sources)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
