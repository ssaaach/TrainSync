# 🏋️‍♂️ TrainSync — Personal Fitness Matching Made Easy  
A full-stack web platform that connects trainees with certified personal trainers, helps users find nearby gyms, and provides personalized diet and workout plans — all in one place.

---

## 🌍 The Problem We're Solving  
Fitness journeys often break down due to:

- No personalized guidance from experts  
- Inaccessibility to nearby gyms or trainers  
- Lack of structured diet or workout planning  

**TrainSync** fixes this by offering:

- 💪 Trainer matching based on profiles  
- 🏢 Gym discovery by city with contact/location  
- 🍎 Personalized fitness plans based on goals

---

## 🔑 Key Features

✅ Role-based login (Trainer / Trainee)  
✅ Secure user authentication using `bcrypt` and sessions  
✅ Find gyms based on city input with contact info & map links  
✅ Diet plans based on body type (ectomorph/mesomorph/endomorph) and goal (bulk, cut, etc.)  
✅ Weekly workout routines personalized by body type and fitness goal  
✅ Profile update for trainers (certifications, experience, specialization)  
✅ Dark themed UI with background video & responsive design  

---

## ⚙️ Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript  
- **Backend**: Node.js, Express.js  
- **Database**: MySQL  
- **Authentication**: express-session, bcrypt  
- **Tools**: VS Code, Git, GitHub, MySQL Workbench, Postman  

---

## 🧪 How It Works

1. 🔐 Register or login as a **Trainer** or **Trainee**  
2. 🧍 Trainees can:  
   - Search gyms in their city  
   - View diet and workout plans based on input  
3. 🧑‍🏫 Trainers can:  
   - Update their profile with certifications and experience  
   - Get ready to be matched to trainees (future scope)  
4. 📄 Everything stored in a relational MySQL database  

---

## 📂 Run Locally

```bash
git clone https://github.com/ssaaaach/TrainSync.git
cd TrainSync
npm install
node server.js
```

## 🖼️ Sample Pages
🏠 Homepage with animated background and session-aware login

🧍 Diet & workout planners with input-based data rendering

🏋️ Gym locator with clickable Google Maps links

🔧 Profile updater for trainers (with form submission)

🎨 Clean, minimal dark theme UI

## 🔮 Roadmap
AI-powered trainer matching

Distance-based trainer recommendations via Google Maps API

Chat system for trainee–trainer communication

Full mobile responsiveness

## 🙋‍♂️ About the Developer
Sachin Bhat
B.Tech CSE @ Manipal Institute of Technology
📧 sachin.mitblr2023@learner.manipal.edu
🔗 LinkedIn
🐙 GitHub

💻 Built completely from scratch as a solo project — backend, frontend, DB, and integration 🔥
