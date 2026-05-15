#!/usr/bin/env bash
# optimize-hero-video.sh — Optimisation vidéo hero Info Experts
# Usage: ./scripts/optimize-hero-video.sh <input.mp4>
# Prérequis: ffmpeg >= 5.0

set -euo pipefail

INPUT="${1:-hero-video-raw.mp4}"
OUT_DIR="."

if [[ ! -f "$INPUT" ]]; then
  echo "Usage: $0 <input.mp4>"
  exit 1
fi

echo "→ Source : $INPUT"

# ── MP4 < 2 MB (H.264, CRF 28, faststart, sans audio) ─────────────────────
echo "→ MP4 optimisé..."
ffmpeg -i "$INPUT" \
  -an \
  -c:v libx264 \
  -crf 28 \
  -preset slow \
  -profile:v high \
  -level 4.1 \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  -movflags +faststart \
  -pix_fmt yuv420p \
  -y "${OUT_DIR}/hero-video.mp4"
echo "  Taille MP4 : $(du -sh "${OUT_DIR}/hero-video.mp4" | cut -f1)"

# ── WEBM < 1.5 MB (VP9, sans audio) ───────────────────────────────────────
echo "→ WebM VP9 optimisé..."
ffmpeg -i "$INPUT" \
  -an \
  -c:v libvpx-vp9 \
  -crf 35 \
  -b:v 0 \
  -deadline best \
  -cpu-used 1 \
  -row-mt 1 \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  -y "${OUT_DIR}/hero-video.webm"
echo "  Taille WebM : $(du -sh "${OUT_DIR}/hero-video.webm" | cut -f1)"

# ── POSTER JPEG (frame à 0.5s) ─────────────────────────────────────────────
echo "→ Poster JPEG..."
ffmpeg -i "$INPUT" \
  -ss 00:00:00.500 \
  -vframes 1 \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease" \
  -q:v 4 \
  -y "${OUT_DIR}/hero-poster.jpg"
echo "  Taille poster : $(du -sh "${OUT_DIR}/hero-poster.jpg" | cut -f1)"

echo ""
echo "✓ Fichiers générés :"
ls -lh "${OUT_DIR}/hero-video.mp4" "${OUT_DIR}/hero-video.webm" "${OUT_DIR}/hero-poster.jpg"
echo ""
echo "→ Copier dans le projet :"
echo "   cp hero-video.mp4 hero-video.webm hero-poster.jpg C:/Users/defis/info-experts/"
