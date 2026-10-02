#!/usr/bin/env python3
"""
Build the engine loop bank from a real recording.

Source: "Import car revs on Chassis Dyno with Turbo" by editboy23 (Freesound #496171, CC0): a turbocharged
straight-six on a chassis dyno, three full-throttle pulls and a slow sweep.

A recording of a pull cannot be looped as it is, because the pitch keeps rising. So:
  1. the firing frequency is tracked through the pulls (autocorrelation, then the phase of the fundamental itself),
  2. for each target frequency a stretch of the pull around that point is "de-chirped": resampled along the
     engine's own phase so the pitch stays constant, keeping the real cycle-to-cycle variation,
  3. the stretch is cut to a whole number of engine cycles and cross-faded into a seamless loop,
  4. low-rpm loops, which the recording does not contain, are made by overlap-adding the individual exhaust pulses
     of the lowest real loop further apart (PSOLA): same pulse, fired less often.
Output: public/audio/engine.wav (all loops back to back, mono 16-bit) + public/audio/engine.json (offsets, firing
frequency of each loop). The game cross-fades between neighbouring loops and fine-tunes pitch with playbackRate.

  python3 scripts/audio/build_engine_loops.py        (needs numpy and ffmpeg)
"""
import json, os, struct, subprocess, sys
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
SRC = os.path.join(ROOT, 'assets-src/audio/freesound-496171-editboy23-import-car-dyno-turbo.mp3')
OUT_WAV = os.path.join(ROOT, 'public/audio/engine.wav')
OUT_JSON = os.path.join(ROOT, 'public/audio/engine.json')
SR = 44100
OUT_SR = 32000
CYL = 6  # the recorded engine: firing pulses per engine cycle

# (target firing frequency in Hz, source window (s) in which the engine passes through it, expected band there)
# The band keeps the tracker on the firing fundamental (an unconstrained search slips to engine-cycle subharmonics).
TARGETS = [
    (118, (2.1, 2.75), (98, 132)), (134, (2.72, 3.2), (112, 160)), (146, (5.0, 5.62), (128, 168)), (163, (11.3, 12.9), (150, 178)),
    # (170–185 Hz is skipped: in every pull that stretch is masked by the turbo coming on boost and does not loop cleanly)
    (190, (9.3, 9.9), (170, 210)), (201, (9.8, 10.35), (182, 220)),
    (207, (10.1, 10.55), (190, 222)), (213, (20.3, 20.8), (192, 232)), (219, (6.8, 7.15), (192, 238)),
]
PSOLA_BASE = 118  # the cleanest low loop: its pulses are re-fired at lower rates for the rpm range the recording lacks
# low-rpm loops synthesised from the lowest real loop (firing frequency in Hz; the game maps rpm/30 → Hz)
LOW = [31, 44, 60, 80, 99]


def load(path, sr=SR):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def track_f0(x, sr, fmin=92, fmax=240, win=0.09, hop=0.01):
    """Firing frequency by normalised autocorrelation on a low-passed copy. Returns (times, f0, confidence)."""
    dec = 8
    k = np.hanning(4 * dec + 1)
    xl = np.convolve(x, k / k.sum(), 'same')[::dec]
    srl = sr / dec
    n = int(win * srl)
    h = max(1, int(hop * srl))
    w = np.hanning(n)
    nfft = 1
    while nfft < 2 * n:
        nfft *= 2
    wa = np.fft.irfft(np.abs(np.fft.rfft(w, nfft)) ** 2)[:n]
    lo, hi = int(srl / fmax), int(srl / fmin)
    ts, fs, cs = [], [], []
    for i in range(0, len(xl) - n, h):
        f = xl[i:i + n]
        f = (f - f.mean()) * w
        S = np.fft.rfft(f, nfft)
        ac = np.fft.irfft(S * np.conj(S))[:n] / np.maximum(wa, 1e-9)
        ac /= max(ac[0], 1e-12)
        seg = ac[lo:hi]
        pk = np.where((seg[1:-1] > seg[:-2]) & (seg[1:-1] >= seg[2:]))[0] + 1
        ts.append((i + n / 2) / srl)
        if len(pk) == 0 or seg[pk].max() <= 0:
            fs.append(0.0)
            cs.append(0.0)
            continue
        best = seg[pk].max()
        c = pk[seg[pk] >= 0.9 * best][0]
        lag = c + lo
        a, b, d = ac[lag - 1], ac[lag], ac[lag + 1]
        off = 0.5 * (a - d) / (a - 2 * b + d) if (a - 2 * b + d) != 0 else 0
        fs.append(srl / (lag + off))
        cs.append(seg[c])
    return np.array(ts), np.array(fs), np.array(cs)


def smooth(v, n):
    k = np.hanning(n)
    return np.convolve(np.pad(v, (n // 2, n // 2), 'edge'), k / k.sum(), 'valid')[:len(v)]


def phase_track(x, sr, t0, t1, band):
    """Phase of the firing fundamental (in cycles) for every sample of x[t0:t1], locked to the signal itself."""
    i0, i1 = int(t0 * sr), int(t1 * sr)
    seg = x[i0:i1]
    tt = np.arange(i0, i1) / sr
    pad = int(0.3 * sr)
    j0 = max(0, i0 - pad)
    ts, fs, _ = track_f0(x[j0:i1 + pad], sr, band[0], band[1])
    ts = ts + j0 / sr
    m = fs > 0
    tm, fm = ts[m], fs[m].copy()
    # robust frequency estimate: throw out octave slips (points far from the running median), then smooth
    med = np.array([np.median(fm[max(0, i - 6):i + 7]) for i in range(len(fm))])
    ok = np.abs(fm - med) < 0.07 * med
    fm = np.interp(tm, tm[ok], fm[ok])
    f = np.interp(tt, tm, smooth(fm, 9))
    ph = np.cumsum(f) / sr
    # heterodyne: remove the estimated rotation, what is left is the slow phase error of the estimate
    z = seg * np.exp(-2j * np.pi * ph)
    n = int(sr * 0.045) | 1
    k = np.hanning(n)
    zl = np.convolve(z, k / k.sum(), 'same')
    theta = np.unwrap(np.angle(zl))
    return tt, ph + theta / (2 * np.pi), f


def interp_cubic(x, pos):
    i = np.floor(pos).astype(int)
    f = pos - i
    i = np.clip(i, 1, len(x) - 3)
    y0, y1, y2, y3 = x[i - 1], x[i], x[i + 1], x[i + 2]
    return y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)))


def dechirp_loop(x, sr, win, target, band, out_sr=OUT_SR, seconds=0.62, max_span=16.0):
    """Constant-pitch seamless loop at `target` Hz taken from the part of `win` where the engine passes through it."""
    tt, ph, f = phase_track(x, sr, win[0], win[1], band)
    finst = np.gradient(ph) * sr
    finst = smooth(finst, int(sr * 0.05) | 1)
    # centre: where the instantaneous frequency is closest to the target (away from the window edges)
    margin = int(0.08 * sr)
    c = margin + int(np.argmin(np.abs(finst[margin:-margin] - target)))
    # on a fast pull the timbre changes along the loop: keep the stretch short enough to span at most max_span Hz
    k = int(0.1 * sr)
    rate = abs(finst[min(len(finst) - 1, c + k)] - finst[max(0, c - k)]) / (2 * k / sr)
    if rate > 1:
        seconds = max(0.26, min(seconds, max_span / rate))
    cycles = max(CYL, int(round(seconds * target / CYL)) * CYL)  # whole engine cycles
    fade = 0.03 * target  # cross-fade length in firing periods
    half = cycles / 2
    p0 = ph[c] - half
    p1 = ph[c] + half + fade
    if p0 < ph[0] or p1 > ph[-1]:
        # not enough material on one side: slide the window
        shift = max(ph[0] - p0, 0) + min(ph[-1] - p1, 0)
        p0 += shift
        p1 += shift
    if p0 < ph[0] or p1 > ph[-1]:
        cycles = int((ph[-1] - ph[0] - fade) // CYL) * CYL
        p0 = ph[0]
        p1 = p0 + cycles + fade
    L = int(round(cycles * out_sr / target))
    f_exact = cycles * out_sr / L
    nfade = int(round(fade * out_sr / f_exact))
    phases = p0 + np.arange(L + nfade) * f_exact / out_sr
    pos = np.interp(phases, ph, np.arange(len(ph))) + int(win[0] * sr)
    y = interp_cubic(x, pos)
    a = np.linspace(0, 1, nfade)
    y[:nfade] = y[:nfade] * np.sin(a * np.pi / 2) + y[L:L + nfade] * np.cos(a * np.pi / 2)
    y = y[:L]
    span = (finst[np.searchsorted(ph, p0)], finst[min(len(finst) - 1, np.searchsorted(ph, p1))])
    return y, f_exact, span


def psola_low(loop, f_src, f_low, out_sr=OUT_SR, seconds=1.0, seed=1):
    """Fire the pulses of `loop` (constant firing frequency f_src) less often: same exhaust pulse, lower rpm."""
    P = out_sr / f_src
    n_src = int(round(len(loop) / P))
    cycles = max(CYL, int(round(seconds * f_low / CYL)) * CYL)
    L = int(round(cycles * out_sr / f_low))
    f_exact = cycles * out_sr / L
    Pn = out_sr / f_exact
    # grain: 2.6 source periods around each pulse (a little longer than classic PSOLA so the tail rings on)
    g = int(P * 2.6)
    w = np.hanning(g)
    y = np.zeros(L + g)
    ext = np.concatenate([loop, loop, loop])
    rng = np.random.default_rng(seed)
    for j in range(cycles):
        src_c = len(loop) + (j % n_src) * P
        s0 = int(round(src_c - g / 2))
        grain = ext[s0:s0 + g] * w * (0.9 + 0.2 * rng.random())
        o = max(0, int(round(j * Pn + rng.normal(0, Pn * 0.004))))
        y[o:o + g] += grain
    y[:g] += y[L:L + g]  # wrap the tail round: seamless
    return y[:L], f_exact


def main():
    x = load(SRC)
    x = x / np.max(np.abs(x))
    loops = []
    for target, win, band in TARGETS:
        y, f, span = dechirp_loop(x, SR, win, target, band)
        rms = float(np.sqrt(np.mean(y * y)))
        loops.append({'f': f, 'y': y, 'rms': rms, 'kind': 'real'})
        print(f'  {target:4d} Hz  -> loop {len(y) / OUT_SR:.3f} s at {f:.2f} Hz, source {span[0]:.0f}-{span[1]:.0f} Hz, rms {rms:.3f}')
    base = min(loops, key=lambda lp: abs(lp['f'] - PSOLA_BASE))
    low = []
    for i, fl in enumerate(LOW):
        y, f = psola_low(base['y'], base['f'], fl, seed=10 + i)
        rms = float(np.sqrt(np.mean(y * y)))
        low.append({'f': f, 'y': y, 'rms': rms, 'kind': 'psola'})
        print(f'  {fl:4d} Hz  -> loop {len(y) / OUT_SR:.3f} s at {f:.2f} Hz (PSOLA), rms {rms:.3f}')
    loops = low + loops
    # level every loop to the same RMS (the game applies its own loudness curve), keep headroom
    target_rms = 0.2
    pos = 0
    manifest = []
    chunks = []
    gap = int(0.01 * OUT_SR)
    for lp in loops:
        y = lp['y'] * (target_rms / max(lp['rms'], 1e-6))
        pk = np.max(np.abs(y))
        if pk > 0.98:
            y *= 0.98 / pk
        manifest.append({'offset': pos, 'length': len(y), 'hz': round(lp['f'], 3), 'kind': lp['kind']})
        chunks.append(y)
        chunks.append(np.zeros(gap))
        pos += len(y) + gap
    data = np.concatenate(chunks)
    pcm = np.clip(np.round(data * 32767), -32768, 32767).astype('<i2').tobytes()
    os.makedirs(os.path.dirname(OUT_WAV), exist_ok=True)
    with open(OUT_WAV, 'wb') as fh:
        fh.write(b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, OUT_SR, OUT_SR * 2, 2, 16) + b'data' + struct.pack('<I', len(pcm)) + pcm)
    with open(OUT_JSON, 'w') as fh:
        json.dump({'sampleRate': OUT_SR, 'source': 'Freesound #496171 "Import car revs on Chassis Dyno with Turbo" by editboy23 (CC0)', 'loops': manifest}, fh, indent=1)
    print(f'wrote {OUT_WAV} ({len(pcm) / 1e3:.0f} kB, {len(data) / OUT_SR:.1f} s) and {OUT_JSON}')


if __name__ == '__main__':
    main()
