FROM python:3.12-slim

# ffmpeg: yt-dlp shells out to it (transcode) and ffprobe (read the source codec).
# libpango + fontconfig: WeasyPrint renders /money's PDF report through Pango.
# fonts-dejavu-core: a base fallback face for any glyph missing from Archivo.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        fonts-dejavu-core \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY bot ./bot
# Applied on startup by bot.db.migrate; they must ship with the image.
COPY migrations ./migrations
# Archivo (OFL) is embedded in the /money PDF report via @font-face.
COPY fonts ./fonts

# A polling bot, not a server: it opens no port. Exactly one instance may run at
# a time, since concurrent getUpdates calls fight over the same update queue.
CMD ["python", "-m", "bot.main"]
