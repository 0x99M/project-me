FROM python:3.12-slim

# yt-dlp shells out to both of these: ffmpeg to transcode, ffprobe to read the
# source codec. The Debian package ships both; leaving them out fails only at
# post-processing, after a download has already succeeded.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY bot ./bot

# A polling bot, not a server: it opens no port. Exactly one instance may run at
# a time, since concurrent getUpdates calls fight over the same update queue.
CMD ["python", "-m", "bot.main"]
