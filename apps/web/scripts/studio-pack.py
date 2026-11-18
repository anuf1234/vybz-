#!/usr/bin/env python3
"""
Renders the VYBZ Studio track pack: original, royalty-free DJ tools composed
in code (drums, bass, chords) so anyone can mix, record and battle with them.
Each track is 32 bars: 8-bar beat-only intro, 16-bar main section, 8-bar
beat-and-bass outro, which is what DJs want for practice mixes.

    python3 apps/web/scripts/studio-pack.py   # writes apps/web/public/studio/pack/*.mp3

Needs numpy and ffmpeg (libmp3lame). Deterministic: the same seed gives the
same audio, so rebuilding doesn't churn the files.
"""
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "studio", "pack")
NOTE = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def env(n, attack=0.002, decay=0.2, sustain=0.0, release=0.05, hold=None):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    d = sustain + (1 - sustain) * np.exp(-np.maximum(t - attack, 0) / max(decay, 1e-4))
    e = a * d
    if hold is not None:
        r = np.clip(1 - (t - hold) / max(release, 1e-4), 0, 1)
        e *= np.where(t > hold, r, 1)
    return e


def onepole_lp(x, cutoff):
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def hp(x, cutoff):
    return x - onepole_lp(x, cutoff)


rng = np.random.default_rng(7)


def kick(dur=0.45, f0=150, f1=48, punch=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * env(n, 0.001, 0.22)
    click = rng.standard_normal(n) * env(n, 0.0005, 0.004) * 0.3
    return np.tanh((body + click) * 1.6 * punch) * 0.95


def snare(dur=0.25, tone=185, noise=0.7):
    n = int(dur * SR)
    t = np.arange(n) / SR
    tn = np.sin(2 * np.pi * tone * t) * env(n, 0.001, 0.06) * 0.5
    nz = hp(rng.standard_normal(n), 1200) * env(n, 0.001, 0.09) * noise
    return (tn + nz) * 0.8


def clap(dur=0.3):
    n = int(dur * SR)
    nz = hp(rng.standard_normal(n), 900)
    e = np.zeros(n)
    for off in (0, 0.011, 0.022):
        s = int(off * SR)
        e[s:] += env(n - s, 0.0005, 0.012 if off < 0.02 else 0.12)
    return nz * e * 0.55


def hat(open_=False):
    dur = 0.32 if open_ else 0.06
    n = int(dur * SR)
    nz = hp(hp(rng.standard_normal(n), 6000), 7000)
    return nz * env(n, 0.0005, 0.12 if open_ else 0.018) * (0.32 if open_ else 0.28)


def tone(freq, dur, kind="saw", detune=0.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for d in ([-detune, detune] if detune else [0]):
        f = freq * (1 + d)
        ph = (f * t) % 1.0
        if kind == "saw":
            out += 2 * ph - 1
        elif kind == "square":
            out += np.where(ph < 0.5, 1, -1)
        elif kind == "tri":
            out += 4 * np.abs(ph - 0.5) - 1
        else:
            out += np.sin(2 * np.pi * ph)
    return out / (2 if detune else 1)


def place(buf, sample, at, gain=1.0):
    s = int(at)
    if s >= len(buf):
        return
    e = min(len(buf), s + len(sample))
    buf[s:e] += sample[: e - s] * gain


def chord_notes(root, minor=True):
    return [root, root + (3 if minor else 4), root + 7, root + 10]


def render(spec):
    bpm = spec["bpm"]
    beat = 60.0 / bpm * SR
    bar = beat * 4
    bars = 32
    n = int(bar * bars) + SR
    drums = np.zeros(n)
    bass = np.zeros(n)
    keys = np.zeros(n)
    duck = np.ones(n)
    style = spec["style"]
    root = 36 + NOTE[spec["key"]]  # bass octave
    prog = spec["prog"]  # semitone offsets per 2 bars
    K = kick(f0=spec.get("kick_f0", 150))
    S = clap() if style in ("house", "garage", "techno", "afro") else snare()
    CH, OH = hat(), hat(True)

    for b in range(bars):
        start = b * bar
        intro, outro = b < 8, b >= 24
        main = not intro and not outro
        # ── drums ──
        if style in ("house", "techno", "garage", "afro"):
            for q in range(4):
                place(drums, K, start + q * beat)
                d = np.clip(np.arange(int(beat)) / (0.12 * SR), 0, 1)
                place(duck, d - 1, start + q * beat)  # sidechain dip
                if style != "techno" or main:
                    place(drums, OH if style == "house" else CH, start + q * beat + beat / 2, 0.9)
            if b % 1 == 0 and (main or style in ("garage", "techno") or b >= 4):
                place(drums, S, start + beat, 0.9 if style != "techno" else 0.6)
                place(drums, S, start + 3 * beat, 0.9 if style != "techno" else 0.6)
            if style == "techno":
                for s16 in range(16):
                    place(drums, CH, start + s16 * beat / 4, 0.55 if s16 % 2 else 0.35)
            if style == "garage":
                for s16 in (3, 6, 10, 14):
                    place(drums, CH, start + s16 * beat / 4, 0.6)
                place(drums, K, start + 2.75 * beat, 0.7)
            if style == "afro":
                for s16 in (3, 7, 11, 14):
                    place(drums, rim, start + s16 * beat / 4, 0.7)
        elif style == "boombap":
            sw = beat / 2 * 0.58
            for q in range(4):
                place(drums, CH, start + q * beat, 0.8)
                place(drums, CH, start + q * beat + sw, 0.55)
            place(drums, K, start)
            place(drums, K, start + 1.75 * beat, 0.8)
            place(drums, K, start + 2.5 * beat, 0.9)
            place(drums, S, start + beat)
            place(drums, S, start + 3 * beat)
        elif style == "halftime":
            place(drums, K, start)
            place(drums, K, start + 2.75 * beat, 0.7)
            place(drums, S, start + 2 * beat, 1.1)
            for e in range(8):
                place(drums, CH, start + e * beat / 2, 0.5)
        elif style == "dnb":
            place(drums, K, start)
            place(drums, K, start + 2.5 * beat)
            place(drums, S, start + beat, 1.0)
            place(drums, S, start + 3 * beat, 1.0)
            place(drums, S, start + 3.75 * beat, 0.35)
            for e in range(8):
                place(drums, CH, start + e * beat / 2, 0.45 if e % 2 else 0.3)
        if b % 8 == 7 and not outro:
            for s16 in range(12, 16):
                place(drums, S, start + s16 * beat / 4, 0.35 + 0.1 * (s16 - 12))

        # ── bass and chords ──
        off = prog[(b // 2) % len(prog)]
        if not intro or style == "boombap" and b >= 4:
            if style == "afro":
                for s16 in (0, 3, 6, 10, 12):
                    f = hz(root + 12 + off + (7 if s16 == 10 else 0))
                    m = int(0.42 * SR)
                    t = np.arange(m) / SR
                    pitch = f * (1 + 0.6 * np.exp(-t * 30))
                    ld = np.tanh(np.sin(2 * np.pi * np.cumsum(pitch) / SR) * 2.2) * env(m, 0.002, 0.16)
                    place(bass, ld, start + s16 * beat / 4, 0.5)
            elif style == "halftime":
                m = int(bar)
                t = np.arange(m) / SR
                wob = 300 + 1600 * (0.5 + 0.5 * np.sin(2 * np.pi * t * (bpm / 60) * 1.0))
                w = onepole_lp(tone(hz(root + off), m / SR, "saw", 0.006), wob) * env(m, 0.01, 9, 0.9, 0.05, hold=m / SR - 0.06)
                place(bass, np.tanh(w * 2.5), start, 0.45)
            elif style == "dnb":
                m = int(beat * 2)
                r = onepole_lp(tone(hz(root + off), m / SR, "sine"), 400) * env(m, 0.005, 1.2, 0.6, 0.05, hold=m / SR - 0.05)
                place(bass, r, start, 0.75)
                place(bass, r, start + 2 * beat, 0.7)
            else:
                pattern = [0.5, 1.5, 2.5, 3.5] if style in ("house", "techno", "garage") else [0, 1.75, 2.5]
                for p in pattern:
                    m = int(beat * (0.45 if style != "boombap" else 0.9))
                    kind = "square" if style == "techno" else "saw"
                    x = onepole_lp(tone(hz(root + off), m / SR, kind, 0.004), 380 if style != "techno" else 260)
                    place(bass, x * env(m, 0.004, 0.25, 0.4, 0.04, hold=m / SR - 0.04), start + p * beat, 0.55)
        if main and style != "dnb" or style == "dnb" and main and b % 2 == 0:
            notes = chord_notes(root + 24 + off, spec.get("minor", True))
            m = int(bar if style != "boombap" else bar)
            if style in ("house", "garage", "afro"):
                for p in ([0.5, 1.5, 2.5, 3.5] if style != "afro" else [0, 1.5, 3]):
                    mm = int(beat * 0.38)
                    st = sum(tone(hz(nn), mm / SR, "saw", 0.008) for nn in notes) / len(notes)
                    place(keys, onepole_lp(st, 2200) * env(mm, 0.004, 0.12), start + p * beat, 0.42)
            elif style == "boombap":
                rh = sum(tone(hz(nn), m / SR, "sine") + 0.3 * tone(hz(nn) * 2, m / SR, "sine") for nn in notes) / len(notes)
                place(keys, rh * env(m, 0.01, 1.6, 0.25), start, 0.35)
            else:
                pad = sum(tone(hz(nn), m / SR, "saw", 0.01) for nn in notes) / len(notes)
                place(keys, onepole_lp(pad, 900 if style == "techno" else 1400) * env(m, 0.15, 3, 0.7, 0.2, hold=m / SR - 0.2), start, 0.3)
            # a short hook over the second half of the main section
            if 16 <= b < 24 and style in ("house", "techno", "afro", "garage", "halftime"):
                arp = [0, 7, 12, 10, 7, 3, 0, 7]
                for i, a in enumerate(arp):
                    mm = int(beat / 2 * 0.9)
                    lead = tone(hz(root + 36 + off + a), mm / SR, "tri") * env(mm, 0.003, 0.15)
                    place(keys, lead, start + i * beat / 2, 0.22)

    keys *= np.clip(duck, 0.35, 1)
    bass *= np.clip(duck, 0.5, 1)
    mix = drums * 0.9 + bass + keys
    # outro fade on the very last 2 bars keeps the tail clean
    tail = int(bar * 2)
    end = int(bar * bars)
    mix[end - tail : end] *= np.linspace(1, 0.6, tail)
    mix = mix[: end + int(0.2 * SR)]
    mix = np.tanh(mix * 0.9)
    mix /= np.max(np.abs(mix)) + 1e-9
    mix *= 0.89
    stereo = np.stack([mix, mix], axis=1)
    return stereo


def rim_sample():
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1700 * t) * 0.5 + hp(rng.standard_normal(n), 3000) * 0.4) * env(n, 0.0005, 0.01)


rim = rim_sample()

TRACKS = [
    {"id": "gold-teeth", "style": "boombap", "bpm": 92, "key": "C", "prog": [0, -4, -2, -5]},
    {"id": "low-sun", "style": "afro", "bpm": 112, "key": "D", "prog": [0, 3, 5, 3]},
    {"id": "velvet-hours", "style": "house", "bpm": 120, "key": "F", "prog": [0, -4, 3, -2]},
    {"id": "neon-drift", "style": "house", "bpm": 124, "key": "A", "prog": [0, -2, -4, -5]},
    {"id": "night-shift", "style": "garage", "bpm": 126, "key": "A", "prog": [0, 3, -2, -4]},
    {"id": "pressure-cooker", "style": "techno", "bpm": 130, "key": "E", "prog": [0, 0, 1, 0]},
    {"id": "skyline", "style": "halftime", "bpm": 140, "key": "F#", "prog": [0, -2, -4, -2]},
    {"id": "rush-hour", "style": "dnb", "bpm": 174, "key": "Bb", "prog": [0, -4, 3, -2]},
]


def write_mp3(path, stereo):
    pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    with wave.open(tmp, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-codec:a", "libmp3lame", "-b:a", "128k", path], check=True)
    os.unlink(tmp)


def main():
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])
    for spec in TRACKS:
        if only and spec["id"] not in only:
            continue
        audio = render(spec)
        path = os.path.join(OUT, f"{spec['id']}.mp3")
        write_mp3(path, audio)
        print(f"{spec['id']}: {spec['bpm']} BPM, {len(audio) / SR:.1f}s -> {os.path.getsize(path) // 1024} KB")


if __name__ == "__main__":
    main()
