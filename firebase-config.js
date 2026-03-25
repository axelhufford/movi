// ╔══════════════════════════════════════════════════════════════╗
// ║  FIREBASE SETUP INSTRUCTIONS (takes ~5 minutes)            ║
// ║                                                            ║
// ║  1. Go to https://console.firebase.google.com              ║
// ║  2. Click "Create a project" → name it "movi" → Continue   ║
// ║  3. Disable Google Analytics (optional) → Create Project   ║
// ║  4. Click the web icon "</>" to add a web app               ║
// ║  5. Name it "movi" → Register app                          ║
// ║  6. Copy the config values below (they show on screen)     ║
// ║  7. Enable Google Sign-In:                                 ║
// ║     - Left sidebar → Authentication → Get Started          ║
// ║     - Click "Google" → Enable → Save                       ║
// ║  8. Enable Firestore Database:                             ║
// ║     - Left sidebar → Firestore Database → Create Database  ║
// ║     - Choose location → Start in TEST MODE → Create        ║
// ║  9. Set security rules (Firestore → Rules tab):            ║
// ║     Paste this:                                            ║
// ║       rules_version = '2';                                 ║
// ║       service cloud.firestore {                            ║
// ║         match /databases/{database}/documents {            ║
// ║           match /profiles/{userId} {                       ║
// ║             allow read: if true;                           ║
// ║             allow write: if request.auth != null           ║
// ║                          && request.auth.uid == userId;    ║
// ║           }                                                ║
// ║         }                                                  ║
// ║       }                                                    ║
// ╚══════════════════════════════════════════════════════════════╝

const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
