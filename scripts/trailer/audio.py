#!/usr/bin/env python3
"""
Trailer soundtrack: procedural music (135 BPM phonk: build, drop at 4.0 s, breakdown, drop at 36.0 s, title slam at 41.78 s)
plus layered sound effects (real CC0 recordings + synthesis), ducking and mastering to about -14 LUFS.
Writes smoke-output/trailer/audio.wav, music.wav (stem) and cues.json (beat grid, hits).
    python3 scripts/trailer/audio.py
Needs numpy and ffmpeg.
"""
import json, os, subprocess, sys
import numpy as np

SR = 44100
BPM = 135.0
BEAT = 60.0 / BPM
DUR = 45.0
N = int(DUR * SR)
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OUT = os.path.join(ROOT, 'smoke-output/trailer')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(1337)

# ---------------------------------------------------------------- timeline (matches scripts/trailer/shots.js), in seconds
SEQ = [('open', 4.0), ('launch', 2.0), ('montage', 8.0), ('drift1', 2.667), ('drift2', 2.667), ('drift3', 2.667), ('drift4', 2.0), ('nitro', 6.0),
       ('timelapse', 3.0), ('puddle', 3.0), ('cuts', 2.222), ('final', 2.778)]
T = {}
t = 0.0
for name, d in SEQ:
    T[name] = t
    t += d
T['freeze'] = t          # 41.0
T['title'] = T['freeze'] + 0.778   # 41.778
DROP1, DROP2, TITLE = 4.0, 36.0, T['title']

# ---------------------------------------------------------------- helpers
def t2i(x): return int(round(x * SR))
def add(buf, x, at, gain=1.0, pan=0.0):
    i = t2i(at)
    if i >= buf.shape[1] or i + len(x) <= 0: return
    a = max(0, -i); i = max(0, i)
    j = min(buf.shape[1], i + len(x) - a)
    seg = x[a:a + (j - i)] * gain
    l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    buf[0, i:j] += seg * l * 1.414
    buf[1, i:j] += seg * r * 1.414
def tt(d): return np.arange(int(d * SR)) / SR
def fft_filter(x, lo=None, hi=None, order=4):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); g = np.ones_like(f)
    if lo: g *= 1 - 1 / (1 + (f / lo) ** (2 * order))
    if hi: g *= 1 / (1 + (f / hi) ** (2 * order))
    return np.fft.irfft(X * g, len(x))
def noise(d): return rng.standard_normal(int(d * SR))
def lp1(x, fc):
    a = 1 - np.exp(-2 * np.pi * fc / SR); y = np.empty_like(x); s = 0.0
    for i in range(len(x)): s += a * (x[i] - s); y[i] = s
    return y
def sat(x, k=1.0): return np.tanh(x * k) / np.tanh(k)
def load(path, start=0.0, dur=None):
    cmd = ['ffmpeg', '-v', 'error', '-ss', str(start)] + (['-t', str(dur)] if dur else []) + ['-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype=np.float32).astype(np.float64)
def resample(x, ratio):  # ratio > 1 = faster / higher
    n = int(len(x) / ratio); return np.interp(np.arange(n) * ratio, np.arange(len(x)), x)
def fade(x, a=0.005, b=0.02):
    x = x.copy(); na, nb = int(a * SR), int(b * SR)
    if na: x[:na] *= np.linspace(0, 1, na)
    if nb: x[-nb:] *= np.linspace(1, 0, nb)
    return x
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)

# ---------------------------------------------------------------- instruments
def kick(power=1.0, d=0.55):
    x = tt(d); f = 40 + 150 * np.exp(-x * 32); ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-x * 6.5) * (1 - np.exp(-x * 900))
    y += 0.5 * noise(d) * np.exp(-x * 260) * 0.4
    return sat(y * 1.6 * power, 1.4)
def sub808(freq, d=0.8, glide=0.04):
    x = tt(d); f = freq * (1 + 0.8 * np.exp(-x / glide)); ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * (1 - np.exp(-x * 400)) * np.exp(-x * 2.2) + 0.25 * np.sin(2 * ph) * np.exp(-x * 5)
    return sat(y * 1.8, 1.6)
def snare(d=0.28):
    x = tt(d); n = fft_filter(noise(d), 1200, 9000) * np.exp(-x * 20)
    tone = np.sin(2 * np.pi * (190 + 60 * np.exp(-x * 40)) * x) * np.exp(-x * 24)
    return sat((n * 1.2 + tone) * 1.2, 1.2)
def clap(d=0.3):
    x = tt(d); y = np.zeros_like(x)
    for k, off in enumerate([0, 0.012, 0.025]):
        i = int(off * SR); seg = fft_filter(noise(d), 900, 7000) * np.exp(-np.maximum(x - off, 0) * (28 if k < 2 else 14))
        y[i:] += seg[:len(y) - i] * (0.7 if k < 2 else 1.0)
    return sat(y * 1.3, 1.1)
def hat(open_=False):
    d = 0.22 if open_ else 0.06; x = tt(d)
    return fft_filter(noise(d), 7000) * np.exp(-x * (14 if open_ else 70)) * 0.6
def cowbell(m=65, d=0.28):
    x = tt(d); y = (np.sign(np.sin(2 * np.pi * hz(m) * x)) + np.sign(np.sin(2 * np.pi * hz(m) * 1.5 * x))) * np.exp(-x * 11)
    return fft_filter(y, 500, 3500) * 0.5
def saw(f, d, bright=0.5, det=0.004):
    x = tt(d); y = np.zeros_like(x)
    for k, dt_ in enumerate([-det, 0, det]):
        ph = (f * (1 + dt_) * x + k * 0.31) % 1.0; y += 2 * ph - 1
    return y / 3
def lead(m, d, cutoff=2800, vel=1.0):
    y = saw(hz(m), d + 0.3) * np.minimum(1, tt(d + 0.3) * 200)
    y = fft_filter(y, None, cutoff, 2) * np.exp(-tt(d + 0.3) / (d * 0.9 + 0.05))
    return sat(y * 1.1 * vel, 1.3)
def pluck(m, d=0.5):
    x = tt(d); y = (saw(hz(m), d) + 0.6 * saw(hz(m + 12), d)) * np.exp(-x * 7)
    return sat(fft_filter(y, 120, 3500) * 1.0, 1.2)
def pad(ms, d):
    y = np.zeros(int(d * SR))
    for m in ms: y += saw(hz(m), d, det=0.006)
    y = fft_filter(y, 60, 1400, 2)
    env = np.minimum(1, tt(d) / 1.2) * np.minimum(1, (d - tt(d)) / 0.8)
    return y * env * 0.35
def riser(d, f0=300, f1=9000, vol=1.0):
    x = tt(d); n = noise(d)
    out = np.zeros_like(n); chunks = 16
    for c in range(chunks):
        a, b = int(c * len(n) / chunks), int((c + 1) * len(n) / chunks)
        fc = f0 * (f1 / f0) ** ((c + 0.5) / chunks)
        out[a:b] = fft_filter(n[a:b], fc * 0.6, fc * 1.6, 2) * (0.3 + 3.0 * (c / chunks) ** 2)
    tone = np.sin(2 * np.pi * np.cumsum(120 * (8 ** (x / d))) / SR) * (x / d) ** 2 * 0.5
    return (out * 0.5 + tone) * vol * (x / d) ** 0.7
def revcymbal(d):
    y = fft_filter(noise(d), 2500, 14000) * (tt(d) / d) ** 3
    return y * 0.9
def boom(d=2.4, vol=1.0):
    x = tt(d); f = 28 + 90 * np.exp(-x * 5); y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 1.8)
    n = fft_filter(noise(d), None, 600, 2) * np.exp(-x * 5) * 0.6
    return sat((y + n) * 1.5 * vol, 1.5)
def subdrop(d=1.0):
    x = tt(d); f = 95 * np.exp(-x * 2.3) + 18; return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.minimum(1, x * 60) * np.exp(-x * 0.8)
def whoosh(d=0.5, f0=400, f1=4000, vol=1.0, peak=0.4):
    x = tt(d); n = noise(d); out = np.zeros_like(n); chunks = 10
    for c in range(chunks):
        a, b = int(c * len(n) / chunks), int((c + 1) * len(n) / chunks)
        u = (c + 0.5) / chunks; fc = f0 * (f1 / f0) ** u
        out[a:b] = fft_filter(n[a:b], fc * 0.5, fc * 1.5, 2)
    env = np.where(x / d < peak, (x / d / peak) ** 2, ((1 - x / d) / (1 - peak)) ** 1.5)
    return out * env * vol * 1.4
def click(d=0.03): x = tt(d); return fft_filter(noise(d), 1500, 6000) * np.exp(-x * 220) + np.sin(2 * np.pi * 2300 * x) * np.exp(-x * 300) * 0.5
def plink(f=1100, d=0.18): x = tt(d); return np.sin(2 * np.pi * np.cumsum(f * (1 - 0.35 * np.minimum(1, x / 0.06))) / SR) * np.exp(-x * 30) * 0.5
def splash(d=0.9):
    x = tt(d); n = fft_filter(noise(d), 300, 5500) * np.exp(-x * 5) + fft_filter(noise(d), 1500, 9000) * np.exp(-x * 14) * 0.7
    return n * 0.9
def wind(d, vol=1.0): return fft_filter(noise(d), 200, 2200) * vol

# ---------------------------------------------------------------- music
music = np.zeros((2, N))
roots = [29, 29, 32, 27]          # F1, F1, Ab1, Eb1 (MIDI) per bar (808 root pattern)
step = BEAT / 4

def step_time(base, k): return base + k * step
def pattern(t0, t1, kicks, snares, hats, base=DROP1, roll=True, four=False, v=1.0, bass=True, cow=False, leadp=0, openh=(6, 14)):
    """Place drums/bass for bars between t0 and t1; bars are counted from `base` (the drop)."""
    bar = 4 * BEAT
    b0 = int(np.floor((t0 - base) / bar)); b1 = int(np.ceil((t1 - base) / bar))
    for b in range(b0, b1):
        bt = base + b * bar
        root = roots[b % 4]
        for s in range(16):
            ts = step_time(bt, s)
            if ts < t0 - 1e-6 or ts >= t1 - 1e-6: continue
            isk = (s in kicks) or (four and s % 4 == 0)
            if isk:
                add(music, kick(1.0), ts, 0.95 * v)
                if bass: add(music, sub808(hz(root + (12 if s in (10, 14) else 0)), 0.5 if s != 0 else 0.9), ts, 0.7 * v)
            if s in snares: add(music, clap(), ts, 0.7 * v); add(music, snare(), ts, 0.45 * v)
            if s in hats: add(music, hat(s in openh), ts, (0.55 + 0.35 * ((s % 4) == 2)) * v)
            if roll and s in (14, 15) and (b % 2 == 1): add(music, hat(), ts + step / 2, 0.45 * v)
            if cow and s in (0, 3, 6, 10, 12): add(music, cowbell(65 if s in (0, 6) else 68), ts, 0.35 * v)
            if leadp and s % 2 == 0:
                seq = [65, 68, 72, 68, 77, 75, 72, 68]
                add(music, lead(seq[(s // 2 + b * 3) % 8] + (12 if leadp > 1 and b % 2 else 0), step * 2, 3200, 0.5), ts, 0.28 * leadp)
def snare_roll(t0, t1, v=0.7):
    t = t0; k = 0
    while t < t1 - 0.01:
        u = (t - t0) / (t1 - t0); add(music, snare(0.2), t, v * (0.3 + 0.7 * u)); t += max(0.035, (BEAT / 2) * (1 - u) ** 1.4 + 0.03); k += 1

# intro 0–4.0: drone + heartbeat + riser
add(music, pad([41, 48, 53], 4.2), 0.0, 0.5)
add(music, riser(3.2, 250, 9000, 0.9), 0.7, 0.6)
add(music, revcymbal(1.8), 2.1, 0.5)
for b in range(4, 9):  # one soft thump per beat from beat 4
    tb = b * BEAT
    if tb < 3.8: add(music, kick(0.7, 0.35), tb, 0.35 + 0.1 * (b - 4)); add(music, sub808(hz(29), 0.35), tb, 0.3)
# drop A: 4.0–14.0
music[:, t2i(3.84):t2i(4.0)] *= 0.0
add(music, boom(2.0, 1.0), DROP1, 0.8)
pattern(DROP1, 14.0, kicks={0, 6, 10}, snares={8}, hats=set(range(0, 16, 2)), cow=True)
# drift 14–24: lead arps, denser
pattern(14.0, 24.0, kicks={0, 3, 6, 10, 12}, snares={4, 12}, hats=set(range(16)), leadp=1, cow=True)
snare_roll(22.0, 24.0, 0.5)
# nitro 24–30: four on the floor
pattern(24.0, 30.0, kicks=set(), snares={4, 12}, hats=set(range(16)), four=True, leadp=2, v=1.05)
snare_roll(28.2, 30.0, 0.7)
# breakdown 30–36: pad + pluck arp, soft ticks, big riser
chords = [[53, 56, 60], [49, 53, 56], [56, 60, 63], [51, 55, 58]]
for k in range(3):
    add(music, pad(chords[k % 4], 2.2), 30.0 + k * 2 * 4 * BEAT / 2 * 1.0 if False else 30.0 + k * 2.0, 0.6)
for k in range(int(6 / (BEAT / 2))):
    ts = 30.0 + k * BEAT / 2
    if ts < 35.8: add(music, pluck([65, 68, 72, 77, 75, 72, 68, 65][k % 8], 0.4), ts, 0.28)
for b in range(int((35.9 - 30.0) / BEAT)): add(music, kick(0.45, 0.3), 30.0 + b * BEAT + 0.001, 0.22)
add(music, riser(3.0, 300, 11000, 1.1), 33.0, 0.8)
snare_roll(34.2, 35.82, 0.8)
music[:, t2i(35.86):t2i(36.0)] *= 0.0
# drop B 36–41.0: everything, then the sub-drop
add(music, boom(2.6, 1.0), DROP2, 1.0)
pattern(DROP2, 41.0, kicks=set(), snares={4, 12}, hats=set(range(16)), four=True, leadp=2, cow=True, v=1.1, base=DROP2)
for s in range(0, 16, 1):  # triplet-ish hat rolls
    pass
music[:, t2i(41.0):t2i(TITLE)] *= np.linspace(1, 0.0, t2i(TITLE) - t2i(41.0))[None, :] ** 2
# title: slam + stab + tail
add(music, boom(3.4, 1.2), TITLE, 1.0)
for m in (65, 68, 72, 77): add(music, lead(m, 1.4, 4200, 1.0), TITLE, 0.3)
add(music, pad([41, 48, 53, 60], 3.4), TITLE, 0.5)
for k in range(6): add(music, kick(0.9), TITLE + 1.4 + k * BEAT / 2 if False else TITLE + 1.0 + k * BEAT, 0.0)
music = np.tanh(music * 0.75) / 0.9
np.save(os.path.join(OUT, 'music.npy'), music)

# ---------------------------------------------------------------- sound effects & engine
sfx = np.zeros((2, N)); eng = np.zeros((2, N))
A = lambda n: os.path.join(ROOT, 'public/audio', n)
dyno = os.path.join(ROOT, 'assets-src/audio/freesound-496171-editboy23-import-car-dyno-turbo.mp3')
squeal = load(A('squeal.wav')); backfire = load(A('backfire.wav')); nitro = load(A('nitro.wav')); rain = load(A('rain.wav')); thunder = load(A('thunder.wav'))
pulls = [load(dyno, 0.3, 4.0), load(dyno, 5.0, 2.2), load(dyno, 7.9, 2.7), load(dyno, 11.0, 2.0)]
def engine(at, which, dur, vol=1.0, pitch=1.0, pan=0.0, lowpass=None):
    x = resample(pulls[which], pitch)[:int(dur * SR)]
    if lowpass: x = fft_filter(x, None, lowpass, 2)
    add(eng, fade(x, 0.03, 0.08), at, vol, pan)
def loop(x, d): n = int(d * SR); return np.tile(x, int(np.ceil(n / len(x))))[:n]
def squeal_for(at, d, vol=0.8, pitch=1.0):
    y = loop(resample(squeal, pitch), d); env = np.minimum(1, tt(d) / 0.12) * np.minimum(1, (d - tt(d)) / 0.25)
    add(sfx, y * env, at, vol)
def rainbed(at, d, vol): y = loop(rain, d + 1) ; add(sfx, fade(y[:int(d * SR)], 0.5, 0.8), at, vol)
def thunderhit(at, vol=0.6): add(sfx, thunder[:int(5.5 * SR)], at, vol, -0.3)
def hit_whoosh(at, d=0.35, vol=0.7, pan=0.0, f0=500, f1=5000): add(sfx, whoosh(d, f0, f1, 1.0), at - d * 0.55, vol, pan)
def pop(at, vol=0.5): add(sfx, backfire[:int(0.5 * SR)] * np.hanning(int(0.5 * SR)) ** 0.2, at, vol)
def blowoff(at, vol=0.45): add(sfx, fft_filter(noise(0.5), 1200, 7000) * np.exp(-tt(0.5) * 7) * (1 + 0.5 * np.sin(2 * np.pi * 30 * tt(0.5))), at, vol)

# rain throughout (cold open sound is mostly rain), thunder
rainbed(0.0, 45.0, 0.5)
thunderhit(1.55, 0.7); thunderhit(32.4, 0.6)
# cold open: relay clicks, plinks, creak, rev swell
for ts in (0.40, 0.52, 0.64): add(sfx, click(0.04), ts, 0.7); add(sfx, fft_filter(noise(0.12), 80, 300) * np.exp(-tt(0.12) * 30), ts, 0.4)
add(sfx, fft_filter(noise(0.6), 120, 900) * np.hanning(int(0.6 * SR)) * 0.5, 1.0, 0.25)
for ts, f in ((2.1, 1300), (2.42, 900), (2.7, 1150)): add(sfx, plink(f), ts, 0.5, rng.uniform(-0.4, 0.4))
add(sfx, fft_filter(noise(0.7), 300, 1500) * np.hanning(int(0.7 * SR)) * 0.4, 3.0, 0.3)
engine(3.0, 0, 1.0, 0.0)                       # filled below with a swell instead
eng[:, :] = 0.0
x = resample(pulls[0], 1.0)[:int(1.5 * SR)] * np.linspace(0, 1, int(1.5 * SR)) ** 1.5
add(eng, fade(x, 0.05, 0.02), 2.6, 0.8)
# launch 4.0–6.0
squeal_for(4.0, 0.8, 0.9, 1.1); squeal_for(4.8, 1.0, 0.5, 1.3)
engine(4.0, 1, 2.0, 1.0)
add(sfx, boom(1.2, 0.6), DROP1, 0.6)
# montage 6–14: pulls, shift pops, whooshes on cuts
for at, w in ((6.0, 2), (8.0, 2), (10.0, 3), (12.0, 1)): engine(at, w, 2.0, 0.85, 1.0 + 0.05 * (w % 2))
for ts in (7.35, 8.65, 9.55, 10.9, 11.8, 13.1): hit_whoosh(ts, 0.3, 0.55, rng.uniform(-0.6, 0.6)); pop(ts + 0.02, 0.35)
for ts in (7.0, 9.8, 12.3): blowoff(ts, 0.4)
hit_whoosh(9.0, 0.6, 1.0, 0.7, 300, 3500)     # roadside pass
hit_whoosh(11.4, 0.55, 0.9, -0.6, 300, 3000)  # near miss
# drifts 14–24 with squeal and speed-ramp hits
for k, name in enumerate(('drift1', 'drift2', 'drift3')):
    t0 = T[name]
    squeal_for(t0 + 0.30, 1.9, 0.75, 1.0 + 0.1 * k); engine(t0, (k + 1) % 4, 2.667, 0.75, 1.0 + 0.1 * k)
    add(sfx, subdrop(0.6), t0 + 0.28 * 2.667 + 0.0, 0.45)                 # into slow motion
    hit_whoosh(t0 + 0.28 * 2.667, 0.4, 0.5, 0.2, 200, 1500)
    hit_whoosh(t0 + 0.76 * 2.667, 0.3, 0.7, -0.2, 800, 6000); pop(t0 + 0.77 * 2.667, 0.4)   # snap back to full speed
squeal_for(T['drift4'], 2.0, 0.8, 1.15); engine(T['drift4'], 3, 2.0, 0.7)
hit_whoosh(T['drift4'] + 1.0, 0.25, 0.6)
# nitro 24–30
n0 = T['nitro']
add(sfx, nitro * 1.2, n0 + 0.45, 0.7); add(sfx, boom(1.0, 0.7), n0 + 0.55, 0.6)
engine(n0, 2, 2.6, 0.9, 1.08); engine(n0 + 2.6, 0, 3.4, 0.9, 1.1)
for ts in (n0 + 2.0, n0 + 3.333, n0 + 4.333): hit_whoosh(ts, 0.35, 0.7, rng.uniform(-0.5, 0.5))
for ts in (n0 + 3.5, n0 + 3.68, n0 + 3.92, n0 + 4.1): pop(ts, 0.5)
add(sfx, wind(1.7, 1.0) * np.linspace(0.1, 1, int(1.7 * SR)) ** 2 * 0.9, n0 + 4.333, 0.35)
# weather contrast 30–36
for k in range(4): add(sfx, whoosh(0.7, 200 + k * 200, 1800 + k * 900, 1.0, 0.5), T['timelapse'] + k * 0.7, 0.35, rng.uniform(-0.5, 0.5))
engine(T['puddle'], 1, 2.4, 0.55, 0.62, 0.0, 700)
add(sfx, splash(1.2), T['puddle'] + 0.85, 0.9, 0.3); add(sfx, splash(0.8), T['puddle'] + 1.05, 0.6, -0.3)
add(sfx, subdrop(0.5), T['puddle'], 0.4)
add(sfx, riser(2.6, 400, 12000, 1.0), 33.4, 0.5)
# climax 36–42
c0 = T['cuts']; assert abs(c0 - 36.0) < 0.01, c0
engine(DROP2, 2, 2.3, 1.0, 1.15); engine(c0, 0, 2.8, 1.0, 1.2)
add(sfx, boom(1.4, 0.8), DROP2, 0.7)
for k in range(5): hit_whoosh(DROP2 + k * 0.444, 0.2, 0.7, rng.uniform(-0.7, 0.7), 600, 7000)
hit_whoosh(c0, 0.35, 0.8)
f0 = T['final']
squeal_for(f0 + 0.3, 2.3, 0.85, 1.05)
add(sfx, subdrop(1.6), f0 + 0.32 * 2.778, 0.6); hit_whoosh(f0 + 0.32 * 2.778, 0.4, 0.5, 0, 200, 1500)
add(sfx, subdrop(2.4), T['freeze'] - 0.2, 0.9)       # sub-drop under the freeze frame
add(sfx, whoosh(0.7, 600, 9000, 1.0, 0.8), TITLE - 0.5, 0.9)
# title: slam, glitch stutters, last engine rev, hard cut at 45.0
add(sfx, boom(3.0, 1.1), TITLE, 0.9)
for k, ts in enumerate((TITLE + 0.12, TITLE + 0.21, TITLE + 0.3)): add(sfx, click(0.03), ts, 0.5); add(sfx, fft_filter(noise(0.06), 800, 5000) * np.exp(-tt(0.06) * 60), ts, 0.4)
rev = resample(pulls[0], 0.95)[:int(2.4 * SR)]
add(eng, fade(rev * np.linspace(0.3, 1.0, len(rev)) ** 1.5, 0.03, 0.001), 45.0 - 2.4, 0.95)

# ---------------------------------------------------------------- ducking (-4 dB under the big hits), mix
duck = np.ones(N)
hits = [(DROP1, 0.0), (DROP2, 0.0), (TITLE, 0.0), (T['nitro'] + 0.45, 0.0), (T['nitro'] + 0.55, 0.0)]
for ts, _ in hits:
    i = t2i(ts); a = int(0.01 * SR); r = int(0.28 * SR)
    env = np.ones(a + r); env[:a] = np.linspace(1, 10 ** (-4 / 20), a); env[a:] = 10 ** (-4 / 20) + (1 - 10 ** (-4 / 20)) * (1 - np.exp(-np.arange(r) / (0.09 * SR)))
    seg = duck[max(0, i - a):max(0, i - a) + len(env)]; seg *= env[:len(seg)] if i - a >= 0 else 1
mix = music * duck[None, :] * 0.8 + sfx * 0.7 + eng * 0.9
mix = np.tanh(mix * 0.85) / 0.85
mix[:, -t2i(0.002):] *= 0.0
# write wav (float → s16)
pcm = (np.clip(mix.T, -1, 1) * 32767).astype('<i2')
import wave
with wave.open(os.path.join(OUT, 'audio-raw.wav'), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
with wave.open(os.path.join(OUT, 'music.wav'), 'wb') as w:
    m = (np.clip(music.T, -1, 1) * 32767).astype('<i2'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(m.tobytes())
json.dump({'bpm': BPM, 'beat': BEAT, 'drop1': DROP1, 'drop2': DROP2, 'title': TITLE, 'seq': T, 'duck_hits': [h[0] for h in hits]}, open(os.path.join(OUT, 'cues.json'), 'w'), indent=1)
print('wrote', os.path.join(OUT, 'audio-raw.wav'))
