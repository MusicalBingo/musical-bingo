# 🎵 Musical Bingo

Everything you need to run a Musical Bingo night: regular bingo on paper cards, with a music question on every draw.

| App | Who uses it | Address |
| --- | --- | --- |
| **Presenter** | You: prepare quizzes, run the game, check bingo cards | `/presenter` |
| **Big screen** | The computer connected to the projector / TV | `/display` |
| **Player** | Guests, on their phones (scan the QR code, no install) | `/play` |

## Quick start (venue laptop)

1. Install [Node.js](https://nodejs.org) 20 or newer (once).
2. Double-click **`Start Musical Bingo.bat`**, or run:
   ```bash
   npm install
   npm start
   ```
3. The server prints its addresses, for example `http://192.168.1.20:3000`.
   - On the presenter laptop, open `http://localhost:3000/presenter`.
   - On the big-screen computer, open `http://<that address>/display`, click **Start the big screen** (this lets the browser play music), and press F11.
   - Players scan the QR code on the big screen. Their phones must be on the **same Wi-Fi** as the laptop.

> The first time Windows may ask whether Node.js can use the network. Allow **Private networks**, or phones can't connect.

## Preparing a quiz

**Presenter → New quiz.** Each question has:

- **Type**: guess the song 🎵, guess the singer 🎤, guess the band from a photo 🖼, or anything else.
- **2–4 answers**, and you tick the right one. On phones each answer is a big button with its own colour **and** shape:
  🟧 Orange Triangle, 🟢 Teal Circle, 🟪 Purple Square, 🩷 Pink Star. That way people at a table can tell each other "it's the purple square!"
- **Music clip** (optional), either:
  - a **YouTube link**: set where the clip starts (`m:ss`) and how many seconds it plays. Normally only the sound plays and the video stays hidden so the title doesn't give the answer away. The video is shown when the answer is revealed. Pasting a link with `?t=95` sets the start time automatically.
  - an **audio file** (mp3, m4a, wav…) that you upload. This is the most reliable option: no ads and no internet needed.
- **Picture** (optional): appears **piece by piece** (2×2 up to 8×8 tiles) or **from blurry to sharp** while the timer runs. It is shown fully at the reveal.
- **Time** and **points** per question.

**Quiz settings**: default time and points, the **bonus for the first correct answer**, 75 or 90 bingo numbers, group score as **sum** or **average per member**, whether phones show the answer texts, and whether to reveal the answer automatically.

Save with the button or **Ctrl+S**.

### Preparing a quiz in Excel

You can also write the questions in Excel (or Google Sheets, LibreOffice, Numbers) and import them:

1. **Presenter → ⬇ Excel template** downloads a file with three example questions.
2. Fill in one row per question on the **Questions** sheet: type, question, 2–4 answers, the number of the right answer (1–4), a YouTube link or audio file link with start (`m:ss`) and play seconds, and optionally a picture link, seconds to answer and points. The **Settings** sheet holds the quiz title and options; the **Help** sheet explains every column.
3. **Presenter → ⬆ Import** and choose the file. The quiz opens in the editor. If some rows need attention (no right answer, too few answers, a link that isn't one), you get a list of them.

Columns can be in any order, and the importer understands other names too (`Option A`, `Right answer`, `Link`…). For the right answer you can also write A–D, the colour or shape (`purple`), or the answer text. Audio files and pictures on your own computer can't go in a spreadsheet: upload them in the editor after importing.

### Importing a song list

**⬆ Import** also takes a song list or run sheet: one row per song with its **title**, **artist**, a **question** and a **YouTube link**, for example:

| # | Title | Artist | … | Question | Link |
| --- | --- | --- | --- | --- | --- |
| 1 | Can't Stop the Feeling | Justin Timberlake | | Name of Artist | https://youtu.be/… |
| 2 | Treasure | Bruno Mars | | Name of Song | https://youtu.be/… |
| 4 | Everybody | Backstreet Boys | | Name of Band | https://youtu.be/… |

No header row is needed: the importer finds the question column (the one that keeps saying "Name of Song", "Name of Band"…), the link column, and takes the first two text columns as title and artist. Other columns (BPM, mood, notes) are ignored.

- **Name of Song** → "What is this song?", the right answer is the title.
- **Name of Artist / Singer** → "Who is singing?", **Name of Band** → "Which band is this?", the right answer is the artist.
- The **3 wrong answers** are picked from other songs in the same list: other titles for song questions, other bands for band questions. The same file always gives the same answers. Check them in the editor.
- Questions the list can't answer ("What movie", "What year", "Composer") are imported with empty answers for you to fill in.
- Rows without a question (karaoke, super games, pauses) are skipped. After importing you get a list of everything that was skipped or needs checking.

### Export and backups

Each quiz has two download buttons:
- **⬇ Excel**: the same layout as the template. Edit it in Excel and import it again (it becomes a new quiz).
- **⬇ Backup**: a `.json` file with everything, for backups or moving quizzes to another computer or to the cloud server. **⬆ Import** takes both kinds of file.

## Running the game

**Start game** gives you a 5-digit game code and opens the control panel.

1. **Lobby**: players join with their name, then create a group for their table or tap a group that already exists. They can also play solo.
2. **🎱 Draw number** (`D`): the big screen shows the ball. Players mark their paper cards. Using a real ball machine? Type the number in the bingo box instead.
3. **▶ Start question** (`S`): the music plays on the big screen, the picture starts uncovering, and phones show the answer buttons.
4. **✔ Show answer** (`R`) happens automatically when time runs out or everyone has answered. The big screen shows the right answer, how many people chose each answer, and the **fastest** right answer.
5. **🏆 Leaderboard** (`L`) whenever you like. Then draw the next number.

Scoring: a right answer earns the question's points for the player **and** their group. The first player to answer correctly also gets the bonus.

The control panel also lets you:
- pick any question as the next one. Replaying a question takes back the points it gave the first time.
- replay or stop the music clip.
- **check a printed card**: type its number (e.g. `A-012`) to see right away whether it really has a line or full house.
- put a message on the big screen ("BINGO! Please wait while we check the card"…).
- give or take points, or remove a player (hover over their name).
- download the **results as a CSV** file (opens in Excel).

Players who lose their connection or lock their phone come back automatically, with the same name and points.

## Printing bingo cards

**Presenter → Print bingo cards**: choose a series letter, how many cards, and 1–6 cards per A4 page, then print. Each card has a number like `A-001`. The server can rebuild any card from its number, so you can **check cards during the game without storing anything**. Reuse the same series every night, or pick a new letter for a fresh set. (Card checking works with 75-ball cards.)

## Running in the cloud

Players can then join over mobile data from anywhere. Any host that runs Docker or Node works (Render, Railway, Fly.io, a VPS…).

```bash
docker build -t musical-bingo .
docker run -p 3000:3000 -v musical-bingo-data:/data -e PRESENTER_PASSWORD=choose-one -e PUBLIC_URL=https://your-domain musical-bingo
```

| Setting | Meaning |
| --- | --- |
| `PRESENTER_PASSWORD` | **Set this in the cloud.** Without it, anyone can open the presenter app. |
| `PUBLIC_URL` | The address put in the QR code (e.g. `https://bingo.example.com`) |
| `PORT` | Port to listen on (default 3000) |
| `DATA_DIR` | Where quizzes, uploads and results are stored (default `./data`) |

The data folder must be kept between restarts (a volume or persistent disk). Live games are saved too: if the server restarts mid-game, the game comes back.

## Data and backups

Everything is in the `data` folder: `quizzes/` (your quizzes), `uploads/` (pictures and audio), `games/` (running games) and `results/` (final results of every game). To back up, copy that folder.

## Rehearsal and testing

```bash
npm run bots -- 12345 15            # 15 fake players join game 12345 and answer at random
npm test -- http://localhost:3000   # end-to-end check of joining, scoring, groups, cards
npm run test:sheets                 # checks Excel import and export (no server needed)
```

For development with live reload: `npm run dev`, then open http://localhost:5173.

## Good to know

- **YouTube** can play an ad before a clip, and embedding can be turned off for some videos. Preview every clip in the editor. Use uploaded audio files for the important ones.
- Keep the big-screen browser tab visible, because browsers slow down background tabs.
- Phones only need a browser. Players can use "Add to Home screen" to make it look like an app.
