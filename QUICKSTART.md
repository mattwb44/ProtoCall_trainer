# Quick Start — ProtoCall Trainer

## 1. Start the Server

```bash
cd /Users/user/Documents/VSCode/Projects/ProtoCall_trainer
npm start
```

Output should say: `ProtoCall Trainer running at http://localhost:3000`

## 2. Find Your Machine's Network IP

On Mac:
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

Look for something like `192.168.1.X` or `10.0.0.X`. Let's call this `YOUR_IP`.

## 3. Host Opens the App (Your Computer)

Open **http://localhost:3000** in your browser.

Click **"Host a Session"** → pick the first scenario (Two-Story Residential Fire) → **"Launch Live"**.

You'll see:
- Room code (e.g., `FIRE-4821`)
- **QR code** on the left
- "Participants: 0" that will update as crew joins
- **Aggregation Matrix** — empty until crew submits answers

## 4. Crew Joins (Other Computers/Phones on Same WiFi)

**Option A: QR Code**
- Point their phone camera at the QR code on your screen
- Tap the link that appears

**Option B: Manual Entry**
- Open http://`YOUR_IP`:3000 in their browser (replace `YOUR_IP` with the number from step 2)
- On the landing page, scroll down and enter the room code (e.g., `FIRE-4821`)
- Click **"Join"**

They'll see:
- Scenario dispatch in a rose banner
- Question cards for the Firefighter track
- A **"Submit Answer"** button for each question

## 5. Crew Submits Answers

Crew member picks a question and types/selects an answer, then clicks **"Submit Answer"**.

**On the host screen**: the answer appears in the Aggregation Matrix under that question, tagged `P1`, `P2`, etc. (anonymous tags).

**On the crew screen**: the **"Official Answer"** button unlocks — they can now tap it to see the instructor's answer.

## 6. Host Pushes Answers for Discussion

On the host screen, look at the Aggregation Matrix.  
Each submitted answer has a **"Push to Crew"** button.

Click it to broadcast that answer to all crew devices.

**On crew screens**: a rose banner appears saying "**PUSHED BY INSTRUCTOR**" with the highlighted answer.

## 7. End the Session

Host clicks **"End Session"** button at the bottom.

Confirm "Archive this completed session?" → **"Archive & End"**.

**On crew screens**: the session status changes to "ENDED" and a drawer pops up asking them to create an account to save their training record (v2 feature).

---

## Example Flow (Timing)

1. **Host** launches at 2:00 PM (time doesn't matter; this is simulated)
2. **Crew members** scan QR or enter code — they join instantly
3. **Participant counter** on host updates (e.g., "Participants: 3")
4. **Crew** submits their best guess on Q1 — response lands in the matrix within 100ms
5. **Host** sees 3 different answers, picks the best one, hits "Push to Crew"
6. **Crew devices** all show the pushed answer in a red banner
7. **Repeat** for more questions
8. **Host** ends; session is persisted to the database and crew can rejoin anytime

---

## Troubleshooting

**Crew can't access the URL**
- Confirm they're on the same WiFi as your computer
- Try pinging: `ping YOUR_IP` from their machine to verify connectivity
- Check firewall: your Mac may be blocking inbound traffic on port 3000
  - **System Preferences** → **Security & Privacy** → **Firewall** → confirm the port is open

**Answers aren't appearing in the matrix**
- Check the host browser console (F12 → Console) for Socket.IO errors
- Reload the host page and try again

**QR code won't scan**
- Make sure it's fully visible and not cut off
- Zoom the host browser page to 100%

**Crew answers show but push doesn't broadcast**
- Reload the crew's page and rejoin
- Host: open browser console (F12) and look for socket errors
