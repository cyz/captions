# Caption Burner

Caption Burner is a Next.js application for editing SRT subtitles and burning them directly into vertical videos. It provides a live safe-zone preview designed for short-form platforms such as Instagram Reels, TikTok, and YouTube Shorts.

## Features

- Upload MP4 or MOV videos with an SRT subtitle file
- Preview captions over the video before rendering
- Edit caption text and timing by segment
- Add balanced line breaks or split a caption across two time ranges
- Validate empty text, overlapping timestamps, invalid durations, and safe-zone overflow
- Keep captions to a maximum of two lines and 34 characters per line
- Render captions into the video and download the resulting MP4
- Track rendering progress in the editor

## Requirements

- Node.js 20 or later
- npm
- FFmpeg and ffprobe available on your `PATH`

On macOS, install FFmpeg with Homebrew:

```bash
brew install ffmpeg
```

Verify the installation:

```bash
ffmpeg -version
ffprobe -version
```

## Getting Started

Clone the repository and install the dependencies:

```bash
git clone https://github.com/cyz/captions.git
cd captions
npm install
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

For a production build:

```bash
npm run build
npm start
```

## How It Works

1. Upload a vertical video and its SRT subtitle file.
2. Select a caption segment to preview it at the corresponding timestamp.
3. Adjust its timing or text, and use the line-break and time-split controls when needed.
4. Resolve highlighted validation errors.
5. Select **Finish and render** to burn the captions into the video.
6. Download the rendered MP4 when processing is complete.

## Input Limits

- Maximum video size: 600 MB
- Maximum video duration: 10 minutes
- Recommended aspect ratio: 9:16
- Maximum caption lines per segment: 2
- Recommended maximum characters per line: 34

## Architecture

The application uses the Next.js App Router and Node.js route handlers. Uploaded files and job metadata are stored under `data/jobs/<jobId>` and are intentionally excluded from Git.

Rendering follows this pipeline:

1. `ffprobe` reads the video dimensions and duration.
2. The application parses and validates the SRT segments.
3. `@napi-rs/canvas` creates transparent caption overlays.
4. FFmpeg composites each overlay into the source video.
5. The rendered MP4 is made available through the download endpoint.

Key directories:

```text
app/          Pages and API route handlers
components/   Reusable interface components
lib/          SRT parsing, safe-zone, storage, queue, canvas, and FFmpeg logic
data/         Local runtime files (not committed)
```

## Deployment Notes

This project requires a Node.js server with:

- FFmpeg and ffprobe installed
- A writable, persistent filesystem for the `data` directory
- Enough memory and execution time to process uploaded videos

GitHub Pages cannot run this application because it only serves static files. Serverless platforms with ephemeral filesystems or short execution limits may also require replacing local storage and the in-process rendering queue with persistent object storage and a background worker.

## Available Scripts

- `npm run dev` starts the development server
- `npm run build` creates a production build
- `npm start` runs the production server
