# 🎯 Focus Mitra (फोकस मित्र)
> **A gentle, privacy-first AI study companion for students and creators who struggle with focus, overwhelm, and study burnout.**

Built with ❤️ for a friend who battles ADHD, procrastination, and anxiety when starting large study sessions.

---

## 🌟 Why "Focus Mitra"?

In Sanskrit and Hindi, **Mitra (मित्र)** means *Friend*. 

Traditional productivity tools are often cold, rigid, and guilt-inducing with red streaks and harsh alarms. **Focus Mitra** reimagines study productivity through empathetic, companion-based guidance:
- It breaks terrifying, complex topics into bite-sized, digestible micro-steps.
- It provides warm, calm encouragement instead of judgment.
- It combines adaptive Pomodoro cycles with a generative ambient soundscape and thoughtful check-ins.

---

## 🧠 Open-Source AI at the Core

Focus Mitra is built around open-source AI principles:
- **100% Local & Private**: Connects directly to **[Ollama](https://ollama.ai)** running local open-weight models (`llama3.2`, `mistral`, `deepseek-r1`, `phi3`). Your personal study thoughts, struggles, and notes **never leave your machine**.
- **Offline Capable**: Study anywhere — in a library, dorm room, or remote cabin without Wi-Fi.
- **Zero Cost & No Subscriptions**: No expensive monthly AI subscriptions or paywalls.
- **Flexible Backend**: While open-source local AI is the primary core, it also includes an optional **Google Gemini API** fallback for lightweight devices without dedicated GPUs.

---

## ✨ Features

- 🧘 **Smart Task Decomposer**: Enter any overwhelming topic or assignment (e.g., *"Study Compiler Lexer & Parser"* or *"Prepare for Operating Systems exam"*), and AI instantly breaks it down into calm 10–25 minute micro-steps with time estimates and tips.
- ⏱️ **Adaptive Focus Timer**: Pomodoro-style timer with customizable focus/break intervals, smooth visual countdown, and calming sound alerts.
- 💬 **Empathetic Companion Chat**: Talk through study blocks, ask for quick concept clarifications, or seek gentle encouragement whenever motivation dips.
- 🎧 **Built-in Ambient Soundscape**: Generative audio synthesizers created with the Web Audio API — binaural focus waves, rain, cafe vibes, forest, and lo-fi tones (no external streaming needed).
- 📊 **Progress & Streak Tracker**: Daily streaks, completed focus minutes, task completion stats, and mindful reflections saved locally in your browser.
- 🎨 **Mindful Glassmorphic UI**: Calming pastel color palette, smooth micro-interactions, dark/light harmonious aesthetics engineered to reduce cognitive fatigue.

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or newer)
- *(Optional for Local AI)* [Ollama](https://ollama.ai/) installed and running

### 1. Clone the Repository
```bash
git clone https://github.com/lalit-oli-mohan-479/Focus_Mitra.git
cd Focus_Mitra
```

### 2. Install Dependencies & Run
```bash
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## ⚙️ AI Backend Setup

Focus Mitra automatically detects your AI configuration:

### Option A: Local Open-Source AI (Recommended)
1. Install [Ollama](https://ollama.ai).
2. Pull and run an open model:
   ```bash
   ollama run llama3.2
   ```
   *(Or `ollama run mistral` / `ollama run deepseek-r1`)*
3. Ensure Ollama allows web origin access:
   - **Windows (PowerShell)**: `$env:OLLAMA_ORIGINS="*"; ollama serve`
   - **macOS / Linux**: `OLLAMA_ORIGINS="*" ollama serve`
4. Focus Mitra will automatically detect Ollama at `http://localhost:11434`.

### Option B: Cloud AI (Gemini Fallback)
If you are on a low-spec laptop or mobile device:
1. Click the **⚙️ Settings** icon in the top right.
2. Select **Google Gemini API**.
3. Paste your free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
4. Keys are stored safely in your browser's `localStorage` and never shared.

---

## 🛠️ Tech Stack

- **Frontend**: Modern Vanilla JavaScript (ES6+), HTML5, Semantic Elements
- **Styling**: Pure CSS3 with modern CSS variables, glassmorphic design system, responsive flexbox & grid
- **Audio Engine**: Web Audio API (real-time procedural audio synthesis for ambient noise)
- **AI Integrations**:
  - Ollama REST API (`/api/generate` with model streaming and CORS handling)
  - Google Gemini API (`v1beta/models/gemini-1.5-flash:generateContent`)
- **Build Tool**: Vite (blazing fast HMR and lightweight bundle)

---

## 🤝 Built For
Built for the **"Build for a Friend"** challenge — dedicated to every friend who has ever looked at a textbook or assignment and felt frozen. You're not alone, and you've got this!

---

## 📄 License
MIT License. Feel free to use, modify, and build upon it!