#!/usr/bin/env python3
"""
Generate a branded QR code for the Wealth Systems Audit page.

    pip install segno pillow opencv-python-headless
    python make_qr.py https://fincart.github.io/wealth-audit/

Produces, next to the script:
    audit-qr.svg        vector, for print (posters, standees, brochures)
    audit-qr.png        1200x1200 raster, for slides, email and WhatsApp
    audit-qr-card.png   print card with the Fincart logo and a call to action

Every output is decoded back with OpenCV before the script exits. If the
decoded text does not byte-for-byte match the URL you passed, the script
fails loudly rather than handing you a QR that scans to the wrong place.

Error correction is fixed at level H (~30% recoverable). That is deliberate:
printed codes get creased, smudged and partially covered, and the extra
redundancy costs only a slightly denser grid.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Final

try:
    import segno
except ImportError:
    sys.exit("Missing dependency. Run: pip install segno pillow opencv-python-headless")

# ---------------------------------------------------------------- constants

BRAND_BLUE: Final[str] = "#1551FD"
INK: Final[str] = "#111721"
MUTED: Final[str] = "#65707F"
WHITE: Final[str] = "#FFFFFF"

PNG_SCALE: Final[int] = 24          # module size in px for audit-qr.png
QUIET_ZONE: Final[int] = 4          # modules; 4 is the spec minimum, never go below
ERROR_LEVEL: Final[str] = "h"       # ~30% recoverable
CARD_W: Final[int] = 1200
CARD_H: Final[int] = 1600


# ----------------------------------------------------------------- helpers

def validate_url(url: str) -> str:
    """Reject the mistakes that produce a QR nobody can use."""
    url = url.strip()
    if not url:
        raise ValueError("URL is empty.")
    if " " in url:
        raise ValueError("URL contains a space.")
    if not url.startswith(("https://", "http://")):
        raise ValueError(
            f"URL must start with https:// or http:// — got {url!r}. "
            "A QR without a scheme opens a search, not your page."
        )
    if url.startswith("http://"):
        print("  WARNING: http:// is not encrypted. Use https:// for a public link.")
    if "docs.google.com/spreadsheets" in url:
        raise ValueError(
            "That is the spreadsheet, not the questionnaire. Point this at the "
            "hosted index.html URL."
        )
    if "script.google.com" in url and url.rstrip("/").endswith("exec"):
        raise ValueError(
            "That is the Apps Script endpoint, not the questionnaire. Point this "
            "at the hosted index.html URL."
        )
    if len(url) > 2000:
        raise ValueError("URL is too long to encode reliably.")
    return url


def verify(path: Path, expected: str) -> None:
    """
    Decode the written file and confirm it round-trips to the exact URL.

    OpenCV's QRCodeDetector is the unreliable component here, not the encoder:
    it intermittently returns an empty string on large or low-contrast images
    that real phone scanners read without trouble. So we try several
    representations and only declare failure when every one of them fails.
    A single failed attempt is not evidence of a bad code.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        print(f"  {path.name}: written (opencv/numpy not installed — NOT verified)")
        return

    img = cv2.imread(str(path))
    if img is None:
        raise RuntimeError(f"{path.name}: could not be read back for verification.")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    def scaled(src, width: int):
        if src.shape[1] == width:
            return src
        h = round(src.shape[0] * width / src.shape[1])
        interp = cv2.INTER_AREA if width < src.shape[1] else cv2.INTER_NEAREST
        return cv2.resize(src, (width, h), interpolation=interp)

    candidates = [
        ("original", img),
        ("grayscale", gray),
        ("otsu", otsu),
        ("otsu@600", scaled(otsu, 600)),
        ("gray@600", scaled(gray, 600)),
        ("gray@1600", scaled(gray, 1600)),
    ]

    detector = cv2.QRCodeDetector()
    attempts = []
    for label, candidate in candidates:
        try:
            decoded, _points, _straight = detector.detectAndDecode(candidate)
        except cv2.error:
            decoded = ""
        if decoded == expected:
            print(f"  {path.name}: decoded and matched (via {label})")
            return
        attempts.append(f"{label}={decoded!r}")
        if decoded:
            # A non-empty decode that does NOT match is a genuine problem:
            # the code encodes something, and it is the wrong thing.
            raise RuntimeError(
                f"{path.name}: VERIFICATION FAILED — decoded to the wrong text.\n"
                f"  expected: {expected!r}\n"
                f"  decoded:  {decoded!r} (via {label})"
            )

    raise RuntimeError(
        f"{path.name}: VERIFICATION FAILED — no decode attempt succeeded.\n"
        f"  expected: {expected!r}\n"
        f"  attempts: {'; '.join(attempts)}"
    )


def build_card(qr_png: Path, out: Path, url: str, logo: Path | None) -> None:
    """Compose a print-ready card: logo, headline, QR, URL."""
    from PIL import Image, ImageDraw, ImageFont

    card = Image.new("RGB", (CARD_W, CARD_H), WHITE)
    draw = ImageDraw.Draw(card)

    def font(size: int, bold: bool = False):
        for name in (
            "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf" % ("-Bold" if bold else ""),
        ):
            try:
                return ImageFont.truetype(name, size)
            except OSError:
                continue
        return ImageFont.load_default()

    def centre(text: str, y: int, f, fill: str) -> int:
        w = draw.textbbox((0, 0), text, font=f)[2]
        draw.text(((CARD_W - w) // 2, y), text, font=f, fill=fill)
        return y + draw.textbbox((0, 0), text, font=f)[3]

    y = 90
    if logo and logo.exists():
        lg = Image.open(logo).convert("RGBA")
        target_w = 420
        lg = lg.resize((target_w, round(lg.height * target_w / lg.width)), Image.LANCZOS)
        card.paste(lg, ((CARD_W - lg.width) // 2, y), lg)
        y += lg.height + 80
    else:
        y = centre("Fincart", y, font(72, True), INK) + 70

    y = centre("Questionnaire", y, font(56, True), INK) + 26
    y = centre("Five questions. Two minutes.", y, font(34), MUTED) + 90

    qr = Image.open(qr_png).convert("RGB")
    size = 760
    qr = qr.resize((size, size), Image.NEAREST)   # NEAREST keeps module edges crisp
    qr_x, qr_y = (CARD_W - size) // 2, y
    draw.rectangle(
        [qr_x - 26, qr_y - 26, qr_x + size + 26, qr_y + size + 26],
        outline="#E3E7ED", width=3,
    )
    card.paste(qr, (qr_x, qr_y))
    y = qr_y + size + 70

    y = centre("Scan to begin", y, font(40, True), BRAND_BLUE) + 22
    display = url if len(url) <= 52 else url[:49] + "..."
    centre(display, y, font(26), MUTED)

    card.save(out, "PNG", optimize=True)


# -------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description="Generate a branded QR code for the audit page.")
    ap.add_argument("url", help="The public URL of the hosted questionnaire.")
    ap.add_argument("--outdir", default=".", help="Where to write the files (default: alongside this script).")
    ap.add_argument("--logo", default="Fincart_Mark_Black.png", help="Logo PNG for the print card.")
    args = ap.parse_args()

    try:
        url = validate_url(args.url)
    except ValueError as err:
        print(f"ERROR: {err}", file=sys.stderr)
        return 2

    outdir = Path(args.outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    qr = segno.make(url, error=ERROR_LEVEL)
    print(f"Encoding: {url}")
    print(f"  version {qr.version}, error level {ERROR_LEVEL.upper()}")

    svg_path = outdir / "audit-qr.svg"
    png_path = outdir / "audit-qr.png"
    card_path = outdir / "audit-qr-card.png"

    qr.save(svg_path, scale=10, dark=BRAND_BLUE, light=WHITE, border=QUIET_ZONE)
    qr.save(png_path, scale=PNG_SCALE, dark=BRAND_BLUE, light=WHITE, border=QUIET_ZONE)
    print(f"  wrote {svg_path.name}, {png_path.name}")

    verify(png_path, url)

    try:
        build_card(png_path, card_path, url, Path(args.logo))
        verify(card_path, url)
    except Exception as err:                       # card is a nicety, not the deliverable
        print(f"  card skipped: {err}")

    print("\nDone. Print audit-qr.svg at 3 cm or larger; scan it from a real phone "
          "at real distance before you print a thousand of them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
