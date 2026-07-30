FROM python:3.12-slim

# yt-dlp shells out to both of these: ffmpeg to transcode, ffprobe to read the
# source codec. The Debian package ships both; leaving them out fails only at
# post-processing, after a download has already succeeded.
# fonts-dejavu-core is a Unicode TTF that reportlab embeds in /money's PDF export
# (the built-in Helvetica is Latin-1 only and would choke on odd characters).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY bot ./bot
# Applied on startup by bot.db.migrate; they must ship with the image.
COPY migrations ./migrations

# A polling bot, not a server: it opens no port. Exactly one instance may run at
# a time, since concurrent getUpdates calls fight over the same update queue.
CMD ["python", "-m", "bot.main"]
