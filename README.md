---

# 🏸 Badminton Tournament Management System

A real-time, end-to-end tournament management platform designed for seamless coordination between Admins, Referees, and Participants. Built with **React**, **Tailwind CSS**, and **Firebase**.

## 🚀 Key Features

* **Admin Dashboard:**
* Setup tournaments (Round Robin or Knockout).
* Smart Court Manager: Auto-assign matches to courts.
* Live Standings & Bracket Resolution: Auto-calculate pool stats and generate Finals.


* **Referee Portal:**
* Secure access via 6-digit PIN.
* Live set-by-set scoring and score locking.


* **Participant View:**
* Real-time live scoreboard.
* Clear tabular view of matches, scores, and tournament status.



## 🛠 Prerequisites

* [Node.js](https://nodejs.org/) (v18+)
* A Firebase project (Firestore and Authentication enabled)

## 💻 Local Setup Instructions

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME

```

### 2. Install dependencies

```bash
npm install

```

### 3. Firebase Configuration

1. Create a new project in the [Firebase Console](https://console.firebase.google.com/).
2. Enable **Firestore Database** and **Authentication** (Email/Password).
3. Create a file at `src/config/firebase.js` and populate it with your project credentials:

```javascript
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

```

### 4. Firestore Security Rules

For development, you can set your database rules to allow access. Go to the **Rules** tab in your Firestore database and set:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}

```

### 5. Running the Project

```bash
npm run dev

```

Open the provided local URL (e.g., `http://localhost:5173`) in your browser to start managing your tournament.

---

## 📂 Project Structure

* `src/pages/Admin/AdminView.jsx`: Tournament creation, scheduling, and standings.
* `src/pages/Referee/RefereeView.jsx`: Scoring interface with PIN authentication.
* `src/pages/Participant/ParticipantView.jsx`: Public-facing live scoreboard.
* `src/config/firebase.js`: Firebase SDK initialization.

## 💡 How to use

1. **Admin:** Log in, create a tournament, set the pool size and court count. The system will automatically generate the match queue.
2. **Referee:** Use the 6-digit code provided by the Admin to unlock the dashboard and start scoring.
3. **Participants:** Simply select the tournament to see live updates as matches happen.
