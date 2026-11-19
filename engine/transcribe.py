import argparse, json, os, sys
import re
from pathlib import Path

MODES = {
    # Turbo is a fast large-v3 derivative; Dolphin and Whale use full large-v3.
    'cheetah': {'model': 'large-v3-turbo', 'beam': 1},
    'dolphin': {'model': 'large-v3', 'beam': 3},
    'whale': {'model': 'large-v3', 'beam': 5},
}

def normalize_segment(text):
    """Normalize text for detecting a decoder repeating the same segment."""
    return re.sub(r'[^\w]+', '', text.casefold(), flags=re.UNICODE)

def emit(**data):
    print(json.dumps(data, ensure_ascii=False), flush=True)

_dll_directory_handles = []

def expose_nvidia_runtime():
    """Make NVIDIA pip-wheel DLLs visible to CTranslate2 on Windows, if installed."""
    if os.name != 'nt':
        return
    nvidia_roots = [Path(sys.prefix) / 'Lib' / 'site-packages' / 'nvidia']
    # PyInstaller stores collected package files under _MEIPASS in the frozen build.
    if getattr(sys, '_MEIPASS', None):
        nvidia_roots.append(Path(sys._MEIPASS) / 'nvidia')
    dll_dirs = [p for root in nvidia_roots if root.exists() for p in root.rglob('bin') if p.is_dir()]
    for dll_dir in dll_dirs:
        os.environ['PATH'] = str(dll_dir) + os.pathsep + os.environ.get('PATH', '')
        try:
            _dll_directory_handles.append(os.add_dll_directory(str(dll_dir)))
        except (AttributeError, OSError):
            pass

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--file'); p.add_argument('--mode', choices=MODES, default='whale')
    p.add_argument('--language', default='auto'); p.add_argument('--outdir')
    p.add_argument('--check', action='store_true', help='verify bundled transcription dependencies')
    args = p.parse_args()
    expose_nvidia_runtime()
    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        print(f'Could not load faster-whisper: {e}', file=sys.stderr); return 2
    if args.check:
        emit(stage='check', message='Bundled transcription dependencies loaded.')
        return 0
    if not args.file or not args.outdir:
        p.error('--file and --outdir are required unless --check is used')

    cfg = MODES[args.mode]
    emit(stage='loading', message=f'Loading {cfg["model"]} locally…')
    device = 'cuda'
    try:
        model = WhisperModel(cfg['model'], device='cuda', compute_type='float16')
    except Exception as gpu_error:
        emit(stage='loading', message='GPU setup unavailable; loading the same model on CPU…')
        device = 'cpu'
        try: model = WhisperModel(cfg['model'], device='cpu', compute_type='int8')
        except Exception as e:
            print(f'Could not load model (GPU: {gpu_error}; CPU: {e})', file=sys.stderr); return 3

    language = None if args.language.lower() == 'auto' else args.language
    emit(stage='transcribing', message='Listening to the recording…')
    def transcribe_with(active_model):
        segments, info = active_model.transcribe(
            args.file, language=language, task='transcribe', beam_size=cfg['beam'],
            vad_filter=True, vad_parameters={'min_silence_duration_ms': 500},
            # Long-form context can trap Whisper in a repeat loop. Turning this off
            # is the upstream-recommended mitigation and is especially useful here.
            condition_on_previous_text=False, word_timestamps=True,
            compression_ratio_threshold=2.4, log_prob_threshold=-1.0,
            no_speech_threshold=0.6,
            temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0)
        )
        chunks = []
        transcript = []
        recent = []
        warning = None
        for seg in segments:
            segment_text = seg.text.strip()
            normalized = normalize_segment(segment_text)
            # Three identical neighboring segments are almost always a decode loop.
            # Stop before appending the third copy, preserving the actual audio-derived
            # transcript so far and clearly marking that the run ended early.
            if normalized and len(recent) >= 2 and recent[-1] == normalized and recent[-2] == normalized:
                warning = 'Repeated-speech loop detected. Transcription stopped at this point; try the same file again or split around this section.'
                emit(stage='warning', message=warning, seconds=seg.start)
                break
            if normalized:
                recent.append(normalized)
                recent = recent[-2:]
            transcript.append(segment_text)
            chunks.append({'start': seg.start, 'end': seg.end, 'text': segment_text})
            emit(stage='progress', seconds=seg.end, message=f'{int(seg.end)} seconds transcribed')
        return info, chunks, '\n'.join(s for s in transcript if s), warning

    try:
        try:
            info, chunks, text, warning = transcribe_with(model)
        except Exception as gpu_error:
            if device != 'cuda':
                raise
            emit(stage='loading', message='CUDA runtime unavailable; retrying with CPU. This may take longer…')
            model = WhisperModel(cfg['model'], device='cpu', compute_type='int8')
            device = 'cpu'
            info, chunks, text, warning = transcribe_with(model)
        outdir = Path(args.outdir); outdir.mkdir(parents=True, exist_ok=True)
        base = Path(args.file).stem
        txt_path = outdir / f'{base}.txt'; srt_path = outdir / f'{base}.srt'
        txt_path.write_text(text + '\n', encoding='utf-8')
        def stamp(t):
            ms = round(t * 1000); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
            return f'{h:02}:{m:02}:{s:02},{ms:03}'
        srt_path.write_text('\n\n'.join(f'{i}\n{stamp(c["start"])} --> {stamp(c["end"])}\n{c["text"]}' for i,c in enumerate(chunks,1))+'\n', encoding='utf-8')
        emit(stage='done', text=text, chunks=chunks, txt=str(txt_path), srt=str(srt_path), language=info.language, duration=info.duration, device=device, warning=warning)
    except Exception as e:
        print(f'Transcription failed: {e}', file=sys.stderr); return 4
    return 0

if __name__ == '__main__': raise SystemExit(main())
