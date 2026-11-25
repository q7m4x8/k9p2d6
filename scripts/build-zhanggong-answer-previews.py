"""Build smaller browser previews without modifying the annotated source crops."""

from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


ROOT = Path(__file__).resolve().parents[1] / 'data' / 'zhanggong'
ORIGINALS = ROOT / 'answers'
PREVIEWS = ROOT / 'answer-previews'


def preview_bytes(image, quality):
    with BytesIO() as output:
        image.save(output, format='WEBP', quality=quality, method=4)
        return output.getvalue()


def image_errors(original, encoded, ink_mask):
    with Image.open(BytesIO(encoded)) as preview:
        if preview.size != original.size:
            raise ValueError('Preview dimensions do not match its source')
        difference = ImageChops.difference(original, preview.convert('RGB'))
    full_rms = ImageStat.Stat(difference).rms
    ink_rms = ImageStat.Stat(difference, mask=ink_mask).rms if ink_mask.getbbox() else full_rms
    return tuple(math.sqrt(sum(value ** 2 for value in rms) / 3) for rms in (full_rms, ink_rms))


def build_preview(metadata):
    name = metadata['file']
    source = ORIGINALS / name
    with Image.open(source) as original:
        if original.size != (metadata['width'], metadata['height']):
            raise ValueError(f'{name}: source dimensions do not match the question bank')
        image = original.convert('RGB')
    byte_count = source.stat().st_size
    ink_mask = image.convert('L').point(lambda value: 255 if value < 220 else 0)

    # Measure the ink separately so white margins cannot conceal text degradation.
    # Keep the original when encoding cannot save bytes without smudging the notes.
    for quality in (88, 93):
        preview = preview_bytes(image, quality)
        full_error, ink_error = image_errors(image, preview, ink_mask)
        if full_error <= 4 and ink_error <= 10 and len(preview) < byte_count:
            break
    else:
        preview = source.read_bytes()
        full_error, ink_error, quality = 0, 0, 'original'

    (PREVIEWS / name).write_bytes(preview)
    return {
        'file': name, 'sourceBytes': byte_count, 'previewBytes': len(preview),
        'psnr': round(20 * math.log10(255 / full_error), 2) if full_error else None,
        'inkRms': round(ink_error, 2), 'quality': quality,
    }


def main():
    with (ROOT / 'questions.json').open(encoding='utf-8') as source:
        question_bank = json.load(source)
    references = {
        image['file']: image
        for question in question_bank['questions']
        for image in question['referenceImages']
    }
    if references.keys() != {source.name for source in ORIGINALS.glob('*.webp')}:
        raise ValueError('The question bank and the original answer folder disagree')
    PREVIEWS.mkdir(exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(build_preview, references.values()))

    source_bytes = sum(result['sourceBytes'] for result in results)
    preview_bytes_total = sum(result['previewBytes'] for result in results)
    print(json.dumps({
        'images': len(results), 'originalBytes': source_bytes, 'previewBytes': preview_bytes_total,
        'bytesReducedPercent': round(100 * (1 - preview_bytes_total / source_bytes), 1),
        'minPsnr': min((result['psnr'] for result in results if result['psnr'] is not None), default=None),
        'maxInkRms': max(result['inkRms'] for result in results),
        'highQualityCount': sum(result['quality'] == 93 for result in results),
        'originalCopyCount': sum(result['quality'] == 'original' for result in results),
        'samples': [result for result in results if result['file'] in {'zg-2026-001-1.webp', 'zg-2026-002-1.webp'}],
    }))


if __name__ == '__main__':
    main()
