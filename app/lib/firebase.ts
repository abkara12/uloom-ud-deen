// lib/firebase.ts
import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDfY-uQdXdKfT3UoZ1OiCr_Z1VpRdNKc-U",
  authDomain: "uloom-ud-deen-3bbce.firebaseapp.com",
  projectId: "uloom-ud-deen-3bbce",
  storageBucket: "uloom-ud-deen-3bbce.firebasestorage.app",
  messagingSenderId: "211948715999",
  appId: "1:211948715999:web:37fd75ce7c49cdf1660e6a"
};


const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
