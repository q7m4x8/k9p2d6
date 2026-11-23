"""Build the independent image-based book from reviewed, page-traceable crops.

No OCR transcription is shown in the published book. Original PDFs and OCR
working files are archived locally, not copied into the public site.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse
import hashlib
import json
from PIL import Image


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'data' / 'zhanggong')
    parser.add_argument('--reuse-question-images', action='store_true', help='Reuse already rendered clean images; run the full pixel verifier after rebuilding.')
    parser.add_argument('--reuse-answer-images', action='store_true', help='Reuse an answer image only when its decoded RGB pixels match the source crop exactly.')
    args = parser.parse_args()
    clean = read_json(args.work / 'questions-candidate.json')['questions']
    answers = {item['id']: item for item in read_json(args.work / 'answers-candidate.json')['questions']}
    independent = read_json(args.work / 'root-answer-key.json')
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
        parts = []
        for item in row['source']['pageCoordinates']:
            with Image.open(args.work / item['relativeImage']) as image:
                parts.append(image.convert('RGB'))
        assert parts, qid
        # Preserve source pixel scale, even when a continuation contains only options.
        width = max(image.width for image in parts)
        height = sum(image.height for image in parts) + 16 * (len(parts) - 1)
        merged = Image.new('RGB', (width, height), 'white')
        top = 0
        for image in parts:
            merged.paste(image, (0, top))
            top += image.height + 16
        filename = qid + '.webp'
        if not args.reuse_question_images or not (args.output / 'questions' / filename).exists():
            merged.save(args.output / 'questions' / filename, 'WEBP', lossless=True, method=6)
        references, answer_audit = [], []
        for index, item in enumerate(answer['images'], 1):
            filename_answer = f'{qid}-{index}.webp'
            archived_crop = args.work / 'answers-crops' / Path(item['file']).name
            with Image.open(archived_crop if archived_crop.exists() else item['file']) as image:
                image = image.convert('RGB')
                destination = args.output / 'answers' / filename_answer
                reuse = False
                if args.reuse_answer_images and destination.exists():
                    with Image.open(destination) as existing:
                        reuse = existing.size == image.size and existing.convert('RGB').tobytes() == image.tobytes()
                if not reuse:
                    image.save(destination, 'WEBP', lossless=True, method=6)
                references.append({'file': filename_answer, 'width': image.width, 'height': image.height, 'page': item['pdfPage'], 'caption': f"笔记{item['note']} · {year}年原书第{original}题"})
            answer_audit.append({key: value for key, value in item.items() if key != 'file'} | {'file': filename_answer})
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
            'questionCrops': [{key: value for key, value in item.items() if key != 'sourceRows'} for item in row['source']['pageCoordinates']],
            'answerCrops': answer_audit,
            'sourceNotice': answer.get('sourceNotice', '')
        }
        return question, audit

    with ThreadPoolExecutor(max_workers=3) as pool:
        built = list(pool.map(build, clean))
    questions = [item[0] for item in built]
    assert [item['number'] for item in questions] == list(range(1, 305))
    papers = [{'id': f'zg-{i:02d}', 'name': f'第{i:02d}套', 'count': sum(q['paper'] == f'第{i:02d}套' for q in questions)} for i in range(1, 17)]
    album = {'id': 'zhanggong', 'source': '张弓', 'title': '张弓选词大典', 'subtitle': '每套20题，交卷查看老师原版批注；最后一套4题', 'accent': '#2878e8', 'referenceMode': 'original-annotated', 'papers': papers, 'count': 304}
    bank = {'appName': '小天爱刷题', 'version': '20261123-8', 'albums': [album], 'questions': questions, 'stats': {'questionCount': 304, 'paperCount': 16, 'albumCount': 1}}
    (args.output / 'questions.json').write_text(json.dumps(bank, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    sources = [{'file': file.name, 'bytes': file.stat().st_size, 'sha256': digest(file)} for file in sorted(args.source_root.glob('*.pdf'))]
    assert len(sources) == 14
    assets = [{'file': file.relative_to(args.output).as_posix(), 'bytes': file.stat().st_size, 'sha256': digest(file)} for folder in ['questions', 'answers'] for file in sorted((args.output / folder).glob('*.webp'))]
    manifest = {'book': album['title'], 'sourceFiles': sources, 'answerKey': {str(year): ''.join(independent[str(year)]) for year in [2026, 2025]}, 'policy': 'Original question and annotated answer images. OCR is excluded from production content. Printed answer tables were independently transcribed twice; a source discrepancy is disclosed on the affected question.', 'questions': [item[1] for item in built], 'assets': assets}
    (args.output / 'source-audit.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'questions': len(questions), 'papers': len(papers), 'questionImages': len(questions), 'answerImages': sum(len(q['referenceImages']) for q in questions), 'assetBytes': sum(item['bytes'] for item in assets), 'sourceFiles': len(sources)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
