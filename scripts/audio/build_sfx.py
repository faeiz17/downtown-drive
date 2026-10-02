#!/usr/bin/env python3
"""
Cut the recorded sound effects (all CC0, from Freesound) into game-ready mono WAV files in public/audio/:
  rain.wav      seamless loop of steady rain                 #156994 "Rain.wav" by chrscrwfrd18
  squeal.wav    seamless loop of a sustained tyre squeal     #71739 "Chrysler LHS tire squeal 04" by audible-edge
  backfire.wav  one exhaust bang                             #105351 "BACKFIRE" by CeebFrack
  nitro.wav     nitrous purge / whoosh                       #404333 "Nitro Activation" by strexet
  thunder.wav   one long roll of distant thunder             #581125 "Distant Thunder 4" by Fission9
WAV (not MP3/AAC) because lossy encoders pad the start and end, which breaks seamless loops.

  python3 scripts/audio/build_sfx.py        (needs numpy and ffmpeg)
"""
import os, struct, subprocess
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
SRC = os.path.join(ROOT, 'assets-src/audio')
OUT = os.path.join(ROOT, 'public/audio')


def load(name, sr):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(SRC, name), '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def save(name, y, sr, peak=0.9):
    y = y * (peak / max(np.max(np.abs(y)), 1e-9))
    pcm = np.clip(np.round(y * 32767), -32768, 32767).astype('<i2').tobytes()
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), 'wb') as fh:
        fh.write(b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, sr, sr * 2, 2, 16) + b'data' + struct.pack('<I', len(pcm)) + pcm)
    print(f'  {name}: {len(y) / sr:.2f} s, {len(pcm) / 1e3:.0f} kB')


def loop(x, sr, start, seconds, fade):
    """Seamless loop of noise-like material: the tail is cross-faded (equal power) into the head."""
    i0, n, f = int(start * sr), int(seconds * sr), int(fade * sr)
    y = x[i0:i0 + n + f].copy()
    a = np.linspace(0, 1, f)
    y[:f] = y[:f] * np.sin(a * np.pi / 2) + y[n:n + f] * np.cos(a * np.pi / 2)
    return y[:n]


def one_shot(x, sr, start, seconds, fade_in=0.004, fade_out=0.15):
    i0, n = int(start * sr), int(seconds * sr)
    y = x[i0:i0 + n].copy()
    fi, fo = max(1, int(fade_in * sr)), max(1, int(fade_out * sr))
    y[:fi] *= np.linspace(0, 1, fi)
    y[-fo:] *= np.linspace(1, 0, fo) ** 2
    return y


def highpass(x, sr, hz):
    """One-pole high-pass (removes rumble / DC under the rain and squeal)."""
    a = np.exp(-2 * np.pi * hz / sr)
    y = np.empty_like(x)
    lp = 0.0
    for i in range(len(x)):
        lp = a * lp + (1 - a) * x[i]
        y[i] = x[i] - lp
    return y


def main():
    sr = 32000
    save('rain.wav', loop(highpass(load('freesound-156994-chrscrwfrd18-rain.mp3', sr), sr, 120), sr, 12.5, 6.0, 1.2), sr, 0.6)
    save('squeal.wav', loop(highpass(load('freesound-71739-audible-edge-tire-squeal-04.mp3', sr), sr, 300), sr, 11.3, 1.9, 0.35), sr, 0.8)
    save('backfire.wav', one_shot(load('freesound-105351-CeebFrack-backfire.mp3', sr), sr, 0.0, 0.85, 0.001, 0.4), sr)
    save('nitro.wav', one_shot(load('freesound-404333-strexet-nitro-activation.mp3', sr), sr, 0.0, 2.45, 0.004, 0.5), sr)
    save('thunder.wav', one_shot(load('freesound-581125-Fission9-distant-thunder-4.mp3', 22050), 22050, 3.6, 7.6, 0.2, 2.5), 22050)


if __name__ == '__main__':
    main()
