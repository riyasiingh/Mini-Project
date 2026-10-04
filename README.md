# Mini-Project

# Academic Workload Forecasting & Deadline Collision Detection System

> A predictive academic analytics web application that models effective preparation capacity, forecasts temporal deadline collisions, and assists university students in proactive study scheduling.

---

## 📌 Project Overview
University students frequently balance concurrent academic obligations across courses—such as lectures, laboratory sessions, continuous assessments, assignments, and examinations. Traditional digital calendars and task trackers act as passive reminders: they store static event dates without evaluating whether the student has adequate time available before those deadlines.

This system combines recurring academic timetables, institutional calendars, national holidays, and assessment deadlines to calculate **Net Available Preparation Capacity** and detect **Deadline Collisions** in advance.

- **Institution:** Usha Mittal Institute of Technology, SNDT Women's University
- **Program:** B.Tech. Information Technology (Semester III)
- **Contributors:** 
  - Aditi Nagdeve (Roll No. 38)
  - Riya Singh (Roll No. 63)

---

## 🚀 Key Features
- **Smart Schedule Ingestion & Verification:** Upload weekly timetables and academic calendars with an editable verification review stage ("AI can make mistakes").
- **Dynamic Indian Festival & Holiday Engine:** Multi-year calendar navigation (2000–2099+) with automatic Gazetted holidays (e.g., Gandhi Jayanti, Republic Day) and festival strain modeling (e.g., Navratri, Diwali).
- **Predictive Collision Engine:** Formulates daily workload intensity ($WSI$) and flags intervals where required effort exceeds available student bandwidth.
- **AI-Assisted Load Leveling:** Distributes prep chunks forward into lighter days before exam or festival crunches.
- **Full CRUD Task & Deadline Manager:** Add, edit, or delete deadlines and anticipatory study tasks with instant calendar and dashboard updates.
- **Dual-Layer Cloud & Offline Persistence:** Real-time synchronization with Google Cloud Firestore paired with instant `localStorage` caching.
- **Course-Integrated Focus Pomodoro:** Study timer tied to course credit weights with synthetic audio chimes.
- **Admin Directory Portal:** Cohort monitoring view displaying registered student statistics.

---

## 🛠️ Tech Stack
- **Frontend:** HTML5, Tailwind CSS, Vanilla JavaScript (ES6+)
- **Visualizations:** Chart.js, Lucide Icons
- **Audio Engine:** Tone.js (Web Audio API)
- **Backend & Cloud Database:** Google Firebase Authentication & Cloud Firestore (NoSQL)

---

## 📂 Project Structure
```text
├── src/
│   ├── index.html       # Single-page web dashboard layout
│   ├── style.css        # Heatmap density classes and UI themes
│   └── app.js           # Core calculation engine and cloud sync
├── docs/
│   └── proposal.tex     # LaTeX project proposal source
├── .env.example         # Template for environment credentials
├── .gitignore           # Ignored system and build files
└── README.md            # Project overview and run guide
