"""Render Mosaic's own test ads: vertical videos with a voiceover, and static images.

    uv run --project worker python scripts/make_mosaic_ads.py media/mosaic

Mosaic is the test brand for the Meta sandbox account, so no real company's ads ever sit
under synthetic results. Writes the files plus `manifest.json` (copy, headline, CTA) for
`python -m mosaic.sandbox upload`. Needs macOS `say` for the voiceover and ffmpeg.
Screenshots come from docs/images (the fictional demo brand).
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "docs" / "images"
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
BG, PANEL, TEXT, MUTED, ACCENT = "#0d1017", "#171b24", "#f4f5f8", "#9aa1b2", "#8b7cf6"
LINK = "https://mosaicads.vercel.app"


@dataclass
class Scene:
    say: str
    text: str = ""  # on-screen words; defaults to the line itself
    shot: str | None = None  # docs/images file, cropped into the frame
    crop: tuple[float, float, float, float] = (0, 0, 1, 1)  # fractions of the shot


@dataclass
class AdSpec:
    key: str
    primary_text: str
    headline: str
    cta: str  # Meta call_to_action type
    scenes: list[Scene] = field(default_factory=list)  # video when set
    shot: str | None = None  # static: one screenshot under the headline
    badge: str = ""  # static: offer line
    voice: str = "Reed (English (US))"


DASH = (0.18, 0.08, 0.62, 0.95)  # winner card and moves on the dashboard
TABLE = (0.18, 0.1, 0.75, 0.95)

VIDEOS = [
    # problem/pain hooks
    AdSpec(
        "vid_dying_ad",
        "Your best ad is fading and Ads Manager won't tell you. Mosaic flags it the week it "
        "starts.",
        "Catch fading ads early",
        "LEARN_MORE",
        [
            Scene("Your best ad is dying, and you won't notice for two weeks."),
            Scene(
                "Hook rate slips. CTR slips. Spend keeps going.",
                "Hook rate down. CTR down. Spend up.",
            ),
            Scene("Mosaic watches every ad, every day.", shot="overview.jpg", crop=DASH),
            Scene(
                "And tells you what to cut, and what to make next.", shot="report.jpg", crop=TABLE
            ),
            Scene("Mosaic. Your creative strategist.", "Mosaic"),
        ],
        voice="Reed (English (US))",
    ),
    AdSpec(
        "vid_why_wins",
        "You spend thousands a month on Meta. Do you know why your winners win? Mosaic breaks "
        "every ad down and ties it to results.",
        "Know why your ads win",
        "LEARN_MORE",
        [
            Scene(
                "You spend twenty thousand a month on Meta, and you can't say why one ad wins.",
                "$20k/month. No idea why.",
            ),
            Scene(
                "Mosaic tags every hook, angle and format.",
                shot="breakdown.jpg",
                crop=(0.18, 0.1, 0.7, 0.95),
            ),
            Scene("Then ranks them by what actually sells.", shot="analysis.jpg", crop=TABLE),
            Scene("Stop guessing. Connect your ad account.", "Stop guessing."),
        ],
        voice="Shelley (English (US))",
    ),
    AdSpec(
        "vid_monday",
        "Every Monday: Ads Manager open, no idea what to make next. Mosaic writes the brief "
        "for you, from your own winners.",
        "Briefs from your winners",
        "SIGN_UP",
        [
            Scene(
                "Every Monday you stare at Ads Manager and still don't know what to make next.",
                "Monday. Ads Manager. Blank page.",
            ),
            Scene("Mosaic finds the ad that's really winning.", shot="overview.jpg", crop=DASH),
            Scene("Then writes scripts and hooks built on it.", shot="report.jpg", crop=TABLE),
            Scene("Your next test, ready by Monday.", "Ready by Monday."),
        ],
        voice="Eddy (English (US))",
    ),
    AdSpec(
        "vid_same_idea",
        "Most ad budgets fund the same idea twenty times over. Mosaic groups your ads into "
        "real concepts so you can see it.",
        "See your real concepts",
        "LEARN_MORE",
        [
            Scene(
                "Your ad budget is paying for the same idea twenty times.", "Same idea. 20 times."
            ),
            Scene(
                "Mosaic groups near-duplicate ads into real concepts.",
                shot="analysis.jpg",
                crop=(0.18, 0.5, 0.75, 0.98),
            ),
            Scene("So you know when it's time for something new.", "Time for something new."),
            Scene("Mosaic.", "Mosaic"),
        ],
        voice="Flo (English (US))",
    ),
    # stat/number hooks
    AdSpec(
        "vid_22_ads",
        "22 ads. 4 real ideas. Mosaic measures how many concepts your account is really testing.",
        "22 ads, 4 ideas",
        "LEARN_MORE",
        [
            Scene("Twenty two ads. Four real ideas.", "22 ads. 4 ideas."),
            Scene(
                "Mosaic counts the concepts you're actually testing.",
                shot="analysis.jpg",
                crop=(0.18, 0.5, 0.75, 0.98),
            ),
            Scene("And shows where the money really goes.", shot="overview.jpg", crop=DASH),
            Scene("Try the demo. No sign-in.", "Try the demo"),
        ],
        voice="Reed (English (US))",
    ),
    AdSpec(
        "vid_68_percent",
        "68% of spend on one format? Mosaic shows you where your budget actually goes, and "
        "what to test instead.",
        "Where your budget goes",
        "LEARN_MORE",
        [
            Scene("Sixty eight percent of spend, on one format.", "68% on one format"),
            Scene("Mosaic shows where your budget really goes.", shot="overview.jpg", crop=DASH),
            Scene("And the formats you haven't tried.", shot="report.jpg", crop=TABLE),
            Scene("Mosaic. See your whole account.", "Mosaic"),
        ],
        voice="Shelley (English (US))",
    ),
    AdSpec(
        "vid_45_numbers",
        "45 numbers in the last report. 45 checked against the data. Every claim Mosaic makes "
        "cites the ads behind it.",
        "Every number checked",
        "LEARN_MORE",
        [
            Scene("Forty five numbers. Forty five checked.", "45 / 45 checked"),
            Scene(
                "Every claim in a Mosaic report cites the ads behind it.",
                shot="report.jpg",
                crop=TABLE,
            ),
            Scene("No made-up insights. Just your data.", "Just your data."),
        ],
        voice="Eddy (English (US))",
    ),
    AdSpec(
        "vid_3_seconds",
        "3 seconds. That's how long your hook has. Mosaic scores every hook on its own.",
        "Score every hook",
        "SIGN_UP",
        [
            Scene("Three seconds. That's how long your hook has.", "3 seconds."),
            Scene(
                "Mosaic cuts the hook into its own scene and scores it.",
                shot="breakdown.jpg",
                crop=(0.18, 0.1, 0.7, 0.95),
            ),
            Scene("So you know which openings stop the scroll.", shot="analysis.jpg", crop=TABLE),
            Scene("Mosaic.", "Mosaic"),
        ],
        voice="Flo (English (US))",
    ),
    # one of each other hook
    AdSpec(
        "vid_common",
        "What do your best ads have in common? Mosaic finds the pattern across every ad you've "
        "run.",
        "Find the pattern",
        "LEARN_MORE",
        [
            Scene("What do your best ads have in common?"),
            Scene("Mosaic compares every hook, angle and format.", shot="analysis.jpg", crop=TABLE),
            Scene("And tells you what to double down on.", shot="report.jpg", crop=TABLE),
            Scene("Find your pattern.", "Find your pattern."),
        ],
        voice="Reed (English (US))",
    ),
    AdSpec(
        "vid_demo_walk",
        "This is your ad account, broken down scene by scene. See it on the free demo.",
        "See the demo",
        "LEARN_MORE",
        [
            Scene("This is your ad account.", shot="overview.jpg", crop=(0.15, 0, 1, 1)),
            Scene("Broken down, scene by scene.", shot="breakdown.jpg", crop=(0.15, 0, 1, 1)),
            Scene("Ranked by what works.", shot="analysis.jpg", crop=(0.15, 0, 1, 1)),
            Scene("Explained like a strategist would.", shot="report.jpg", crop=(0.15, 0, 1, 1)),
        ],
        voice="Shelley (English (US))",
    ),
    AdSpec(
        "vid_vs_ads_manager",
        "Ads Manager tells you what happened. Mosaic tells you why, and what to do next.",
        "What happened vs. why",
        "LEARN_MORE",
        [
            Scene(
                "Ads Manager tells you what happened. Mosaic tells you why.",
                "What happened vs. why",
            ),
            Scene("Every ad tagged. Every tag ranked.", shot="analysis.jpg", crop=TABLE),
            Scene("Every move backed by numbers.", shot="report.jpg", crop=TABLE),
            Scene("Mosaic.", "Mosaic"),
        ],
        voice="Eddy (English (US))",
    ),
    AdSpec(
        "vid_free_first",
        "Free for your first ad account. Connect Meta and get your first strategist report.",
        "Free for your first account",
        "SIGN_UP",
        [
            Scene("Free for your first ad account.", "FREE · first ad account"),
            Scene("Connect Meta. Mosaic imports every ad.", shot="overview.jpg", crop=DASH),
            Scene("Your first strategist report, the same day.", shot="report.jpg", crop=TABLE),
            Scene("Start free.", "Start free"),
        ],
        voice="Flo (English (US))",
    ),
]

STATICS = [
    AdSpec(
        "img_strategist",
        "An in-house creative strategist, for brands that can't afford one.",
        "Your creative strategist",
        "LEARN_MORE",
        shot="overview.jpg",
        badge="",
    ),
    AdSpec(
        "img_free_account",
        "Connect your Meta ad account and get your first report free.",
        "Free for your first account",
        "SIGN_UP",
        shot="report.jpg",
        badge="FREE · first ad account",
    ),
    AdSpec(
        "img_why_win",
        "Know why your winners win: every ad broken down and tied to results.",
        "Know why your ads win",
        "LEARN_MORE",
        shot="analysis.jpg",
    ),
    AdSpec(
        "img_scene",
        "The first 3 seconds get their own scene, and their own score.",
        "Every hook, scored",
        "LEARN_MORE",
        shot="breakdown.jpg",
    ),
    AdSpec(
        "img_concepts",
        "22 ads can be 4 ideas. Mosaic shows you which.",
        "22 ads. 4 ideas.",
        "LEARN_MORE",
        shot="analysis.jpg",
    ),
    AdSpec(
        "img_checked",
        "Every number in every report is checked against your data.",
        "Every number checked",
        "LEARN_MORE",
        shot="report.jpg",
    ),
    AdSpec(
        "img_demo",
        "See a full account breakdown on the free demo. No sign-in.",
        "Try the demo",
        "LEARN_MORE",
        shot="overview.jpg",
        badge="Free demo · no sign-in",
    ),
    AdSpec(
        "img_moves",
        "Scale, cut, test: this week's moves, from your own ads.",
        "This week's moves",
        "SIGN_UP",
        shot="overview.jpg",
    ),
]


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)


def draw_centered(
    d: ImageDraw.ImageDraw,
    text: str,
    y: int,
    size: int,
    width: int,
    fill: str = TEXT,
    chars: int = 16,
) -> int:
    f = font(size)
    for line in textwrap.wrap(text, chars) or [""]:
        w = d.textlength(line, font=f)
        d.text(((width - w) / 2, y), line, font=f, fill=fill)
        y += int(size * 1.18)
    return y


def paste_shot(
    img: Image.Image,
    name: str,
    crop: tuple[float, float, float, float],
    box: tuple[int, int, int, int],
) -> None:
    shot = Image.open(SHOTS / name).convert("RGB")
    w, h = shot.size
    region = shot.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
    bw, bh = box[2] - box[0], box[3] - box[1]
    region.thumbnail((bw, bh), Image.Resampling.LANCZOS)
    x = box[0] + (bw - region.width) // 2
    y = box[1] + (bh - region.height) // 2
    ImageDraw.Draw(img).rounded_rectangle(
        (x - 6, y - 6, x + region.width + 6, y + region.height + 6), 18, fill=PANEL
    )
    img.paste(region, (x, y))


def wordmark(d: ImageDraw.ImageDraw, width: int, y: int) -> None:
    f = font(44)
    w = d.textlength("Mosaic", font=f)
    d.text(((width - w) / 2, y), "Mosaic", font=f, fill=ACCENT)


def scene_frame(s: Scene, path: Path) -> None:
    W, H = 1080, 1920
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    words = s.text or s.say
    if s.shot:
        draw_centered(d, words, 170, 72, W, chars=22)
        paste_shot(img, s.shot, s.crop, (40, 520, W - 40, 1660))
    else:
        lines = len(textwrap.wrap(words, 14))
        draw_centered(d, words, H // 2 - lines * 62, 104, W, chars=14)
    wordmark(d, W, H - 160)
    img.save(path)


def static_image(a: AdSpec, path: Path) -> None:
    W, H = 1080, 1350
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = draw_centered(d, a.headline, 90, 92, W, chars=18)
    if a.badge:
        f = font(40)
        w = d.textlength(a.badge, font=f)
        d.rounded_rectangle(((W - w) / 2 - 28, y + 20, (W + w) / 2 + 28, y + 96), 38, fill=ACCENT)
        d.text(((W - w) / 2, y + 36), a.badge, font=f, fill=BG)
        y += 110
    paste_shot(img, a.shot or "overview.jpg", (0.15, 0, 1, 1), (50, y + 40, W - 50, H - 180))
    wordmark(d, W, H - 120)
    img.save(path, quality=92)


def run(*args: str) -> None:
    subprocess.run(args, check=True, capture_output=True)


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(out.stdout.strip())


def render_video(a: AdSpec, out: Path, thumb: Path) -> float:
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        clips = []
        for i, s in enumerate(a.scenes):
            frame, voice, clip = t / f"{i}.png", t / f"{i}.aiff", t / f"{i}.mp4"
            scene_frame(s, frame)
            if i == 0:
                frame_img = Image.open(frame).convert("RGB")
                frame_img.thumbnail((1080, 1920))
                frame_img.save(thumb, quality=90)
            run("say", "-v", a.voice, "-o", str(voice), s.say)
            secs = max(duration(voice) + 0.35, 1.8)
            run(
                "ffmpeg",
                "-y",
                "-loop",
                "1",
                "-i",
                str(frame),
                "-i",
                str(voice),
                "-filter_complex",
                "[1:a]apad,aresample=44100[a]",
                "-map",
                "0:v",
                "-map",
                "[a]",
                "-t",
                f"{secs:.2f}",
                "-r",
                "30",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-ac",
                "2",
                str(clip),
            )
            clips.append(clip)
        listing = t / "list.txt"
        listing.write_text("".join(f"file '{c}'\n" for c in clips))
        run(
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(listing),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(out),
        )
    return duration(out)


def main() -> None:
    dest = Path(sys.argv[1] if len(sys.argv) > 1 else "media/mosaic")
    dest.mkdir(parents=True, exist_ok=True)
    manifest = []
    for a in VIDEOS:
        file, thumb = dest / f"{a.key}.mp4", dest / f"{a.key}_thumb.jpg"
        secs = render_video(a, file, thumb)
        manifest.append(
            {
                "key": a.key,
                "type": "video",
                "file": file.name,
                "thumb": thumb.name,
                "duration_s": round(secs, 2),
                "primary_text": a.primary_text,
                "headline": a.headline,
                "cta": a.cta,
                "link": LINK,
            }
        )
        print(f"{a.key}: {secs:.1f}s")
    for a in STATICS:
        file = dest / f"{a.key}.jpg"
        static_image(a, file)
        manifest.append(
            {
                "key": a.key,
                "type": "image",
                "file": file.name,
                "primary_text": a.primary_text,
                "headline": a.headline,
                "cta": a.cta,
                "link": LINK,
            }
        )
        print(f"{a.key}: image")
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"{len(manifest)} ads in {dest}")


if __name__ == "__main__":
    main()
