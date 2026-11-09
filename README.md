# YouTube Downloader — v1.1 (Desktop)

YouTube ডাউনলোডার ডেস্কটপ অ্যাপ — **Electron + React** ফ্রন্টএন্ড, **Node.js** ব্যাকএন্ড
(পুরোটাই JavaScript), ডাউনলোড ইঞ্জিন **yt-dlp**, মার্জ/MP3 কনভার্সনের জন্য **ffmpeg**।

## ✨ ফিচার

- লিংক পেস্ট করলেই অটো শনাক্ত — **সিঙ্গেল ভিডিও** নাকি **প্লেলিস্ট**
- পেস্টের পরপরই দুটো অপশন: **🎬 Video** / **🎵 Audio (MP3)**
- ভিডিওতে **কোয়ালিটি অনুযায়ী তালিকা** (2160p → 144p), প্রতিটার পাশে **ফাইল সাইজ**
  (জোড়া-লাগানো সাইজ আনুমানিক হলে `~` চিহ্ন থাকে)
- অডিওতে বিটরেট অনুযায়ী অপশন (সিঙ্গেল ভিডিওতে আসল ফরম্যাটের সাইজসহ)
- প্লেলিস্টে **চেকবক্সে বেছে বেছে** বা সব একসাথে ডাউনলোড, কিউ সিস্টেম (একসাথে সর্বোচ্চ ২টা)
- প্রতিটা ডাউনলোডে **প্রগ্রেস %, স্পিড, ETA**, Cancel বোতাম, Processing (merge/convert) অবস্থা
- ডাউনলোড ফোল্ডার বাছাই, প্রথম রানে yt-dlp না থাকলে অ্যাপের ভিতর থেকেই **Install yt-dlp** বোতাম
- **সাবটাইটেল** — ভাষা বেছে আলাদা `.srt` ফাইল হিসাবে বা ভিডিওর ভিতরে এম্বেড করে (অটো-ক্যাপশনসহ)
- **Pause / Resume** — ডাউনলোড থামিয়ে পরে থামা জায়গা থেকেই আবার চালু (`.part` ফাইল থেকে)
- **ডাউনলোড হিস্ট্রি** — শেষ করা ডাউনলোডের তালিকা (অ্যাপ বন্ধ করলেও থাকে), সেখান থেকে ফাইল খোলা / ফোল্ডারে দেখা / আবার ডাউনলোড; ব্যর্থ ডাউনলোডে **Retry** বোতাম
- **MP3 ট্যাগ** — অডিও ডাউনলোডে কভার ছবি ও টাইটেল/আর্টিস্ট তথ্য MP3-র ভিতরে বসে যায়
- YouTube মাঝে মাঝে "Sign in to confirm you're not a bot" দিয়ে আটকালে অটো **বিকল্প ক্লায়েন্ট দিয়ে রিট্রাই**

## 🛠️ ডেভেলপমেন্টে চালানো

আগে দরকার শুধু **Node 20+** (আর কিছু না — কোনো Rust বা সিস্টেম ডিপেন্ডেন্সি লাগে না)।

```bash
npm install
./scripts/fetch-binaries.sh        # Windows-এ: .\scripts\fetch-binaries.ps1
                                   # (নিজের মেশিনের yt-dlp + ffmpeg resources/bin-এ আনবে)

# দুটো টার্মিনালে:
npm run dev                        # ১) Vite dev সার্ভার (http://localhost:1420)
npm run dev:electron               # ২) Electron অ্যাপ (dev সার্ভার থেকে UI লোড করবে)
```

শুধু UI-র ডিজাইন দেখতে (Electron ছাড়া, ব্রাউজারে ডেমো মোডে):
```bash
npm run dev    # http://localhost:1420
```

## 📦 ইনস্টলার বানানো

```bash
npm run build      # UI বিল্ড (dist/)
npm run dist       # electron-builder দিয়ে এই মেশিনের ইনস্টলার
```
আউটপুট `release/`-তে: Windows `.exe` (NSIS), macOS `.dmg`, Linux `.AppImage` / `.deb`।

**সব প্ল্যাটফর্মের ইনস্টলার একসাথে (সহজ পথ):** প্রজেক্টটা GitHub-এ পুশ করে
`v1.0.0` নামে ট্যাগ দিলেই `.github/workflows/release.yml` চারটা কনফিগে
(Windows, Mac Apple Silicon, Mac Intel, Linux) বিল্ড করে Draft Release-এ ইনস্টলার জমা দেবে।
Actions ট্যাব থেকে হাতেও (workflow_dispatch) চালানো যায় — তখন ইনস্টলারগুলো Artifacts-এ পাওয়া যাবে।

## 📱 মোবাইল (Android APK / iOS IPA)

একই React UI **Capacitor** দিয়ে মোবাইল অ্যাপ হিসাবে বিল্ড হয়। নেটিভ প্রজেক্ট
(android/, ios/) রিপোতে রাখা হয় না — রিলিজ ওয়ার্কফ্লো বিল্ডের সময় তৈরি করে:

- **Android:** `./gradlew assembleRelease` → `YouTube-Downloader.apk` (unsigned —
  সরাসরি ইনস্টল করতে ফোনে "unknown sources" অনুমতি লাগবে)
- **iOS:** সাইনিং ছাড়া বিল্ড → `YouTube-Downloader-unsigned.ipa` (ইনস্টল করতে
  AltStore/SideStore জাতীয় সাইডলোড টুল লাগবে; App Store-এ যাবে না)

⚠️ সৎ নোট: মোবাইল বিল্ডে আপাতত **UI-টাই চলে (ডেমো মোডে)** — ফোনে আসল ডাউনলোডের
জন্য নেটিভ yt-dlp ইঞ্জিন (Android-এ youtube-dl-android প্লাগইন) আলাদা ধাপে যোগ
করতে হবে। ডেস্কটপ বিল্ডেই সব ফিচার পুরোপুরি কাজ করে।

লোকালে মোবাইল প্রজেক্ট বানাতে:
```bash
npm run build
npx cap add android   # বা ios (macOS লাগবে সিঙ্ক/বিল্ডে)
npx cap sync
```

## 📁 কাঠামো

```
src/                 React UI (App.jsx — পুরো ইন্টারফেস)
electron/main.cjs    Electron মেইন প্রসেস — উইন্ডো + IPC হ্যান্ডলার
electron/preload.cjs রেন্ডারারের জন্য নিরাপদ ব্রিজ (window.desktopAPI)
electron/core.cjs    আসল লজিক (খাঁটি Node.js) — yt-dlp চালানো, ইনফো পার্স,
                     প্রগ্রেস, Cancel, প্রথম রানে yt-dlp ডাউনলোড
resources/bin/       yt-dlp + ffmpeg (fetch স্ক্রিপ্ট দিয়ে আসে, git-এ যায় না)
capacitor.config.json মোবাইল (Capacitor) কনফিগ — android/ios প্রজেক্ট CI-তে তৈরি হয়
build/               অ্যাপ আইকন (icon.png / .ico / .icns)
scripts/             fetch-binaries.sh / .ps1
.github/workflows/   release.yml — ট্যাগ দিলেই সব প্ল্যাটফর্মের বিল্ড
                     web-pages.yml — ওয়েব প্রিভিউ (GitHub Pages)
```

## ⚠️ নোট

- 720p-র উপরে YouTube ভিডিও-অডিও আলাদা পাঠায় — এক ফাইলে পেতে ffmpeg দিয়ে মার্জ করা হয়,
  তাই ffmpeg না থাকলে ওই কোয়ালিটি আর MP3 কাজ করবে না (720p পর্যন্ত ffmpeg ছাড়াও চলে)।
- অ্যাপটি ব্যক্তিগত ব্যবহারের জন্য। ক্রিয়েটরদের কপিরাইট ও YouTube-এর শর্ত মেনে ব্যবহার করো।
  Play Store / App Store-এ এই ধরনের অ্যাপ সাধারণত অনুমোদন পায় না — বিতরণ GitHub Release দিয়ে করো।
- v2 পরিকল্পনা: Android APK (আলাদা পথ)। iOS আপাতত বাইরে —
  Apple-এর সীমাবদ্ধতায় বাস্তবসম্মত নয়।
