# RoniTube Downloader — v1 (Desktop)

YouTube ডাউনলোডার ডেস্কটপ অ্যাপ — **Tauri 2 + React** ফ্রন্টএন্ড, **Rust** ব্যাকএন্ড,
ডাউনলোড ইঞ্জিন **yt-dlp**, মার্জ/MP3 কনভার্সনের জন্য **ffmpeg**।

## ✨ ফিচার

- লিংক পেস্ট করলেই অটো শনাক্ত — **সিঙ্গেল ভিডিও** নাকি **প্লেলিস্ট**
- পেস্টের পরপরই দুটো অপশন: **🎬 Video** / **🎵 Audio (MP3)**
- ভিডিওতে **কোয়ালিটি অনুযায়ী তালিকা** (2160p → 144p), প্রতিটার পাশে **ফাইল সাইজ**
  (জোড়া-লাগানো সাইজ আনুমানিক হলে `~` চিহ্ন থাকে)
- অডিওতে বিটরেট অনুযায়ী অপশন (সিঙ্গেল ভিডিওতে আসল ফরম্যাটের সাইজসহ)
- প্লেলিস্টে **চেকবক্সে বেছে বেছে** বা সব একসাথে ডাউনলোড, কিউ সিস্টেম (একসাথে সর্বোচ্চ ২টা)
- প্রতিটা ডাউনলোডে **প্রগ্রেস %, স্পিড, ETA**, Cancel বোতাম, Processing (merge/convert) অবস্থা
- ডাউনলোড ফোল্ডার বাছাই, প্রথম রানে yt-dlp না থাকলে অ্যাপের ভিতর থেকেই **Install yt-dlp** বোতাম
- YouTube মাঝে মাঝে "Sign in to confirm you're not a bot" দিয়ে আটকালে অটো **বিকল্প ক্লায়েন্ট দিয়ে রিট্রাই**

## 🛠️ ডেভেলপমেন্টে চালানো

আগে দরকার: Node 20+, Rust (rustup), আর OS অনুযায়ী Tauri-র সিস্টেম ডিপেন্ডেন্সি
(Linux-এ `libwebkit2gtk-4.1-dev` ইত্যাদি — Tauri-র অফিসিয়াল গাইড দেখো)।

```bash
npm install
./scripts/fetch-binaries.sh        # Windows-এ: .\scripts\fetch-binaries.ps1
npx tauri icon src-tauri/icons/app-icon.svg   # আইকন ফাইলগুলো তৈরি (একবারই)
npm run tauri dev
```

শুধু UI-র ডিজাইন দেখতে (Tauri ছাড়া, ব্রাউজারে ডেমো মোডে):
```bash
npm run dev    # http://localhost:1420
```

## 📦 ইনস্টলার বানানো

```bash
npm run tauri build
```
আউটপুট `src-tauri/target/release/bundle/`-তে: Windows `.exe/.msi`, macOS `.dmg`, Linux `.deb/.AppImage`।

**সব প্ল্যাটফর্মের ইনস্টলার একসাথে (সহজ পথ):** প্রজেক্টটা GitHub-এ পুশ করে
`v1.0.0` নামে ট্যাগ দিলেই `.github/workflows/release.yml` চারটা মেশিনে
(Windows, Mac Intel, Mac Apple Silicon, Linux) বিল্ড করে Draft Release-এ ইনস্টলার জমা দেবে।

## 📁 কাঠামো

```
src/                 React UI (App.jsx — পুরো ইন্টারফেস)
src-tauri/src/lib.rs Rust ব্যাকএন্ড — yt-dlp কমান্ড: get_info, start_download,
                     cancel_download, tools_status, download_ytdlp
src-tauri/binaries/  yt-dlp + ffmpeg sidecar (fetch স্ক্রিপ্ট দিয়ে আসে, git-এ যায় না)
scripts/             fetch-binaries.sh / .ps1
.github/workflows/   release.yml — ট্যাগ দিলেই সব প্ল্যাটফর্মের বিল্ড
```

## ⚠️ নোট

- 720p-র উপরে YouTube ভিডিও-অডিও আলাদা পাঠায় — এক ফাইলে পেতে ffmpeg দিয়ে মার্জ করা হয়,
  তাই ffmpeg না থাকলে ওই কোয়ালিটি আর MP3 কাজ করবে না (720p পর্যন্ত ffmpeg ছাড়াও চলে)।
- অ্যাপটি ব্যক্তিগত ব্যবহারের জন্য। ক্রিয়েটরদের কপিরাইট ও YouTube-এর শর্ত মেনে ব্যবহার করো।
  Play Store / App Store-এ এই ধরনের অ্যাপ সাধারণত অনুমোদন পায় না — বিতরণ GitHub Release দিয়ে করো।
- v2 পরিকল্পনা: Android APK (Tauri mobile / yt-dlp Android পোর্ট)। iOS আপাতত বাইরে —
  Apple-এর সীমাবদ্ধতায় বাস্তবসম্মত নয়।
