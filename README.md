# Khasi ASR Native Review Website

This web app is a **review system** for Khasi native validators.

Features:

- auto-load fixed review set (50 audios)
- play each audio and read transcript in parallel
- mark each item as **Correct / Incorrect / Unsure**
- add corrected transcript and reviewer notes
- export review results as JSON or CSV
- admin view to inspect merged reviewer outputs

## Prepare review data (one-time per transcript run)

Run the prep script from workspace root:

- `sample/hf_transcripts_50.json` -> `public/review/review_items.json`
- copies 50 wav files into `public/review/audio/`

## Run website

1. Install dependencies with `npm install`
2. Run review-data prep script (see below)
3. Start site with `npm run dev`

The app opens with review data already loaded (no manual file upload).

## Admin side

- Open app and switch to **Admin** tab.
- Option 1: click **Load Current Browser Reviews** to inspect local reviewer records.
- Option 2: import one or many reviewer JSON export files.
- Admin can export merged results as CSV/JSON.

## Push to GitHub and host on Vercel

After committing, push this `transcript_player_app` project to your GitHub repo and import the repo in Vercel.
Set Vercel:

- Framework preset: `Vite`
- Build command: `npm run build`
- Output directory: `dist`
