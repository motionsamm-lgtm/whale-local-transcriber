"""Optional offline speaker diarization, with models cached per user."""
import shutil
import tarfile
import tempfile
from pathlib import Path

BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download'
SEGMENTATION = 'sherpa-onnx-pyannote-segmentation-3-0'
EMBEDDING = '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx'


def get_model(cache, filename, url, member=None):
    import requests

    target = cache / filename
    if target.is_file() and target.stat().st_size:
        return target
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache) as temp:
        download = Path(temp) / 'download'
        with requests.get(url, timeout=(15, 60), stream=True) as response:
            response.raise_for_status()
            size = 0
            with download.open('wb') as output:
                for block in response.iter_content(256 * 1024):
                    size += len(block)
                    if size > 128 * 1024 * 1024:
                        raise ValueError('Speaker model download is unexpectedly large.')
                    output.write(block)
        if member:
            extracted = Path(temp) / 'model'
            with tarfile.open(download, 'r:bz2') as archive:
                entry = archive.getmember(member)
                if not entry.isfile() or not 0 < entry.size <= 128 * 1024 * 1024:
                    raise ValueError('Invalid speaker model archive.')
                with archive.extractfile(entry) as source, extracted.open('wb') as output:
                    shutil.copyfileobj(source, output)
            download = extracted
        if not download.stat().st_size:
            raise ValueError('Empty speaker model download.')
        download.replace(target)
    return target


def analyze(filename, cache, emit, speaker_count=-1):
    import sherpa_onnx as sherpa
    from faster_whisper.audio import decode_audio

    emit(stage='speakers', message='Preparing speaker models')
    segmentation = get_model(cache, 'segmentation.onnx',
                             f'{BASE}/speaker-segmentation-models/{SEGMENTATION}.tar.bz2',
                             f'{SEGMENTATION}/model.onnx')
    embedding = get_model(cache, EMBEDDING, f'{BASE}/speaker-recongition-models/{EMBEDDING}')
    config = sherpa.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(segmentation))
        ),
        embedding=sherpa.SpeakerEmbeddingExtractorConfig(model=str(embedding)),
        clustering=sherpa.FastClusteringConfig(num_clusters=speaker_count, threshold=0.5),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    if not config.validate():
        raise RuntimeError('Speaker model configuration could not be loaded.')
    engine = sherpa.OfflineSpeakerDiarization(config)
    emit(stage='speakers', message='Detecting speakers')
    samples = decode_audio(filename, sampling_rate=engine.sample_rate)
    return engine.process(samples).sort_by_start_time()


def label_chunks(chunks, turns):
    """Assign each timed word to the speaker with the most overlap."""
    output = []
    names = {}

    def speaker_for(start, end, candidates):
        scores = {}
        for turn in candidates:
            duration = max(0, min(end, turn.end) - max(start, turn.start))
            if duration:
                scores[turn.speaker] = scores.get(turn.speaker, 0) + duration
        if not scores:
            return None
        ranked = sorted(scores, key=scores.get, reverse=True)
        if len(ranked) > 1 and abs(scores[ranked[0]] - scores[ranked[1]]) < 0.01:
            return None
        return names.setdefault(ranked[0], f'Speaker {len(names) + 1}')

    first = 0
    for chunk in chunks:
        while first < len(turns) and turns[first].end <= chunk['start']:
            first += 1
        candidates = []
        for index in range(first, len(turns)):
            turn = turns[index]
            if turn.start >= chunk['end']:
                break
            candidates.append(turn)
        words = chunk.get('words') or []
        if not words or ''.join(word['text'] for word in words).strip() != chunk['text']:
            output.append({**chunk, 'speaker': speaker_for(chunk['start'], chunk['end'], candidates)})
            continue
        group = None
        for word in words:
            speaker = speaker_for(word['start'], word['end'], candidates)
            if group is None or group['speaker'] != speaker:
                group = {**word, 'speaker': speaker}
                output.append(group)
            else:
                group['end'] = word['end']
                group['text'] += word['text']
    return [{k: v.strip() if k == 'text' else v for k, v in line.items() if k != 'words'}
            for line in output if line['text'].strip()]
