import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBmdKxiXugYQkR_Wyvgg5rSuq5uGOC0xac",
  authDomain: "projetokanban-a16a7.firebaseapp.com",
  projectId: "projetokanban-a16a7",
  storageBucket: "projetokanban-a16a7.firebasestorage.app",
  messagingSenderId: "1026429696554",
  appId: "1:1026429696554:web:ac1b965c41aa582c90e153",
  measurementId: "G-KS63SQ5F0R"
};

const app      = initializeApp(firebaseConfig);
export const auth     = getAuth(app);
export const provider = new GoogleAuthProvider();
